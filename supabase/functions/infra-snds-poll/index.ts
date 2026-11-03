/**
 * Phase 8.2.2 — Cron-triggered SNDS data poll.
 *
 * For every byo_server with snds_data_url set, fetches the CSV, parses, and
 * upserts daily reputation rows. Updates byo_server_ips.snds_last_status
 * for fast UI reads.
 *
 * Auto-burn rule: if filter_result=RED for 2 consecutive days, the IP gets
 * removed from active rotation (status='cooling') so the existing IP rotation
 * picks healthy IPs only.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { fetchSndsRows, persistSndsSnapshot } from '../_shared/snds.ts';

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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: servers } = await supabase
    .from('byo_servers')
    .select('id, snds_data_url')
    .not('snds_data_url', 'is', null)
    .eq('status', 'ready');

  const totals = { servers_polled: 0, rows_saved: 0, rows_skipped: 0, ips_cooled: 0, errors: 0 };

  for (const s of (servers ?? []) as Array<{ id: string; snds_data_url: string }>) {
    totals.servers_polled++;
    let rows;
    try {
      rows = await fetchSndsRows(s.snds_data_url);
    } catch (e) {
      totals.errors++;
      console.warn(`[snds-poll] server ${s.id}: ${e instanceof Error ? e.message : 'fetch failed'}`);
      continue;
    }
    try {
      const result = await persistSndsSnapshot(supabase, s.id, rows);
      totals.rows_saved += result.saved;
      totals.rows_skipped += result.skipped;
    } catch (e) {
      totals.errors++;
      console.warn(`[snds-poll] persist failed for ${s.id}: ${e instanceof Error ? e.message : 'unknown'}`);
      continue;
    }

    // Auto-cool: 2 consecutive RED days = move IP into cooling.
    const { data: redIps } = await supabase
      .from('byo_server_ips')
      .select('id, snds_last_status, status')
      .eq('server_id', s.id)
      .eq('snds_last_status', 'red')
      .eq('status', 'active');
    for (const ip of (redIps ?? []) as Array<{ id: string; status: string }>) {
      // Check if yesterday was also RED.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: yesterdayLog } = await supabase
        .from('email_ip_reputation_log')
        .select('snds_status')
        .eq('byo_server_ip_id', ip.id)
        .eq('recorded_for', yesterday)
        .maybeSingle();
      if (yesterdayLog?.snds_status === 'red') {
        await supabase
          .from('byo_server_ips')
          .update({ status: 'cooling', health_score: 0.3 })
          .eq('id', ip.id);
        totals.ips_cooled++;
      }
    }
  }

  return jsonResponse({ success: true, ...totals });
});
