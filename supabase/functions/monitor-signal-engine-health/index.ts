/**
 * Signal Engine Health Monitor (Cron — hourly)
 *
 * Watches the native signal engine's OUTPUT, not its crons. Every cron reports
 * "succeeded" even when nothing useful happens, and that is how three separate
 * failures hid for days: EDGAR silently wrote nothing for 11 days, the publish
 * tick's window filled with events that could never progress, and the
 * verification budget was spent on events in retry cooldown.
 *
 * Checks (thresholds sit just past each job's normal cadence):
 *   news_stalled         no Google News observation written in NEWS_STALE_H
 *   ats_stalled          ATS sweep has not succeeded in ATS_STALE_H
 *   edgar_run_stalled    EDGAR sources have not succeeded in EDGAR_RUN_STALE_H
 *   edgar_silent         cron runs fine but no filing written in EDGAR_SILENT_H
 *                        (covers a long weekend; the Sept 8-19 outage looked like this)
 *   publish_stalled      nothing published in PUBLISH_STALE_H
 *   resolve_stalled      link-resolution backlog exists but no attempt in RESOLVE_STALE_H
 *   identity_resolution_stalled  untouched extracted observations wait while
 *                        identity resolution/merge produces no progress
 *   verify_stalled       verification backlog exists but no attempt in VERIFY_STALE_H
 *   failed_events        publish failures piling up
 *
 * Alerts via Resend to OPS_ALERT_EMAIL with cooldown and a recovery email.
 * State lives in worker_heartbeats under worker='monitor-signal-engine-health'.
 * Queries live in the signal_engine_health_snapshot() SQL function.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { OPS_ALERT_EMAIL, fromAddress } from "../_shared/site-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const NEWS_STALE_H = 6;          // collector runs every 2h and dedupes ~90% of rows
const ATS_STALE_H = 6;           // runs every 2h
const EDGAR_RUN_STALE_H = 4;     // runs hourly
const EDGAR_SILENT_H = 96;       // Friday filings -> Monday, plus a holiday
const PUBLISH_STALE_H = 12;
const RESOLVE_STALE_H = 6;
const IDENTITY_RESOLUTION_STALE_H = 6;
const VERIFY_STALE_H = 3;
const BACKLOG_MIN = 20;          // ignore tiny backlogs
const FAILED_EVENTS_MAX = 20;
const RE_ALERT_HOURS = 6;

const MONITOR_KEY = 'monitor-signal-engine-health';

interface Issue { code: string; severity: 'critical' | 'warning'; message: string }

type Snapshot = Record<string, number | null>;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

const fmt = (h: number | null | undefined) => (h == null ? 'never' : `${h.toFixed(1)}h ago`);

export function evaluateSnapshot(s: Snapshot): Issue[] {
  const issues: Issue[] = [];
  const older = (v: number | null | undefined, limit: number) => v == null || v > limit;

  if (older(s.news_obs_age_h, NEWS_STALE_H)) {
    issues.push({ code: 'news_stalled', severity: 'critical',
      message: `No Google News observation written since ${fmt(s.news_obs_age_h)} (limit ${NEWS_STALE_H}h). Check the signal-engine-news cron and the Fly worker.` });
  }
  if (older(s.ats_run_age_h, ATS_STALE_H)) {
    issues.push({ code: 'ats_stalled', severity: 'critical',
      message: `ATS sweep last succeeded ${fmt(s.ats_run_age_h)} (limit ${ATS_STALE_H}h).` });
  }
  if (older(s.edgar_run_age_h, EDGAR_RUN_STALE_H)) {
    issues.push({ code: 'edgar_run_stalled', severity: 'critical',
      message: `EDGAR sources last succeeded ${fmt(s.edgar_run_age_h)} (limit ${EDGAR_RUN_STALE_H}h).` });
  }
  if (older(s.edgar_form_d_obs_age_h, EDGAR_SILENT_H) || older(s.edgar_8k_obs_age_h, EDGAR_SILENT_H)) {
    issues.push({ code: 'edgar_silent', severity: 'critical',
      message: `EDGAR cron is succeeding but no filing has been written for Form D (${fmt(s.edgar_form_d_obs_age_h)}) / 8-K (${fmt(s.edgar_8k_obs_age_h)}); limit ${EDGAR_SILENT_H}h. Same signature as the Sept 8-19 outage: the collector is reading an empty date window.` });
  }
  if (older(s.last_publish_age_h, PUBLISH_STALE_H)) {
    issues.push({ code: 'publish_stalled', severity: 'critical',
      message: `Nothing published in ${fmt(s.last_publish_age_h)} (limit ${PUBLISH_STALE_H}h). Check signal-publish-tick output: considered vs awaitingEvidenceVerification.` });
  }
  if ((s.resolve_backlog ?? 0) >= BACKLOG_MIN && older(s.resolve_last_attempt_age_h, RESOLVE_STALE_H)) {
    issues.push({ code: 'resolve_stalled', severity: 'warning',
      message: `${s.resolve_backlog} events wait on Google link resolution but the last attempt was ${fmt(s.resolve_last_attempt_age_h)} (limit ${RESOLVE_STALE_H}h).` });
  }
  // A free-only pass deliberately leaves attempts at zero for unknown domains.
  // The snapshot counts only claimable rows with no recorded outcome (error IS
  // NULL), so those legitimate retry rows do not look like a resolver outage.
  // Wait for the backlog itself to age as well: a fresh batch after a quiet
  // period is not stalled just because the previous success was yesterday.
  if ((s.identity_resolution_backlog ?? 0) >= BACKLOG_MIN
    && s.identity_resolution_oldest_pending_age_h != null
    && s.identity_resolution_oldest_pending_age_h > IDENTITY_RESOLUTION_STALE_H
    && older(s.identity_resolution_last_progress_age_h, IDENTITY_RESOLUTION_STALE_H)) {
    issues.push({ code: 'identity_resolution_stalled', severity: 'critical',
      message: `${s.identity_resolution_backlog} claimable extracted observations have no identity-resolution outcome; the oldest arrived ${fmt(s.identity_resolution_oldest_pending_age_h)} and the last merged event was ${fmt(s.identity_resolution_last_progress_age_h)} (limit ${IDENTITY_RESOLUTION_STALE_H}h). Check signal-resolve-tick queue fairness: free-only retries must not starve untouched observations.` });
  }
  if ((s.verify_backlog ?? 0) >= BACKLOG_MIN && older(s.verify_last_attempt_age_h, VERIFY_STALE_H)) {
    issues.push({ code: 'verify_stalled', severity: 'critical',
      message: `${s.verify_backlog} events wait on publisher verification but the last attempt was ${fmt(s.verify_last_attempt_age_h)} (limit ${VERIFY_STALE_H}h). The verification budget may be spent on events in cooldown.` });
  }
  if ((s.failed_events ?? 0) > FAILED_EVENTS_MAX) {
    issues.push({ code: 'failed_events', severity: 'warning',
      message: `${s.failed_events} signal events are in publish_status=failed (limit ${FAILED_EVENTS_MAX}). See signal_events.publish_error.` });
  }
  return issues;
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    try {
      const { data: snapshot, error } = await supabase.rpc('signal_engine_health_snapshot');
      if (error) throw new Error(`snapshot failed: ${error.message}`);
      const facts = (snapshot ?? {}) as Snapshot;
      const issues = evaluateSnapshot(facts);

      const healthy = issues.length === 0;
      const status = healthy ? 'healthy' : 'unhealthy';

      const { data: prior } = await supabase
        .from('worker_heartbeats')
        .select('metrics')
        .eq('worker', MONITOR_KEY)
        .maybeSingle();
      const priorMeta = (prior?.metrics as { status?: string; last_alert_at?: string | null } | null) || {};
      const priorStatus: string = priorMeta.status || 'healthy';
      const lastAlertAgeH = hoursSince(priorMeta.last_alert_at);

      let alerted = false;
      let recovered = false;
      if (!healthy) {
        if (lastAlertAgeH === null || lastAlertAgeH > RE_ALERT_HOURS) {
          alerted = await sendAlert('alert', issues, facts);
        }
      } else if (priorStatus === 'unhealthy') {
        recovered = await sendAlert('recovery', [], facts);
      }

      const nowISO = new Date().toISOString();
      await supabase.from('worker_heartbeats').upsert({
        worker: MONITOR_KEY,
        last_run_at: nowISO,
        updated_at: nowISO,
        metrics: {
          status,
          issues: issues.map((i) => i.code),
          facts,
          last_alert_at: alerted ? nowISO : (priorMeta.last_alert_at ?? null),
        },
      }, { onConflict: 'worker' });

      return jsonResponse({ status, issues, facts, alerted, recovered });
    } catch (err) {
      console.error('[monitor-signal-engine-health] error:', err);
      return jsonResponse({ error: (err as Error).message }, 500);
    }
  });
}

async function sendAlert(kind: 'alert' | 'recovery', issues: Issue[], facts: Snapshot): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = OPS_ALERT_EMAIL;
  if (!apiKey) {
    console.warn('[monitor-signal-engine-health] RESEND_API_KEY missing — skipping email');
    return false;
  }
  const from = Deno.env.get('OPS_ALERT_FROM_EMAIL')
    ?? fromAddress("team", "ACA Ops");

  const factsHtml = `<pre style="background:#f6f8fa;padding:12px;border-radius:6px;font-size:13px;overflow:auto">${
    escapeHtml(JSON.stringify(facts, null, 2))}</pre>`;

  let subject: string;
  let html: string;
  if (kind === 'recovery') {
    subject = '✅ Signal engine health recovered';
    html = `<div style="font-family:system-ui,sans-serif;max-width:640px">
      <h2 style="color:#16a34a">The signal engine is healthy again</h2>
      <p>The previously reported issue has cleared.</p>${factsHtml}</div>`;
  } else {
    const critical = issues.filter((i) => i.severity === 'critical').length;
    subject = `${critical > 0 ? '🚨' : '⚠️'} Signal engine: ${issues.map((i) => i.code).join(', ')}`;
    const items = issues.map((i) =>
      `<li><strong>${i.severity === 'critical' ? '🚨' : '⚠️'} ${i.code}</strong> — ${escapeHtml(i.message)}</li>`).join('');
    html = `<div style="font-family:system-ui,sans-serif;max-width:640px">
      <h2 style="color:#dc2626">The signal engine needs attention</h2>
      <ul style="line-height:1.6">${items}</ul>
      <p style="color:#666">Pipeline: Fly <code>aca-signal-engine</code> collectors, then resolve/merge ticks, then <code>signal-publish-tick</code>. Public signals for the affected types are not being refreshed until this clears.</p>
      ${factsHtml}
      <p style="color:#888;font-size:12px">At most one alert every ${RE_ALERT_HOURS}h while this persists, and a recovery email when it clears.</p></div>`;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error('[monitor-signal-engine-health] Resend failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('[monitor-signal-engine-health] Resend network error:', e);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
