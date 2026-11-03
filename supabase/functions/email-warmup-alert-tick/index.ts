/** Daily warmup alerts: actual mailbox opportunity stalls plus independent engine health. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  ACCEPTED_WARMUP_STATUSES,
  classifyWarmupMailbox,
  escapeWarmupAlertHtml,
  fetchWarmupAlertPages,
  hasWarmupAlertHeadroom,
  isWarmupEngineDown,
  isWarmupTransportBlocked,
  loadWarmupAlertStates,
  recentCompletedWarmupDays,
  STALL_OPPORTUNITY_DAYS,
  type WarmupAlertMailbox,
} from '../_shared/warmup-alerts.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';
import { fromAddress } from "../_shared/site-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const TRAFFIC_WINDOW_HOURS = 72;
const REALERT_HOURS = 24;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;

  try {
    const now = Date.now();
    const trafficCutoff = new Date(now - TRAFFIC_WINDOW_HOURS * 3600_000).toISOString();
    const realertCutoff = new Date(now - REALERT_HOURS * 3600_000).toISOString();
    const mailboxes = await fetchWarmupAlertPages<WarmupAlertMailbox>((from, to) =>
      supabase.from('email_mailboxes')
        .select('id, organization_id, email_address, status, warmup_last_send_at, warmup_stall_alerted_at, metadata, daily_limit, daily_sent, daily_sent_reset_at, warmup_max_daily, warmup_weekdays_only')
        .eq('warmup_enabled', true)
        .in('status', ['ready', 'warming', 'paused'])
        .order('id', { ascending: true })
        .range(from, to),
    );
    // Resting/manual-paused mailboxes remain outside stall alerts. Tenant transport
    // blocks are visible separately, including when the health job paused them.
    const monitored = mailboxes.filter((m) => ['ready', 'warming'].includes(m.status) || isWarmupTransportBlocked(m));
    const states = await loadWarmupAlertStates(supabase, monitored.map((m) => m.id));
    const groups = {
      stalled: [] as WarmupAlertMailbox[],
      capacity_waiting: [] as WarmupAlertMailbox[],
      transport_blocked: [] as WarmupAlertMailbox[],
      observing: [] as WarmupAlertMailbox[],
      participating: [] as WarmupAlertMailbox[],
    };
    for (const mailbox of monitored) groups[classifyWarmupMailbox(mailbox, states.get(mailbox.id))].push(mailbox);

    const enabledResult = await supabase.from('email_mailboxes')
      .select('id', { count: 'exact', head: true }).eq('warmup_enabled', true);
    if (enabledResult.error) throw new Error(`Failed to count warmup-enabled mailboxes: ${enabledResult.error.message}`);

    // These are calendar-window traffic metrics, separate from the opportunity-day
    // stall threshold. A bounced message was accepted by the sender's provider;
    // pending/failed records do not establish that the engine successfully sent.
    const countQueries = [
      supabase.from('email_warmup_sends').select('id', { count: 'exact', head: true })
        .gte('sent_at', trafficCutoff).in('status', ACCEPTED_WARMUP_STATUSES).eq('is_reply', false),
      supabase.from('email_warmup_sends').select('id', { count: 'exact', head: true })
        .gte('sent_at', trafficCutoff).in('status', ACCEPTED_WARMUP_STATUSES).eq('is_reply', true),
      supabase.from('email_warmup_sends').select('id', { count: 'exact', head: true })
        .gte('sent_at', trafficCutoff).eq('status', 'delivered'),
      supabase.from('email_warmup_sends').select('id', { count: 'exact', head: true })
        .gte('sent_at', trafficCutoff).eq('status', 'failed'),
      supabase.from('email_warmup_sends').select('id', { count: 'exact', head: true })
        .gte('sent_at', trafficCutoff).eq('status', 'bounced'),
    ];
    const countResults = await Promise.all(countQueries);
    for (const result of countResults) {
      if (result.error) throw new Error(`Failed to count warmup traffic: ${result.error.message}`);
    }
    const [acceptedOriginals, acceptedReplies, verifiedDelivered, failedAttempts, bounced] = countResults.map((r) => r.count ?? 0);
    const acceptedTraffic = acceptedOriginals + acceptedReplies;
    const capableWithHeadroom = monitored.filter(hasWarmupAlertHeadroom);
    const engineHealthDays = recentCompletedWarmupDays(new Date(now),
      !capableWithHeadroom.some((m) => m.warmup_weekdays_only === false));
    const completedDayFilters = engineHealthDays.map((day) => {
      const end = new Date(new Date(day).getTime() + 86400_000).toISOString();
      return `and(sent_at.gte.${day},sent_at.lt.${end})`;
    }).join(',');
    const healthTrafficResult = await supabase.from('email_warmup_sends')
      .select('id', { count: 'exact', head: true })
      .in('status', ACCEPTED_WARMUP_STATUSES).or(completedDayFilters);
    if (healthTrafficResult.error) throw new Error(`Failed to count engine-health traffic: ${healthTrafficResult.error.message}`);
    const engineHealthAcceptedTraffic = healthTrafficResult.count ?? 0;
    const neverSent = (m: WarmupAlertMailbox) => !states.get(m.id)?.last_activity_at;
    const neverSentTotal = monitored.filter(neverSent).length;
    const neverSentWaiting = groups.capacity_waiting.filter(neverSent).length;
    const neverSentObserving = groups.observing.filter(neverSent).length;
    const neverSentBlocked = groups.transport_blocked.filter(neverSent).length;
    const neverSentStalled = groups.stalled.filter(neverSent).length;
    const engineDown = isWarmupEngineDown(engineHealthAcceptedTraffic, acceptedTraffic, capableWithHeadroom.length);
    const alertCohort = engineDown ? capableWithHeadroom : groups.stalled;
    const fresh = alertCohort.filter((m) => !m.warmup_stall_alerted_at || m.warmup_stall_alerted_at < realertCutoff);
    const byOrg = new Map<string, number>();
    for (const m of groups.stalled) byOrg.set(m.organization_id, (byOrg.get(m.organization_id) ?? 0) + 1);
    const report = {
      success: true, dryRun,
      stalled: groups.stalled.length,
      neverSent: neverSentStalled, neverSentTotal, neverSentWaiting, neverSentObserving, neverSentBlocked,
      capacityWaiting: groups.capacity_waiting.length,
      transportBlocked: groups.transport_blocked.length,
      observing: groups.observing.length,
      participating: groups.participating.length,
      totalEnabled: enabledResult.count ?? 0,
      monitored: monitored.length,
      opportunityThresholdDays: STALL_OPPORTUNITY_DAYS,
      trafficWindowHours: TRAFFIC_WINDOW_HOURS,
      engineDown,
      engineHealthDays: engineHealthDays.map((day) => day.slice(0, 10)),
      engineHealthAcceptedTraffic,
      engineHealthCapableWithHeadroom: capableWithHeadroom.length,
      outageAffected: engineDown ? capableWithHeadroom.length : 0,
      sendsInWindow: acceptedTraffic,
      acceptedTraffic, acceptedOriginals, acceptedReplies, verifiedDelivered, failedAttempts, bounced,
      byOrganization: Object.fromEntries(byOrg),
      samples: Object.fromEntries(Object.entries(groups).map(([name, rows]) => [name, rows.slice(0, 20).map((m) => ({
        email: m.email_address,
        opportunityDays: states.get(m.id)?.opportunity_days ?? 0,
        eligibleDays: states.get(m.id)?.eligible_days ?? 0,
        reason: states.get(m.id)?.latest_reason ?? null,
        lastActivityAt: states.get(m.id)?.last_activity_at ?? null,
      }))])),
    };
    // Dry runs must neither send a digest nor mutate the alert cooldown.
    let emailSent = false;
    let alerted = 0;
    if (!dryRun && fresh.length > 0) {
      emailSent = await sendDigest({
        stalledCount: engineDown ? groups.stalled.length : fresh.length,
        outageAffected: engineDown ? fresh.length : 0,
        engineHealthDays: report.engineHealthDays,
        totalEnabled: report.totalEnabled,
        neverSent: fresh.filter(neverSent).length,
        acceptedTraffic, acceptedOriginals, acceptedReplies, verifiedDelivered, failedAttempts,
        capacityWaiting: report.capacityWaiting, observing: report.observing,
        transportBlocked: report.transportBlocked, engineDown,
        byOrg: fresh.reduce((orgs, m) => orgs.set(m.organization_id, (orgs.get(m.organization_id) ?? 0) + 1), new Map<string, number>()),
        samples: fresh.slice(0, 20).map((m) => m.email_address),
      });
      // Retain the daily retry policy even when the notification provider fails.
      const stamp = new Date(now).toISOString();
      for (let offset = 0; offset < fresh.length; offset += 200) {
        const { error } = await supabase.from('email_mailboxes')
          .update({ warmup_stall_alerted_at: stamp }).in('id', fresh.slice(offset, offset + 200).map((m) => m.id));
        if (error) throw new Error(`Failed to stamp warmup stall alerts: ${error.message}`);
      }
      alerted = fresh.length;
    }
    console.log(`[Warmup Alert] ${JSON.stringify({ ...report, samples: undefined, alerted, emailSent })}`);
    return json({ ...report, alerted, emailSent });
  } catch (error) {
    console.error('[Warmup Alert] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

interface DigestParams {
  stalledCount: number; totalEnabled: number; neverSent: number;
  outageAffected: number; engineHealthDays: string[];
  acceptedTraffic: number; acceptedOriginals: number; acceptedReplies: number;
  verifiedDelivered: number; failedAttempts: number;
  capacityWaiting: number; observing: number; transportBlocked: number;
  engineDown: boolean; byOrg: Map<string, number>; samples: string[];
}

async function sendDigest(p: DigestParams): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('WARMUP_ALERT_EMAIL') ?? Deno.env.get('OPS_ALERT_EMAIL');
  if (!apiKey || !to) {
    console.warn(`[Warmup Alert] Notification configuration missing; ${p.stalledCount} stalled, engineDown=${p.engineDown}`);
    return false;
  }
  const from = Deno.env.get('WARMUP_ALERT_FROM_EMAIL') ?? fromAddress("team", "ACA Infra");
  const subject = p.engineDown
    ? `[ACA] Warmup engine appears DOWN — no accepted traffic over ${STALL_OPPORTUNITY_DAYS} completed sending days`
    : `[ACA] ${p.stalledCount} warmup mailboxes missed ${STALL_OPPORTUNITY_DAYS} opportunity days`;
  const orgRows = [...p.byOrg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([org, n]) => `<tr><td><code>${escapeWarmupAlertHtml(org)}</code></td><td>${n}</td></tr>`).join('');
  const metrics = [
    ['Stalled mailboxes', p.stalledCount], ['Never sent in alert cohort', p.neverSent],
    ['Mailboxes affected by engine outage', p.outageAffected],
    ['Total warmup-enabled', p.totalEnabled],
    [`Provider-accepted originals (last ${TRAFFIC_WINDOW_HOURS}h)`, p.acceptedOriginals],
    [`Provider-accepted replies (last ${TRAFFIC_WINDOW_HOURS}h)`, p.acceptedReplies],
    [`Verified delivered (last ${TRAFFIC_WINDOW_HOURS}h)`, p.verifiedDelivered],
    [`Failed attempts (last ${TRAFFIC_WINDOW_HOURS}h)`, p.failedAttempts],
    ['Waiting for capacity / sending day', p.capacityWaiting],
    ['Observing / insufficient opportunity history', p.observing],
    ['Known transport blocks', p.transportBlocked],
  ];
  const html = `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:640px">
    <h1>${p.engineDown ? 'Warmup engine appears to be down' : 'Warmup stall detected'}</h1>
    <p>${p.engineDown ? `No provider-accepted warmup traffic on the last ${STALL_OPPORTUNITY_DAYS} completed UTC sending days (${p.engineHealthDays.join(', ')}), or in the last ${TRAFFIC_WINDOW_HOURS} calendar hours. Capable mailboxes still have warmup headroom. Check the send tick and transport logs; a stopped scheduler cannot record new opportunities.` : `${p.acceptedTraffic} provider-accepted messages (including replies) occurred in the last ${TRAFFIC_WINDOW_HOURS} calendar hours.`}</p>
    <p>${p.engineDown ? 'The engine outage cohort is separate from the per-mailbox stall count.' : `These mailboxes had ${STALL_OPPORTUNITY_DAYS} completed opportunity days without provider-accepted activity.`}
    Replies count as activity and have priority. Weekends and capacity deferrals do not count as missed opportunities.
    Capacity waiters and known transport blocks are reported separately.</p>
    <table>${metrics.map(([label, count]) => `<tr><td style="padding:4px 12px 4px 0">${label}</td><td>${count}</td></tr>`).join('')}</table>
    <h2>By organization</h2><table>${orgRows}</table>
    <h2>Sample ${p.engineDown ? 'affected' : 'stalled'} mailboxes</h2><p>${p.samples.map(escapeWarmupAlertHtml).join('<br>')}</p>
  </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: to.split(',').map((s) => s.trim()), subject, html }),
    });
    if (!res.ok) {
      console.error(`[Warmup Alert] Resend failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[Warmup Alert] Resend network error:', error);
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
