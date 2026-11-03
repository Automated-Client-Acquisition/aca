/**
 * dns-cloudflare-push-records
 *
 * Pushes a domain's dns_records to its linked Cloudflare zone. Two phases:
 *   1. Preview (no confirm_destructive flag set) → returns the diff plan,
 *      including conflicts that would be deleted. Caller renders the diff.
 *   2. Execute (confirm_destructive = true) → performs the deletes, updates,
 *      and creates, then writes the new state back to email_sending_domains.
 *
 * Idempotent: re-running after a successful push is a no-op (all records match
 * existing zone state → keeps only, no writes). Crucial because the wizard
 * may call this multiple times during polling.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptValue } from '../_shared/encryption.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import {
  createCloudflareClient,
  type PushTargetRecord,
  type CloudflareZone,
} from '../_shared/cloudflare-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Find the best zone for a domain. Direct match first, then parent-zone match
 * (so `mail.acme.com` matches zone `acme.com`). Returns null if neither hits.
 */
async function resolveZone(
  client: ReturnType<typeof createCloudflareClient>,
  accountId: string | null,
  domain: string,
): Promise<CloudflareZone | null> {
  // Cloudflare's name= filter is exact-match. Try that first for the cheapest hit.
  const exact = await client.listZones({ name: domain, accountId: accountId ?? undefined });
  if (exact.length > 0) return exact[0];

  // For subdomain → parent-zone matching we need to fetch and walk. Bound the
  // scan: list up to the first page of zones and check each.
  const candidates = await client.listZones({ accountId: accountId ?? undefined });
  const lower = domain.toLowerCase();
  // Pick the longest matching parent (most specific)
  return (
    candidates
      .filter((z) => lower === z.name.toLowerCase() || lower.endsWith(`.${z.name.toLowerCase()}`))
      .sort((a, b) => b.name.length - a.name.length)[0] ?? null
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const {
      organization_id,
      domain_id,
      confirm_destructive = false,
      dry_run = false,
      only_dkim = false,
      // When set, push exactly these records instead of the domain's stored
      // dns_records — e.g. a single out-of-band TXT edit (DMARC rua rewrite)
      // that shouldn't trigger a full record-set diff/conflict-cleanup pass.
      override_records,
    } = body;

    if (!organization_id || !domain_id) {
      return json({ error: 'organization_id and domain_id are required' }, 400);
    }

    // The service-role client acts on whatever org the body names, so the
    // caller must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // Fetch the domain — scoped by org so cross-org IDs return 404 silently.
    const { data: domain, error: domainErr } = await supabase
      .from('email_sending_domains')
      .select('id, domain, organization_id, dns_records, dns_provider_id, cloudflare_zone_id, nameservers_assigned, dns_managed')
      .eq('id', domain_id)
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (domainErr) return json({ error: `Domain lookup failed: ${domainErr.message}` }, 500);
    if (!domain) return json({ error: 'Domain not found' }, 404);

    // Find the provider — either explicitly linked on the domain or the org's default.
    // Both are org-scoped: users can write dns_provider_id on their own domain rows.
    const providerId = domain.dns_provider_id;
    const providerQuery = providerId
      ? supabase
          .from('dns_providers')
          .select('id, api_token_encrypted, account_id')
          .eq('id', providerId)
          .eq('organization_id', organization_id)
      : supabase
          .from('dns_providers')
          .select('id, api_token_encrypted, account_id')
          .eq('organization_id', organization_id)
          .eq('provider', 'cloudflare');
    const { data: providerRows, error: provErr } = await providerQuery.limit(1);

    if (provErr) return json({ error: `Provider lookup failed: ${provErr.message}` }, 500);
    if (!providerRows || providerRows.length === 0) {
      return json({
        error_title: 'Cloudflare not connected',
        error: 'This organization has no Cloudflare provider connected. Connect Cloudflare in Settings → Email Infrastructure first.',
      }, 400);
    }
    const provider = providerRows[0];

    const token = await decryptValue(provider.api_token_encrypted);
    const client = createCloudflareClient(token);

    // Resolve the zone — use the cached zone_id if we have one, else discover.
    let zoneId = domain.cloudflare_zone_id as string | null;
    let zoneNameServers: string[] | undefined;
    if (!zoneId) {
      const zone = await resolveZone(client, provider.account_id, domain.domain);
      if (!zone) {
        return json({
          error_title: `${domain.domain} isn't in Cloudflare yet`,
          error: `Before ACA can manage DNS, this domain needs to exist as a "zone" in your Cloudflare account. A zone is just a domain Cloudflare knows about — once it's added, we can write the SPF / DKIM / DMARC / MX records for you.`,
          next_steps: [
            `Open Cloudflare → Add a Site → enter "${domain.domain}"`,
            `Cloudflare will give you 2 nameservers (like x.ns.cloudflare.com)`,
            `Update those nameservers at your current registrar (where you bought the domain)`,
            `Wait 5-30 minutes for the change to propagate`,
            `Come back here and click "Migrate DNS" again`,
          ],
          help_url: 'https://dash.cloudflare.com/?to=/:account/add-site',
        }, 404);
      }
      zoneId = zone.id;
      zoneNameServers = zone.name_servers;
    }

    // Filter the target record set if caller wants only DKIM (used by verify_dns
    // post-enrichDkim hook so we don't re-push the whole record set every poll).
    let targetRecords: PushTargetRecord[] = ((override_records ?? domain.dns_records ?? []) as unknown as PushTargetRecord[])
      .map((r) => ({
        type: r.type,
        name: r.name,
        value: r.value,
        ttl: r.ttl ?? 3600,
        priority: r.priority,
        description: r.description,
      }));
    if (only_dkim) {
      targetRecords = targetRecords.filter(
        (r) => r.type === 'CNAME' && r.name.toLowerCase().includes('_domainkey'),
      );
    }

    if (targetRecords.length === 0) {
      return json({ error: 'Domain has no DNS records to push (record set is empty)' }, 400);
    }

    const pushResult = await client.batchPushRecords(zoneId, targetRecords, {
      cleanupConflicts: true,
      confirmDestructive: confirm_destructive,
      dryRun: dry_run,
    });

    // Update the provider's last_used_at
    await supabase
      .from('dns_providers')
      .update({ last_used_at: new Date().toISOString(), last_error: null })
      .eq('id', provider.id);

    // If the user hasn't confirmed yet, surface the diff and stop.
    if (pushResult.requires_confirmation) {
      return json({
        success: true,
        requires_confirmation: true,
        zone_id: zoneId,
        diff: pushResult.plan,
      });
    }

    if (dry_run) {
      return json({
        success: true,
        dry_run: true,
        zone_id: zoneId,
        diff: pushResult.plan,
      });
    }

    // Persist the linkage on the domain row. We always set dns_provider_id +
    // cloudflare_zone_id when we successfully push, and dns_managed = true.
    const allOk = pushResult.results.filter((r) => r.action !== 'skipped').every((r) => r.success);
    const updateRow: Record<string, unknown> = {
      dns_provider_id: provider.id,
      cloudflare_zone_id: zoneId,
      dns_managed: true,
      updated_at: new Date().toISOString(),
    };
    if (zoneNameServers) updateRow.nameservers_assigned = zoneNameServers;

    await supabase.from('email_sending_domains').update(updateRow).eq('id', domain_id);

    const counts = {
      created: pushResult.results.filter((r) => r.action === 'created' && r.success).length,
      updated: pushResult.results.filter((r) => r.action === 'updated' && r.success).length,
      deleted: pushResult.results.filter((r) => r.action === 'deleted' && r.success).length,
      skipped: pushResult.results.filter((r) => r.action === 'skipped').length,
      failed: pushResult.results.filter((r) => !r.success).length,
    };
    const summary = (() => {
      const parts: string[] = [];
      if (counts.created) parts.push(`Created ${counts.created}`);
      if (counts.updated) parts.push(`Updated ${counts.updated}`);
      if (counts.deleted) parts.push(`Cleaned up ${counts.deleted} conflict${counts.deleted === 1 ? '' : 's'}`);
      if (counts.skipped) parts.push(`${counts.skipped} already in place`);
      if (counts.failed) parts.push(`${counts.failed} failed`);
      return parts.join(', ') || 'No changes needed';
    })();

    return json({
      success: allOk,
      zone_id: zoneId,
      nameservers_assigned: zoneNameServers ?? domain.nameservers_assigned,
      counts,
      summary,
      results: pushResult.results,
    });
  } catch (err) {
    console.error('[dns-cloudflare-push-records]', err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
