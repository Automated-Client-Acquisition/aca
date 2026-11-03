/**
 * BYO IP Blacklist Check.
 *
 * Two modes:
 *   - Cron sweep (no body): scan every active or formerly-blacklisted IP
 *   - On-demand (body: { organization_id, ip_id }): check a single IP
 *
 * For each IP we query Spamhaus ZEN, Barracuda, SpamCop, and SORBS via DoH.
 * Updates byo_server_ips:
 *   - blacklisted_on    — JSON array of {provider, label, code, description, listed_at, last_checked_at}
 *   - last_blacklist_check_at
 *   - status            — 'blacklisted' if any hits, 'cooling' if previously listed and now clean, 'active' otherwise
 *   - health_score      — drops with each hit (0.7 / 0.4 / 0.1) and recovers slowly
 *
 * The status flip pulls the IP out of pickStickyIp's eligible pool automatically
 * since it filters on status='active'.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { checkDnsbl, type DnsblHit } from '../_shared/byo/dnsbl.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface ServerIpRow {
  id: string;
  organization_id: string;
  ip_address: string;
  status: string;
  blacklisted_on: Array<{ provider: string; first_listed_at?: string }> | null;
  health_score: number;
}

function computeHealth(prev: number, hitCount: number, hadHits: boolean): number {
  if (hitCount >= 3) return 0.1;
  if (hitCount === 2) return 0.4;
  if (hitCount === 1) return 0.7;
  // Clean now. If we were just listed, drop status to 'cooling' but recover
  // health gradually toward 1.0 each successive clean check.
  if (hadHits) return Math.min(1.0, prev + 0.1);
  return Math.min(1.0, prev + 0.05);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  // Parse optional body. Empty body = cron mode.
  let onDemandIpId: string | null = null;
  let onDemandOrgId: string | null = null;
  try {
    const text = await req.text();
    if (text.trim()) {
      const body = JSON.parse(text);
      onDemandIpId = body.ip_id ?? null;
      onDemandOrgId = body.organization_id ?? null;
    }
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON' }, 400);
  }

  // On-demand: must be authed user owning the org.
  if (onDemandIpId) {
    if (!onDemandOrgId) return jsonResponse({ success: false, error: 'organization_id required' }, 400);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ success: false, error: 'Missing auth header' }, 401);
    const { data: userRes, error: userErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userErr || !userRes?.user) return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('organization_id', onDemandOrgId)
      .eq('user_id', userRes.user.id)
      .maybeSingle();
    if (!membership) return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  // Pull rows. Cron mode walks every active/blacklisted IP.
  let query = supabase
    .from('byo_server_ips')
    .select('id, organization_id, ip_address, status, blacklisted_on, health_score');

  if (onDemandIpId) {
    query = query.eq('id', onDemandIpId).eq('organization_id', onDemandOrgId!);
  } else {
    query = query.in('status', ['active', 'cooling', 'blacklisted']);
  }

  const { data: rows, error } = await query;
  if (error) return jsonResponse({ success: false, error: error.message }, 500);
  if (!rows || rows.length === 0) {
    return jsonResponse({ success: true, checked: 0, listed: 0, cleared: 0 });
  }

  const ips = rows as ServerIpRow[];
  const now = new Date().toISOString();
  let listedCount = 0;
  let clearedCount = 0;

  // Sequential to keep DoH quota usage reasonable. Each IP fans out to 4
  // resolvers in parallel inside checkDnsbl, so this is still fast.
  for (const ip of ips) {
    const result = await checkDnsbl(ip.ip_address);
    const hadHits = (ip.blacklisted_on ?? []).length > 0;
    const hits = result.hits;

    const blacklistedRows = hits.map((h: DnsblHit) => {
      const prevEntry = (ip.blacklisted_on ?? []).find((e) => e.provider === h.provider);
      return {
        provider: h.provider,
        label: h.label,
        code: h.code,
        description: h.description,
        first_listed_at: prevEntry?.first_listed_at ?? now,
        last_checked_at: now,
      };
    });

    const newStatus = hits.length > 0
      ? 'blacklisted'
      : hadHits
        ? 'cooling'
        : 'active';
    const newHealth = Number(computeHealth(ip.health_score, hits.length, hadHits).toFixed(2));

    if (hits.length > 0) listedCount++;
    if (hadHits && hits.length === 0) clearedCount++;

    await supabase
      .from('byo_server_ips')
      .update({
        blacklisted_on: blacklistedRows,
        last_blacklist_check_at: now,
        status: newStatus,
        health_score: newHealth,
      })
      .eq('id', ip.id);
  }

  return jsonResponse({
    success: true,
    checked: ips.length,
    listed: listedCount,
    cleared: clearedCount,
    on_demand: !!onDemandIpId,
  });
});
