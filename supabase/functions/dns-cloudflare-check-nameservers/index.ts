/**
 * dns-cloudflare-check-nameservers
 *
 * For the migrate-existing-domain flow. The user must change nameservers
 * at their current registrar; we poll Cloudflare's zone status to know when
 * the swap is live (status: "active"). Also resolves the live NS via DoH
 * so we can show a clearer "your registrar still serves X — change to Y" state.
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

async function resolveLiveNs(domain: string): Promise<string[]> {
  try {
    const resp = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { Answer?: Array<{ type: number; data: string }> };
    return (data.Answer || [])
      .filter((a) => a.type === 2) // NS
      .map((a) => a.data.replace(/\.$/, '').toLowerCase());
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { organization_id, domain_id } = body;
    if (!organization_id || !domain_id) {
      return json({ error: 'organization_id and domain_id are required' }, 400);
    }

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      const e = authErr as AuthError;
      return json({ error: e?.message ?? 'Unauthorized' }, e?.status ?? 401);
    }

    const { data: domain, error: dErr } = await supabase
      .from('email_sending_domains')
      .select('id, domain, cloudflare_zone_id, nameservers_assigned, nameservers_active')
      .eq('id', domain_id)
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (dErr) return json({ error: `Lookup failed: ${dErr.message}` }, 500);
    if (!domain) return json({ error: 'Domain not found' }, 404);
    if (!domain.cloudflare_zone_id) {
      return json({ error: 'Domain has no linked Cloudflare zone yet' }, 400);
    }

    const { data: provider } = await supabase
      .from('dns_providers')
      .select('api_token_encrypted')
      .eq('organization_id', organization_id)
      .eq('provider', 'cloudflare')
      .maybeSingle();
    if (!provider) return json({ error: 'Cloudflare not connected' }, 400);

    const token = await decryptValue(provider.api_token_encrypted);
    const client = createCloudflareClient(token);

    // Cloudflare's view (zone status) + live DNS view (what registrar actually serves)
    const [zone, liveNs] = await Promise.all([
      client.getZone(domain.cloudflare_zone_id).catch((e: unknown) => {
        console.warn('[check-nameservers] getZone failed:', e);
        return null;
      }),
      resolveLiveNs(domain.domain),
    ]);

    const cfActive = zone?.status === 'active';
    const assigned = domain.nameservers_assigned ?? zone?.name_servers ?? [];

    // Compute "is the live NS the one Cloudflare gave us?"
    const assignedLower = new Set(assigned.map((n: string) => n.toLowerCase()));
    const liveMatches = liveNs.length > 0 && liveNs.every((n) => assignedLower.has(n));
    const status = cfActive && liveMatches ? 'active' : liveMatches ? 'pending_cf_activation' : 'pending';

    // Persist what we just saw
    await supabase
      .from('email_sending_domains')
      .update({
        nameservers_active: liveNs,
        ...(zone?.name_servers ? { nameservers_assigned: zone.name_servers } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', domain_id)
      .eq('organization_id', organization_id);

    return json({
      status,
      nameservers_assigned: assigned,
      nameservers_active: liveNs,
      zone_status: zone?.status ?? null,
      next_check_recommended_in_seconds: status === 'active' ? 0 : 60,
    });
  } catch (err) {
    console.error('[dns-cloudflare-check-nameservers]', err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
