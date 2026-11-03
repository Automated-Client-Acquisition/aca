/**
 * BYO IP Warmup — daily cron-triggered ramp.
 *
 * For every active byo_server_ips row whose daily_sent counter has rolled
 * over (last reset before today), we:
 *   1. Reset daily_sent to 0
 *   2. Increment warmup_day
 *   3. Bump daily_send_limit per IP_WARMUP_CURVE (from _shared/byo/ip-rotation.ts)
 *
 * Triggered by pg_cron at 03:13 UTC daily (see migration 20260516000000).
 * Also callable manually from the UI for testing — no body required.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  dailyLimitForWarmupDay,
  IP_WARMUP_CURVES,
  resolveWarmupStrategy,
  type WarmupStrategy,
} from '../_shared/byo/ip-rotation.ts';

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  // Active IPs whose daily_sent counter is from a previous calendar day.
  const today = new Date().toISOString().slice(0, 10);
  const { data: ips, error } = await supabase
    .from('byo_server_ips')
    .select('id, organization_id, ip_address, status, warmup_day, daily_send_limit, daily_sent_reset_at')
    .eq('status', 'active');
  if (error) return jsonResponse({ success: false, error: error.message }, 500);

  const ramped: Array<{ id: string; ip_address: string; warmup_day: number; daily_send_limit: number; strategy: WarmupStrategy }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  // Cache the warmup strategy per org to avoid re-querying for each IP.
  const strategyByOrg = new Map<string, WarmupStrategy>();

  for (const ip of (ips ?? []) as Array<{
    id: string; organization_id: string; ip_address: string; status: string;
    warmup_day: number; daily_send_limit: number; daily_sent_reset_at: string;
  }>) {
    if (ip.daily_sent_reset_at && ip.daily_sent_reset_at >= today) {
      skipped.push({ id: ip.id, reason: 'already_rolled_today' });
      continue;
    }

    let strategy = strategyByOrg.get(ip.organization_id);
    if (!strategy) {
      strategy = await resolveWarmupStrategy(supabase, ip.organization_id);
      strategyByOrg.set(ip.organization_id, strategy);
    }
    const curve = IP_WARMUP_CURVES[strategy];

    const nextDay = Math.min(ip.warmup_day + 1, curve.length - 1);
    const nextLimit = dailyLimitForWarmupDay(nextDay, strategy);
    const { error: updErr } = await supabase
      .from('byo_server_ips')
      .update({
        warmup_day: nextDay,
        daily_send_limit: nextLimit,
        daily_sent: 0,
        daily_sent_reset_at: today,
      })
      .eq('id', ip.id);
    if (updErr) {
      skipped.push({ id: ip.id, reason: updErr.message });
      continue;
    }
    ramped.push({ id: ip.id, ip_address: ip.ip_address, warmup_day: nextDay, daily_send_limit: nextLimit, strategy });
  }

  return jsonResponse({
    success: true,
    ramped_count: ramped.length,
    skipped_count: skipped.length,
    ramped,
    skipped,
  });
});
