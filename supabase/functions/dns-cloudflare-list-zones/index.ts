/**
 * dns-cloudflare-list-zones
 *
 * Lists Cloudflare zones the org's stored token can see. Supports optional
 * server-side filtering (`name_contains`) so the wizard can match a domain
 * the user just typed against their zones.
 *
 * Also returns zones-matching-existing-ACA-domains as a separate computed
 * array. That's what powers the "migrate these N existing domains" CTA in
 * the connect-success dialog.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptValue } from '../_shared/encryption.ts';
import { createCloudflareClient } from '../_shared/cloudflare-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import type { AuthError } from '../_shared/cli-auth.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { organization_id, name_contains, include_unmigrated_matches } = body;

    if (!organization_id) return json({ error: 'organization_id is required' }, 400);

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      const e = authErr as AuthError;
      return json({ error: e?.message ?? 'Unauthorized' }, e?.status ?? 401);
    }

    const { data: provider, error: provErr } = await supabase
      .from('dns_providers')
      .select('id, api_token_encrypted, account_id')
      .eq('organization_id', organization_id)
      .eq('provider', 'cloudflare')
      .maybeSingle();

    if (provErr) return json({ error: `Failed to read provider: ${provErr.message}` }, 500);
    if (!provider) return json({ error: 'Cloudflare is not connected for this organization' }, 400);

    const token = await decryptValue(provider.api_token_encrypted);
    const client = createCloudflareClient(token);

    const zones = await client.listZones({ name: name_contains, accountId: provider.account_id ?? undefined });

    // Refresh the cached zone_count + last_used_at
    await supabase
      .from('dns_providers')
      .update({ zone_count: zones.length, last_used_at: new Date().toISOString(), last_error: null })
      .eq('id', provider.id);

    const result: Record<string, unknown> = {
      zones: zones.map((z) => ({
        zone_id: z.id,
        name: z.name,
        status: z.status,
        name_servers: z.name_servers,
        account_id: z.account?.id,
      })),
    };

    // Optional: surface "we found ACA domains that match these zones and aren't
    // yet on managed DNS" so the connect-success dialog can offer a one-click
    // migrate CTA.
    if (include_unmigrated_matches) {
      const { data: domains } = await supabase
        .from('email_sending_domains')
        .select('id, domain, dns_managed')
        .eq('organization_id', organization_id)
        .eq('infra_type', 'm365');

      const zoneNames = new Set(zones.map((z) => z.name.toLowerCase()));
      const matchesNeedingMigration = (domains ?? [])
        .filter((d) => !d.dns_managed)
        .filter((d) => {
          const dn = d.domain.toLowerCase();
          // exact match OR domain is a subdomain of one of our zones
          return [...zoneNames].some((z) => dn === z || dn.endsWith(`.${z}`));
        });
      result.unmigrated_matches = matchesNeedingMigration;
    }

    return json(result);
  } catch (err) {
    console.error('[dns-cloudflare-list-zones]', err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
