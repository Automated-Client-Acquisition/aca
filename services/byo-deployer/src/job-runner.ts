/**
 * Job runner — claims pending infra_byo_jobs rows and executes them.
 *
 * Two wake-up paths:
 *   1. PG NOTIFY 'infra_byo_job_created' — fired by the AFTER INSERT trigger.
 *   2. Periodic poll (every 30s) — picks up jobs that arrived during a brief
 *      LISTEN disconnection or jobs whose locked_until lease expired.
 *
 * Claim is atomic via UPDATE ... WHERE locked_until IS NULL OR locked_until < NOW()
 * RETURNING *.  Lease length: 5 minutes for v1 (well over connect-job runtime).
 */

import { Client as PgClient } from 'pg';
import { getSupabase } from './supabase.js';
import { dispatchJob, type JobLogFn } from './jobs/index.js';

const LEASE_SECONDS = 5 * 60;
const POLL_INTERVAL_MS = 30_000;
const LOG_FLUSH_INTERVAL_MS = 750;

type ClaimedJob = {
  id: string;
  job_type: string;
  organization_id: string;
  target_kind: string;
  target_id: string | null;
  input: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export class JobRunner {
  private pg: PgClient | null = null;
  private polling = false;
  private stopRequested = false;
  private busy = false;

  async start(): Promise<void> {
    const dbUrl = process.env.SUPABASE_DB_URL;
    if (!dbUrl) {
      console.warn('[job-runner] SUPABASE_DB_URL not set — running in poll-only mode');
    } else {
      await this.initListener(dbUrl);
    }
    this.startPolling();
    // Process any backlog that arrived before we connected.
    void this.processNext().catch((e) => console.error('[job-runner] initial drain failed', e));
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    try { await this.pg?.end(); } catch { /* ignore */ }
  }

  private async initListener(dbUrl: string): Promise<void> {
    this.pg = new PgClient({ connectionString: dbUrl });
    this.pg.on('error', (err) => {
      console.error('[job-runner] pg client error', err);
    });
    this.pg.on('notification', (msg) => {
      if (msg.channel !== 'infra_byo_job_created') return;
      void this.processNext().catch((e) => console.error('[job-runner] processNext failed', e));
    });
    await this.pg.connect();
    await this.pg.query("LISTEN infra_byo_job_created");
    console.log('[job-runner] LISTEN infra_byo_job_created — ready');
  }

  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    const tick = async () => {
      if (this.stopRequested) return;
      try { await this.processNext(); } catch (e) { console.error('[job-runner] poll tick failed', e); }
      if (!this.stopRequested) setTimeout(tick, POLL_INTERVAL_MS);
    };
    setTimeout(tick, POLL_INTERVAL_MS);
  }

  /**
   * Claim and run jobs in a loop until the queue is drained.
   */
  async processNext(): Promise<void> {
    if (this.busy) return; // serialize within this instance
    this.busy = true;
    try {
      while (!this.stopRequested) {
        const job = await this.claim();
        if (!job) return;
        await this.runOne(job);
      }
    } finally {
      this.busy = false;
    }
  }

  private async claim(): Promise<ClaimedJob | null> {
    const supabase = getSupabase();
    const leaseUntil = new Date(Date.now() + LEASE_SECONDS * 1000).toISOString();

    // Pick the oldest runnable pending job whose lease has expired or is null.
    const { data: candidates } = await supabase
      .from('infra_byo_jobs')
      .select('id')
      .in('status', ['pending'])
      .or(`locked_until.is.null,locked_until.lt.${new Date().toISOString()}`)
      .order('created_at', { ascending: true })
      .limit(1);

    if (!candidates || candidates.length === 0) return null;
    const candidateId = (candidates[0] as { id: string }).id;

    // Atomic claim via conditional update — if another worker grabbed it,
    // this returns 0 rows and we retry.
    const { data: claimed, error } = await supabase
      .from('infra_byo_jobs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        locked_until: leaseUntil,
      })
      .eq('id', candidateId)
      .eq('status', 'pending')
      .select('id, job_type, organization_id, target_kind, target_id, input, attempts, max_attempts')
      .maybeSingle();

    if (error || !claimed) return null;

    // Increment attempts on a follow-up update (no RPC needed). Read-then-write
    // race is acceptable here since only this worker holds the claim.
    const claimedRow = claimed as unknown as ClaimedJob;
    await supabase
      .from('infra_byo_jobs')
      .update({ attempts: (claimedRow.attempts ?? 0) + 1 })
      .eq('id', claimedRow.id);

    return claimedRow;
  }

  private async runOne(job: ClaimedJob): Promise<void> {
    const supabase = getSupabase();
    const buffer: string[] = [];
    let lastFlush = 0;
    let flushTimer: NodeJS.Timeout | null = null;

    const flush = async () => {
      if (buffer.length === 0) return;
      const lines = buffer.splice(0, buffer.length).join('\n');
      lastFlush = Date.now();
      const { data: row } = await supabase
        .from('infra_byo_jobs')
        .select('log')
        .eq('id', job.id)
        .maybeSingle();
      const prev = (row as { log: string | null } | null)?.log ?? '';
      await supabase
        .from('infra_byo_jobs')
        .update({ log: prev ? `${prev}\n${lines}` : lines })
        .eq('id', job.id);
    };

    const log: JobLogFn = async (line) => {
      const stamped = `${new Date().toISOString()} ${line}`;
      buffer.push(stamped);
      if (process.env.LOG_LEVEL !== 'silent') console.log(`[job ${job.id.slice(0, 8)}] ${line}`);
      if (Date.now() - lastFlush > LOG_FLUSH_INTERVAL_MS) {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        await flush();
      } else if (!flushTimer) {
        flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, LOG_FLUSH_INTERVAL_MS);
      }
    };

    let result;
    try {
      await log(`[runner] starting ${job.job_type} (attempt ${job.attempts + 1}/${job.max_attempts})`);
      result = await dispatchJob(supabase, {
        job_id: job.id,
        job_type: job.job_type,
        organization_id: job.organization_id,
        target_kind: job.target_kind,
        target_id: job.target_id,
        input: job.input ?? {},
      }, log);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log(`[runner] uncaught error: ${msg}`);
      result = { ok: false, error: msg };
    }

    // Final flush
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    await flush();

    const finalStatus = result.ok ? 'succeeded' : (job.attempts + 1 >= job.max_attempts ? 'failed' : 'pending');
    await supabase
      .from('infra_byo_jobs')
      .update({
        status: finalStatus,
        finished_at: finalStatus === 'pending' ? null : new Date().toISOString(),
        output: result.output ?? {},
        error_message: result.error ?? null,
        locked_until: finalStatus === 'pending' ? null : null,
      })
      .eq('id', job.id);
  }
}
