/**
 * Ingestion Health Monitor (Cron — every 10 min)
 *
 * Watches the single-instance background workers for SILENT degradation — the
 * failure mode that redundancy can't catch and that actually hurt us (the
 * 1000-row mailbox-fetch cap polled 961 of 1666 mailboxes for days, dropping
 * ~700 mailboxes' replies, with nothing alerting).
 *
 * Checks:
 *   1. poller_stalled   — imap-poller heartbeat older than STALE_MINUTES (crash/stuck)
 *   2. coverage_gap     — poller is polling fewer M365 mailboxes than the live
 *                         pollable fleet (the cap-style bug)
 *   3. ingestion_quiet  — no inbound email landed in crm_messages for INGEST_STALE_MINUTES
 *
 * Alerts via Resend to OPS_ALERT_EMAIL. State (for cooldown + recovery emails)
 * lives in worker_heartbeats under worker='monitor-ingestion-health'.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';
import { OPS_ALERT_EMAIL, fromAddress } from "../_shared/site-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Thresholds
const STALE_MINUTES = 30;          // a full Graph sweep blocks the loop ~14 min, so beats
                                   // land ~every 14-15 min; 30 min tolerates one missed
                                   // cycle and only fires on a genuine stall/crash.
const COVERAGE_MIN_RATIO = 0.95;   // alert if polling < 95% of the pollable fleet
const COVERAGE_MIN_ABS_GAP = 10;   // ...and the gap is at least this many mailboxes (ignore tiny churn)
const INGEST_STALE_MINUTES = 180;  // no inbound email in 3h (conservative — replies span timezones)
const RE_ALERT_HOURS = 4;          // re-send an alert at most this often while still unhealthy

const MONITOR_KEY = 'monitor-ingestion-health';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

interface Issue { code: string; severity: 'critical' | 'warning'; message: string; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const issues: Issue[] = [];
  const facts: Record<string, unknown> = {};

  try {
    // --- 1 & 2: poller liveness + coverage --------------------------------
    const { data: beat } = await supabase
      .from('worker_heartbeats')
      .select('last_run_at, metrics')
      .eq('worker', 'imap-poller')
      .maybeSingle();

    const beatAgeMin = minutesSince(beat?.last_run_at);
    facts.poller_last_run_at = beat?.last_run_at ?? null;
    facts.poller_age_min = beatAgeMin === null ? null : Math.round(beatAgeMin);

    if (!beat || beatAgeMin === null) {
      issues.push({ code: 'poller_no_heartbeat', severity: 'critical',
        message: 'imap-poller has never written a heartbeat (not deployed, or DB write failing).' });
    } else if (beatAgeMin > STALE_MINUTES) {
      issues.push({ code: 'poller_stalled', severity: 'critical',
        message: `imap-poller last beat ${Math.round(beatAgeMin)} min ago (> ${STALE_MINUTES} min). Worker is down or stuck — inbound replies are not being ingested.` });
    } else {
      // Worker is alive — check coverage against the live pollable fleet.
      const m365Polled = Number((beat.metrics as any)?.m365_total ?? 0);
      const { count: m365Pollable } = await supabase
        .from('email_mailboxes')
        .select('id', { count: 'exact', head: true })
        .in('status', ['ready', 'active', 'warming'])
        .eq('imap_connected', true)
        .eq('connection_type', 'm365');

      const pollable = m365Pollable ?? 0;
      facts.m365_polled = m365Polled;
      facts.m365_pollable = pollable;

      const gap = pollable - m365Polled;
      if (pollable > 0 && gap >= COVERAGE_MIN_ABS_GAP && m365Polled < pollable * COVERAGE_MIN_RATIO) {
        issues.push({ code: 'coverage_gap', severity: 'critical',
          message: `imap-poller is polling ${m365Polled} of ${pollable} pollable M365 mailboxes — ${gap} mailboxes (~${Math.round((gap / pollable) * 100)}%) are not being polled, so their replies never reach the system.` });
      }
    }

    // --- 3: inbound ingestion freshness -----------------------------------
    const { data: lastInbound } = await supabase
      .from('crm_messages')
      .select('created_at, crm_conversations!inner(channel)')
      .eq('direction', 'inbound')
      .eq('crm_conversations.channel', 'email')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const inboundAgeMin = minutesSince(lastInbound?.created_at);
    facts.last_inbound_at = lastInbound?.created_at ?? null;
    facts.last_inbound_age_min = inboundAgeMin === null ? null : Math.round(inboundAgeMin);

    if (inboundAgeMin !== null && inboundAgeMin > INGEST_STALE_MINUTES) {
      issues.push({ code: 'ingestion_quiet', severity: 'warning',
        message: `No inbound email ingested for ${Math.round(inboundAgeMin)} min (> ${INGEST_STALE_MINUTES} min). Could be a genuine quiet period, but combined with other signals may indicate an ingestion stall.` });
    }

    // --- Decide + alert with cooldown/recovery ----------------------------
    const healthy = issues.length === 0;
    const status = healthy ? 'healthy' : 'unhealthy';

    const { data: prior } = await supabase
      .from('worker_heartbeats')
      .select('metrics')
      .eq('worker', MONITOR_KEY)
      .maybeSingle();
    const priorMeta = (prior?.metrics as any) || {};
    const priorStatus: string = priorMeta.status || 'healthy';
    const lastAlertAgeMin = minutesSince(priorMeta.last_alert_at);

    let alerted = false;
    let recovered = false;

    if (!healthy) {
      const due = lastAlertAgeMin === null || lastAlertAgeMin > RE_ALERT_HOURS * 60;
      if (due) {
        alerted = await sendAlert('alert', issues, facts);
      }
    } else if (priorStatus === 'unhealthy') {
      recovered = await sendAlert('recovery', [], facts);
    }

    const nowISO = new Date().toISOString();
    const newMeta: Record<string, unknown> = {
      status,
      issues: issues.map((i) => i.code),
      facts,
      last_alert_at: alerted ? nowISO : (priorMeta.last_alert_at ?? null),
    };
    await supabase.from('worker_heartbeats').upsert({
      worker: MONITOR_KEY, last_run_at: nowISO, updated_at: nowISO, metrics: newMeta,
    }, { onConflict: 'worker' });

    return jsonResponse({ status, issues, facts, alerted, recovered });
  } catch (err) {
    console.error('[monitor-ingestion-health] error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

async function sendAlert(kind: 'alert' | 'recovery', issues: Issue[], facts: Record<string, unknown>): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = OPS_ALERT_EMAIL;
  if (!apiKey) {
    console.warn('[monitor-ingestion-health] RESEND_API_KEY missing — skipping email');
    return false;
  }
  const from = Deno.env.get('OPS_ALERT_FROM_EMAIL')
    ?? fromAddress("team", "ACA Ops");

  const factsHtml = `<pre style="background:#f6f8fa;padding:12px;border-radius:6px;font-size:13px;overflow:auto">${
    escapeHtml(JSON.stringify(facts, null, 2))}</pre>`;

  let subject: string;
  let html: string;
  if (kind === 'recovery') {
    subject = '✅ Ingestion health recovered';
    html = `<div style="font-family:system-ui,sans-serif;max-width:640px">
      <h2 style="color:#16a34a">Inbound ingestion is healthy again</h2>
      <p>The previously-reported issue with the inbound reply pipeline has cleared.</p>
      ${factsHtml}</div>`;
  } else {
    const critical = issues.filter((i) => i.severity === 'critical').length;
    subject = `${critical > 0 ? '🚨' : '⚠️'} Ingestion health: ${issues.map((i) => i.code).join(', ')}`;
    const items = issues.map((i) =>
      `<li><strong>${i.severity === 'critical' ? '🚨' : '⚠️'} ${i.code}</strong> — ${escapeHtml(i.message)}</li>`).join('');
    html = `<div style="font-family:system-ui,sans-serif;max-width:640px">
      <h2 style="color:#dc2626">Inbound ingestion needs attention</h2>
      <ul style="line-height:1.6">${items}</ul>
      <p style="color:#666">Worker: <code>aca-imap-poller</code> (Fly). Replies are not lost — they stay in the mailboxes and resume from durable delta tokens once the worker recovers — but they are not reaching the inbox until then.</p>
      ${factsHtml}
      <p style="color:#888;font-size:12px">You'll get at most one alert every ${RE_ALERT_HOURS}h while this persists, and a recovery email when it clears.</p></div>`;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error('[monitor-ingestion-health] Resend failed:', res.status, await res.text());
      return false;
    }
    console.log(`[monitor-ingestion-health] ${kind} email sent to ${to}`);
    return true;
  } catch (e) {
    console.error('[monitor-ingestion-health] Resend network error:', e);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
