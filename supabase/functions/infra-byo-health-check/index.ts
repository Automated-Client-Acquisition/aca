/**
 * BYO Health Check — cron sweep (every 5min via pg_cron, see migration).
 *
 * Marks servers 'degraded' when their agent hasn't checked in for >10 minutes.
 * Doesn't trigger SSH on its own — Phase 6 relies on the user-installed agent
 * for active health data. If the agent stops reporting, that's the signal.
 *
 * Recovery: if a previously degraded server starts checking in again,
 * infra-byo-events flips it back to 'ready'. This sweep doesn't auto-recover.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

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

const STALE_HEARTBEAT_MS = 10 * 60 * 1000;

// Grace period after deploy_base completes — the agent's cron entry runs
// every minute, but its first invocation might be 30-90s after deploy
// finishes. Don't flag 'degraded' during this window or every fresh deploy
// looks broken on the dashboard.
const POST_DEPLOY_GRACE_MS = 10 * 60 * 1000;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  // Pull all 'ready' or 'degraded' servers — these are the ones we expect agents on.
  const { data: servers, error } = await supabase
    .from('byo_servers')
    .select('id, status, deploy_state, last_error')
    .in('status', ['ready', 'degraded']);
  if (error) return jsonResponse({ success: false, error: error.message }, 500);

  const cutoff = Date.now() - STALE_HEARTBEAT_MS;
  let degraded = 0;
  let recovered = 0;
  let untouched = 0;

  for (const server of (servers ?? []) as Array<{
    id: string; status: string; deploy_state: Record<string, unknown> | null; last_error: string | null;
  }>) {
    const lastHealthRaw = server.deploy_state?.last_health as string | undefined;
    const lastHealthMs = lastHealthRaw ? Date.parse(lastHealthRaw) : NaN;
    const stale = !Number.isFinite(lastHealthMs) || lastHealthMs < cutoff;

    // Servers without an agent_installed flag never report — don't mark them degraded.
    const agentInstalled = (server.deploy_state?.agent_installed as boolean | undefined) ?? false;

    if (!agentInstalled) {
      untouched++;
      continue;
    }

    // Grace period: don't flag a server 'degraded' if it deployed recently
    // and just hasn't reported its first heartbeat yet.
    const lastDeployRaw = server.deploy_state?.last_deploy as string | undefined;
    const lastDeployMs = lastDeployRaw ? Date.parse(lastDeployRaw) : NaN;
    const inGracePeriod = Number.isFinite(lastDeployMs) &&
      Date.now() - lastDeployMs < POST_DEPLOY_GRACE_MS;
    if (inGracePeriod) {
      untouched++;
      continue;
    }

    if (stale && server.status === 'ready') {
      await supabase
        .from('byo_servers')
        .update({
          status: 'degraded',
          last_error: 'Agent has not reported in >10 minutes. Check that aca-agent-report.sh is running on the server (cron + /var/log/syslog).',
        })
        .eq('id', server.id);
      degraded++;
    } else if (!stale && server.status === 'degraded') {
      // Agent recovered before this sweep got to it. Defensive auto-recover.
      await supabase
        .from('byo_servers')
        .update({ status: 'ready', last_error: null })
        .eq('id', server.id);
      recovered++;
    } else {
      untouched++;
    }
  }

  return jsonResponse({
    success: true,
    total: servers?.length ?? 0,
    degraded,
    recovered,
    untouched,
  });
});
