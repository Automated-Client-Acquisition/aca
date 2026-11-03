/**
 * BYO IP Attach — register an additional outbound IP with a deployed server.
 *
 * Pre-conditions:
 *   - The IP must already be assigned to the server's NIC by the user's
 *     hosting provider. add-ip-transport.sh fails if it isn't.
 *   - The server must be in 'ready' status (deploy_base completed).
 *
 * Side effects:
 *   - Inserts/upserts a byo_server_ips row in 'pending' status
 *   - Enqueues an attach_ip job; the deployer flips status to 'active' on success
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { enqueueByoJob, pingByoDeployer } from '../_shared/byo/job-enqueue.ts';
import { dailyLimitForWarmupDay, resolveWarmupStrategy } from '../_shared/byo/ip-rotation.ts';
import { checkDnsbl } from '../_shared/byo/dnsbl.ts';

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

interface AttachBody {
  organization_id: string;
  server_id: string;
  ip_address: string;
  ptr_record?: string;
  domain_id?: string;
  helo_name?: string;
  /**
   * If true, skip the pre-flight DNSBL gate. The check still runs and the
   * result is persisted on the IP row so the user sees what they overrode.
   */
  force?: boolean;
}

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: AttachBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id, server_id, ip_address, ptr_record, domain_id, helo_name, force } = body;

  if (!organization_id || !server_id || !ip_address) {
    return jsonResponse({ success: false, error: 'organization_id, server_id, ip_address required' }, 400);
  }
  const normalizedIp = ip_address.trim();
  if (!IPV4_RE.test(normalizedIp)) {
    return jsonResponse({ success: false, error: 'ip_address must be a valid IPv4 address' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ success: false, error: 'Missing auth header' }, 401);
  const token = authHeader.replace('Bearer ', '');
  const isServiceRole = token === serviceKey;
  let actorUserId: string | null = null;
  if (!isServiceRole) {
    const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userRes?.user) return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    actorUserId = userRes.user.id;

    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('organization_id', organization_id)
      .eq('user_id', userRes.user.id)
      .maybeSingle();
    if (!membership) return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  const { data: server, error: serverErr } = await supabase
    .from('byo_servers')
    .select('id, status, hostname')
    .eq('id', server_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (serverErr) return jsonResponse({ success: false, error: serverErr.message }, 500);
  if (!server) return jsonResponse({ success: false, error: 'Server not found' }, 404);
  if (server.status !== 'ready') {
    return jsonResponse({ success: false, error: `Server status is "${server.status}". Deploy the mail stack first.` }, 400);
  }

  // Validate domain assignment if provided.
  if (domain_id) {
    const { data: domain } = await supabase
      .from('email_sending_domains')
      .select('id, infra_type, byo_server_id')
      .eq('id', domain_id)
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (!domain) return jsonResponse({ success: false, error: 'Domain not found' }, 404);
    if (domain.infra_type !== 'byo') return jsonResponse({ success: false, error: 'Domain is not a BYO domain' }, 400);
    if (domain.byo_server_id !== server_id) {
      return jsonResponse({ success: false, error: 'Domain is attached to a different server' }, 400);
    }
  }

  // Pre-flight DNSBL check. Refuse to attach an IP that is already listed on
  // 2+ DNSBLs unless the caller passes force=true (in which case we still
  // record the listings on the IP row so they're visible later).
  let dnsblHits: Array<{ provider: string; label: string; code: string; description?: string }> = [];
  let dnsblCheckedAt: string | null = null;
  try {
    const dnsbl = await checkDnsbl(normalizedIp);
    dnsblHits = dnsbl.hits;
    dnsblCheckedAt = dnsbl.checked_at;
    if (!force && dnsbl.hits.length >= 2) {
      return jsonResponse({
        success: false,
        error: `Refused to attach: ${normalizedIp} is listed on ${dnsbl.hits.length} DNSBLs (${dnsbl.hits.map((h) => h.label).join(', ')}). Re-submit with force=true to override.`,
        dnsbl_hits: dnsbl.hits,
      }, 422);
    }
    if (dnsbl.hits.length === 1) {
      console.warn(`[infra-byo-ip-attach] ${normalizedIp} listed on 1 DNSBL (${dnsbl.hits[0].label}); allowing with warning.`);
    }
  } catch (e) {
    console.warn(`[infra-byo-ip-attach] DNSBL pre-flight failed for ${normalizedIp}: ${e instanceof Error ? e.message : 'unknown'}; proceeding (DoH unreachable should not block onboarding).`);
  }

  const initialMeta: Record<string, unknown> = {};
  if (helo_name) initialMeta.helo_name = helo_name.trim();
  if (dnsblHits.length > 0) initialMeta.attach_dnsbl_hits_at_attach = dnsblHits;
  if (force) initialMeta.attach_forced = true;

  // Resolve warmup curve for this org so day-0 limit matches the strategy
  // (cautious=5, standard=5, aggressive=10).
  const warmupStrategy = await resolveWarmupStrategy(supabase, organization_id);

  // Upsert: same (server_id, ip_address) reactivates a previously detached row.
  const { data: existing } = await supabase
    .from('byo_server_ips')
    .select('id, status, metadata')
    .eq('server_id', server_id)
    .eq('ip_address', normalizedIp)
    .maybeSingle();

  let ipRowId: string;
  if (existing) {
    if (existing.status === 'active') {
      return jsonResponse({ success: true, ip_id: existing.id, status: 'active', reused: true });
    }
    ipRowId = existing.id as string;
    await supabase
      .from('byo_server_ips')
      .update({
        status: 'pending',
        ptr_record: ptr_record ?? null,
        domain_id: domain_id ?? null,
        warmup_day: 0,
        daily_send_limit: dailyLimitForWarmupDay(0, warmupStrategy),
        daily_sent: 0,
        blacklisted_on: dnsblHits,
        last_blacklist_check_at: dnsblCheckedAt,
        metadata: { ...((existing.metadata as Record<string, unknown> | null) ?? {}), ...initialMeta },
      })
      .eq('id', ipRowId);
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from('byo_server_ips')
      .insert({
        organization_id,
        server_id,
        ip_address: normalizedIp,
        ptr_record: ptr_record ?? null,
        domain_id: domain_id ?? null,
        status: 'pending',
        warmup_day: 0,
        daily_send_limit: dailyLimitForWarmupDay(0, warmupStrategy),
        daily_sent: 0,
        health_score: 1.0,
        blacklisted_on: dnsblHits,
        last_blacklist_check_at: dnsblCheckedAt,
        metadata: initialMeta,
      })
      .select('id')
      .single();
    if (insertErr) {
      return jsonResponse({ success: false, error: `Failed to create IP row: ${insertErr.message}` }, 500);
    }
    ipRowId = (inserted as { id: string }).id;
  }

  // Idempotency on the job side.
  const { data: existingJob } = await supabase
    .from('infra_byo_jobs')
    .select('id, status')
    .eq('organization_id', organization_id)
    .eq('job_type', 'attach_ip')
    .eq('target_kind', 'ip')
    .eq('target_id', ipRowId)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingJob) {
    return jsonResponse({ success: true, ip_id: ipRowId, job_id: existingJob.id, status: existingJob.status, reused: true });
  }

  let job_id: string;
  try {
    const result = await enqueueByoJob(supabase, {
      organization_id,
      job_type: 'attach_ip',
      target_kind: 'ip',
      target_id: ipRowId,
      input: { server_id, ip_address: normalizedIp, helo_name: helo_name ?? null },
      created_by: actorUserId,
    });
    job_id = result.job_id;
  } catch (e) {
    return jsonResponse({ success: false, error: e instanceof Error ? e.message : 'Failed to enqueue' }, 500);
  }

  pingByoDeployer(job_id).catch(() => {});
  return jsonResponse({ success: true, ip_id: ipRowId, job_id, status: 'pending', reused: false });
});
