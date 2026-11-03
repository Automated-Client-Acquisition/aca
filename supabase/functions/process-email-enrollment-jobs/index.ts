// ============================================================================
// process-email-enrollment-jobs
// ----------------------------------------------------------------------------
// Runs background list enrollments (email_enrollment_jobs). Triggered by a
// pg_net kick when a job is created, and by a 1-minute cron as a safety net.
//
// One tick:
//   1. Claim a job (FOR UPDATE SKIP LOCKED + lease).
//   2. snapshotting → copy the audience into email_enrollment_job_members in
//      bounded SQL slices, then flip to running.
//   3. running → take the next 2,500 contact ids after `cursor` and POST them
//      to enroll-leads as a plain contactIds call (internal service-role
//      path), so every guard, mailbox assignment and schedule rule is the
//      same as any other enrollment. Sum its counts into `results`.
//   4. Stop after TICK_BUDGET_MS, release the lease and re-kick through
//      pg_net so the next tick starts right away from `cursor`. Pages are
//      idempotent upserts, so a crashed tick at worst re-sends one page.
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Contacts per enroll-leads call — the size the browser loop proved safe. */
const PAGE_SIZE = 2500;
/** Members copied per snapshot step; one keyset slice, well under 8s. */
const SNAPSHOT_SLICE = 20000;
/** Wall time one tick spends before handing over to the next cron minute. */
const TICK_BUDGET_MS = 100_000;
const LEASE_SECONDS = 180;
/** Consecutive failed pages before the job is marked failed. */
const MAX_ATTEMPTS = 5;

interface JobRow {
  id: string;
  organization_id: string;
  sequence_id: string;
  status: string;
  delay_hours: number | null;
  total: number;
  processed: number;
  cursor: string | null;
  results: Record<string, number>;
  attempts: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function addCounts(into: Record<string, number>, page: Record<string, unknown>) {
  const out = { ...into };
  for (const [key, value] of Object.entries(page)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const presented = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (presented !== serviceKey) return json({ error: 'Unauthorized' }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);
  const startedAt = Date.now();
  const timeLeft = () => TICK_BUDGET_MS - (Date.now() - startedAt);

  let body: { jobId?: string } = {};
  try { body = await req.json(); } catch { /* cron sends a body; tolerate none */ }

  const { data: claimed, error: claimErr } = await supabase.rpc('claim_email_enrollment_job', {
    p_lease_seconds: LEASE_SECONDS,
    p_job_id: body.jobId ?? null,
  });
  if (claimErr) {
    console.error('[enroll-jobs] claim failed', claimErr.message);
    return json({ ok: false, error: claimErr.message }, 500);
  }
  const job = (Array.isArray(claimed) ? claimed[0] : claimed) as JobRow | null;
  if (!job) return json({ ok: true, idle: true });

  const release = (patch: Record<string, unknown>) =>
    supabase.from('email_enrollment_jobs')
      .update({ ...patch, lease_until: null, updated_at: new Date().toISOString() })
      .eq('id', job.id);

  // Drop the audience snapshot in bounded deletes once a job is terminal.
  // Leftovers are harmless if the tick runs out of time here.
  const purge = async () => {
    for (let i = 0; i < 20; i++) {
      const { data: n, error } = await supabase.rpc('purge_email_enrollment_job_members', { p_job_id: job.id });
      if (error || !n) break;
    }
  };

  // Hand over to a fresh tick now instead of idling until the cron minute.
  const kick = async () => {
    const { error } = await supabase.rpc('kick_email_enrollment_job', { p_job_id: job.id });
    if (error) console.error(`[enroll-jobs] ${job.id} re-kick failed (cron will resume): ${error.message}`);
  };

  const fail = async (message: string, attempts: number) => {
    const terminal = attempts >= MAX_ATTEMPTS;
    console.error(`[enroll-jobs] ${job.id} attempt ${attempts}: ${message}${terminal ? ' (giving up)' : ''}`);
    await release({
      attempts,
      error_message: message.slice(0, 1000),
      ...(terminal ? { status: 'failed', completed_at: new Date().toISOString() } : {}),
    });
    if (terminal) await purge();
    return json({ ok: false, jobId: job.id, error: message }, terminal ? 200 : 500);
  };

  let status = job.status;
  let total = job.total;

  // ----- Snapshot -----
  while (status === 'snapshotting' && timeLeft() > 0) {
    const { data, error } = await supabase.rpc('snapshot_email_enrollment_job_step', {
      p_job_id: job.id,
      p_limit: SNAPSHOT_SLICE,
    });
    if (error) return fail(`snapshot: ${error.message}`, job.attempts + 1);
    const step = data as { done: boolean; total: number };
    total = step.total;
    if (step.done) status = 'running';
  }
  if (status === 'snapshotting') {
    await release({});
    await kick();
    return json({ ok: true, jobId: job.id, status, total });
  }
  console.log(`[enroll-jobs] ${job.id} audience snapshot: ${total} contacts`);

  // ----- Enroll pages -----
  let cursor = job.cursor;
  let processed = job.processed;
  let results = job.results ?? {};
  let pages = 0;

  while (timeLeft() > 0) {
    // Re-read status so a cancel from the UI lands before the next page.
    const { data: live, error: liveErr } = await supabase
      .from('email_enrollment_jobs').select('status').eq('id', job.id).single();
    if (liveErr) return fail(`status check: ${liveErr.message}`, job.attempts + 1);
    if (live.status !== 'running') {
      console.log(`[enroll-jobs] ${job.id} is ${live.status}; stopping`);
      await release({});
      await purge();
      return json({ ok: true, jobId: job.id, status: live.status, processed });
    }

    const { data: ids, error: pageErr } = await supabase.rpc('next_email_enrollment_job_page', {
      p_job_id: job.id,
      p_after: cursor,
      p_limit: PAGE_SIZE,
    });
    if (pageErr) return fail(`page read: ${pageErr.message}`, job.attempts + 1);
    const contactIds = (ids as string[] | null) ?? [];

    if (contactIds.length === 0) {
      await release({ status: 'completed', completed_at: new Date().toISOString(), attempts: 0, error_message: null });
      await purge();
      console.log(`[enroll-jobs] ${job.id} completed: ${JSON.stringify(results)}`);
      return json({ ok: true, jobId: job.id, status: 'completed', processed, results });
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/enroll-leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        sequenceId: job.sequence_id,
        organizationId: job.organization_id,
        contactIds,
        ...(job.delay_hours ? { delayHours: Number(job.delay_hours) } : {}),
      }),
    });
    const text = await res.text();
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(text); } catch { /* non-JSON gateway error */ }
    if (!res.ok || payload.error) {
      return fail(`enroll-leads ${res.status}: ${String(payload.error ?? text).slice(0, 300)}`, job.attempts + 1);
    }

    const { sourceCursor: _ignored, ...counts } = payload;
    results = addCounts(results, counts);
    cursor = contactIds[contactIds.length - 1];
    processed += contactIds.length;
    pages++;
    job.attempts = 0;

    const { error: saveErr } = await supabase.from('email_enrollment_jobs').update({
      cursor,
      processed,
      results,
      attempts: 0,
      error_message: null,
      lease_until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
    if (saveErr) return fail(`progress save: ${saveErr.message}`, 1);
  }

  await release({});
  await kick();
  console.log(`[enroll-jobs] ${job.id} tick: ${pages} page(s), ${processed}/${total}`);
  return json({ ok: true, jobId: job.id, processed, total, pages });
});
