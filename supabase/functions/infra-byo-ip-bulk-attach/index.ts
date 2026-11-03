/**
 * BYO IP Bulk Attach — register every IP in a CIDR block at once.
 *
 * Targeted at users bringing their own /24 (typical IPXO lease). Walks the
 * CIDR, skips network and broadcast (.0 / .255 for IPv4 /24), expands into
 * byo_server_ips rows in a single transaction, and enqueues one attach_ip
 * job per address. The deployer throttles its own concurrency.
 *
 * Pre-flight DNSBL is intentionally NOT run here — checking 254 IPs against
 * 4 DNSBLs would issue >1000 DoH queries from a single edge worker. The
 * existing 4-hour blacklist cron picks up the new rows automatically.
 *
 * Body:
 *   {
 *     organization_id: uuid,
 *     server_id: uuid,
 *     cidr: "5.6.7.0/24",
 *     domain_id?: uuid,           // optional — pin every IP to this domain
 *     exclude?: string[],         // IPs to skip (already in use, gateway, etc.)
 *     helo_name?: string          // applied to every IP's metadata
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { enqueueByoJob, pingByoDeployer } from '../_shared/byo/job-enqueue.ts';
import { dailyLimitForWarmupDay, resolveWarmupStrategy } from '../_shared/byo/ip-rotation.ts';

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

interface BulkAttachBody {
  organization_id: string;
  server_id: string;
  cidr: string;
  domain_id?: string;
  exclude?: string[];
  helo_name?: string;
}

const CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

function ipToInt(ip: string): number {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(n: number): string {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join('.');
}

/**
 * Expand an IPv4 CIDR into the list of usable host addresses, skipping the
 * network address and (for prefixes < 31) the broadcast address.
 *
 * Refuses prefixes shorter than /22 (1024 hosts) — anything bigger should
 * be split into multiple bulk-attach calls and reviewed by the operator.
 */
function expandCidr(cidr: string): { ips: string[]; error?: string } {
  const m = CIDR_RE.exec(cidr.trim());
  if (!m) return { ips: [], error: 'Invalid CIDR format. Expected e.g. "5.6.7.0/24".' };
  const [, a, b, c, d, prefixStr] = m;
  const octets = [a, b, c, d].map((p) => parseInt(p, 10));
  const prefix = parseInt(prefixStr, 10);
  if (octets.some((o) => o < 0 || o > 255)) return { ips: [], error: 'CIDR octet out of range (0-255).' };
  if (prefix < 22 || prefix > 32) return { ips: [], error: 'CIDR prefix must be between /22 and /32.' };

  const baseInt = ipToInt(`${octets[0]}.${octets[1]}.${octets[2]}.${octets[3]}`);
  const hostBits = 32 - prefix;
  const blockSize = 1 << hostBits;
  const networkAddr = baseInt & (~(blockSize - 1) >>> 0);

  const ips: string[] = [];
  if (prefix === 32) {
    ips.push(intToIp(networkAddr));
  } else if (prefix === 31) {
    // /31 has both addresses usable per RFC 3021
    ips.push(intToIp(networkAddr));
    ips.push(intToIp(networkAddr + 1));
  } else {
    // skip network (.0) and broadcast (.last)
    for (let i = 1; i < blockSize - 1; i++) {
      ips.push(intToIp(networkAddr + i));
    }
  }
  return { ips };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: BulkAttachBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  const { organization_id, server_id, cidr, domain_id, exclude, helo_name } = body;
  if (!organization_id || !server_id || !cidr) {
    return jsonResponse({ success: false, error: 'organization_id, server_id, cidr required' }, 400);
  }

  const expansion = expandCidr(cidr);
  if (expansion.error) return jsonResponse({ success: false, error: expansion.error }, 400);

  const excludeSet = new Set((exclude ?? []).map((x) => x.trim()));
  const targets = expansion.ips.filter((ip) => !excludeSet.has(ip));
  if (targets.length === 0) {
    return jsonResponse({ success: false, error: 'CIDR expansion yielded zero attachable IPs after exclusions.' }, 400);
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

  const { data: server } = await supabase
    .from('byo_servers')
    .select('id, status, hostname')
    .eq('id', server_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (!server) return jsonResponse({ success: false, error: 'Server not found' }, 404);
  if (server.status !== 'ready') {
    return jsonResponse({ success: false, error: `Server status is "${server.status}". Deploy the mail stack first.` }, 400);
  }

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

  // Skip IPs already attached to this server.
  const { data: existing } = await supabase
    .from('byo_server_ips')
    .select('id, ip_address, status')
    .eq('server_id', server_id)
    .in('ip_address', targets);
  const existingByIp = new Map<string, { id: string; status: string }>();
  for (const row of (existing ?? []) as Array<{ id: string; ip_address: string; status: string }>) {
    existingByIp.set(row.ip_address, { id: row.id, status: row.status });
  }

  const warmupStrategy = await resolveWarmupStrategy(supabase, organization_id);
  const day0Limit = dailyLimitForWarmupDay(0, warmupStrategy);
  const initialMeta: Record<string, unknown> = { bulk_attach_cidr: cidr };
  if (helo_name) initialMeta.helo_name = helo_name.trim();

  // Bulk-insert any IPs that don't already exist.
  const toInsert: Array<Record<string, unknown>> = [];
  for (const ip of targets) {
    const existingRow = existingByIp.get(ip);
    if (existingRow && existingRow.status === 'active') continue; // skip already active
    if (existingRow) continue; // re-activation isn't supported via bulk; user should single-attach
    toInsert.push({
      organization_id,
      server_id,
      ip_address: ip,
      ptr_record: null,
      domain_id: domain_id ?? null,
      status: 'pending',
      warmup_day: 0,
      daily_send_limit: day0Limit,
      daily_sent: 0,
      health_score: 1.0,
      metadata: initialMeta,
    });
  }

  let insertedRows: Array<{ id: string; ip_address: string }> = [];
  if (toInsert.length > 0) {
    const { data: inserted, error: insertErr } = await supabase
      .from('byo_server_ips')
      .insert(toInsert)
      .select('id, ip_address');
    if (insertErr) {
      return jsonResponse({ success: false, error: `Bulk insert failed: ${insertErr.message}` }, 500);
    }
    insertedRows = (inserted ?? []) as Array<{ id: string; ip_address: string }>;
  }

  // Enqueue one attach_ip job per IP. Deployer rate-limits internally; we
  // create them in 50-row chunks so a partial failure doesn't take down the
  // whole batch.
  const chunkSize = 50;
  const enqueued: Array<{ ip_address: string; ip_id: string; job_id: string }> = [];
  const failed: Array<{ ip_address: string; error: string }> = [];

  for (let i = 0; i < insertedRows.length; i += chunkSize) {
    const chunk = insertedRows.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (row) => {
      try {
        const result = await enqueueByoJob(supabase, {
          organization_id,
          job_type: 'attach_ip',
          target_kind: 'ip',
          target_id: row.id,
          input: {
            server_id,
            ip_address: row.ip_address,
            helo_name: helo_name ?? null,
            bulk: true,
          },
          created_by: actorUserId,
        });
        enqueued.push({ ip_address: row.ip_address, ip_id: row.id, job_id: result.job_id });
      } catch (e) {
        failed.push({ ip_address: row.ip_address, error: e instanceof Error ? e.message : 'enqueue failed' });
      }
    }));
  }

  // Wake the deployer once — it'll drain the whole batch.
  if (enqueued.length > 0) {
    pingByoDeployer(enqueued[0].job_id).catch(() => {});
  }

  return jsonResponse({
    success: true,
    cidr,
    expanded_count: expansion.ips.length,
    attempted_count: targets.length,
    skipped_existing_count: targets.length - insertedRows.length,
    enqueued_count: enqueued.length,
    failed_count: failed.length,
    enqueued,
    failed,
  });
});
