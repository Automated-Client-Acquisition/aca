/**
 * Supabase persistence for the signal engine worker.
 *
 * The worker only ever writes raw intake (signal_observations, ats_job_snapshots)
 * and run telemetry (signal_engine_runs). It never touches signal_events or
 * company_identities — those belong to the refinery ticks. That split is what
 * lets a collector be re-run at any time without risk.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RawObservation, SignalSource } from './types.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function loadDueSources(kind: string, limit = 50): Promise<SignalSource[]> {
  const { data, error } = await db()
    .from('signal_sources')
    .select('*')
    .eq('kind', kind)
    .eq('enabled', true)
    .order('last_run_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`loadDueSources(${kind}): ${error.message}`);
  return (data ?? []) as SignalSource[];
}

export async function upsertSource(row: {
  kind: string;
  collector_key: string;
  external_key: string;
  label: string;
  config?: Record<string, unknown>;
}): Promise<SignalSource> {
  const { data, error } = await db()
    .from('signal_sources')
    .upsert(
      { ...row, config: row.config ?? {} },
      { onConflict: 'collector_key,external_key', ignoreDuplicates: false },
    )
    .select('*')
    .single();
  if (error) throw new Error(`upsertSource: ${error.message}`);
  return data as SignalSource;
}

/**
 * Record the outcome of polling one source.
 *
 * `consecutive_empty_runs` is the health signal that matters. A run returning
 * nothing is normal on a quiet day; twenty in a row means the feed moved, the
 * parser broke, or the board was deleted. Counting it here is what makes that
 * detectable without a human noticing the absence of something.
 */
export async function markSourceRun(
  sourceId: string,
  outcome: { empty: boolean; error?: string | null; cursor?: Record<string, unknown> },
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { last_run_at: now, updated_at: now };

  if (outcome.error) {
    patch.last_error = outcome.error.slice(0, 1000);
  } else {
    patch.last_success_at = now;
    patch.last_error = null;
    if (outcome.cursor) patch.cursor = outcome.cursor;
  }

  const { error } = await db().from('signal_sources').update(patch).eq('id', sourceId);
  if (error) throw new Error(`markSourceRun: ${error.message}`);

  // Counters are relative, so they go through an RPC-free read-modify-write.
  // Contention is not a concern: one collector owns a source at a time.
  const { data } = await db()
    .from('signal_sources')
    .select('consecutive_empty_runs, consecutive_failures')
    .eq('id', sourceId)
    .maybeSingle();

  const emptyRuns = outcome.error
    ? (data?.consecutive_empty_runs ?? 0)
    : outcome.empty
      ? (data?.consecutive_empty_runs ?? 0) + 1
      : 0;
  const failures = outcome.error ? (data?.consecutive_failures ?? 0) + 1 : 0;

  await db()
    .from('signal_sources')
    .update({ consecutive_empty_runs: emptyRuns, consecutive_failures: failures })
    .eq('id', sourceId);
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export interface WriteStats {
  written: number;
  duplicate: number;
}

export interface GoogleNewsEvidenceCandidate {
  id: string;
  source_url: string;
  structured: Record<string, unknown>;
}

/**
 * The worker is the only environment Google permits to resolve its article
 * wrappers reliably. Keep this bounded so a collection sweep cannot turn into
 * an unbounded secondary crawl.
 */
export async function loadUnresolvedGoogleNewsEvidence(limit: number): Promise<GoogleNewsEvidenceCandidate[]> {
  // Only observations backing an event that is still waiting to publish are
  // worth a resolution. The old "newest wrappers overall" query spent the
  // budget on rows that were skipped at extraction and can never publish, and
  // its short window filled with rows inside their retry cooldown.
  const { data: events, error: eventsError } = await db()
    .from('signal_events')
    .select('observation_ids')
    .is('public_signal_id', null)
    .in('publish_status', ['pending', 'failed'])
    .neq('event_type', 'hiring')
    .order('occurred_at', { ascending: false })
    .limit(200);
  if (eventsError) throw new Error(`loadUnresolvedGoogleNewsEvidence events: ${eventsError.message}`);
  const ids = Array.from(new Set(((events ?? []) as Array<{ observation_ids: string[] | null }>)
    .flatMap((event) => event.observation_ids ?? []))).slice(0, 400);
  if (ids.length === 0) return [];

  // 400 UUIDs in one `in.()` overflows the PostgREST URL limit, so chunk.
  const rows: GoogleNewsEvidenceCandidate[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await db()
      .from('signal_observations')
      .select('id,source_url,structured')
      .in('id', ids.slice(i, i + 50))
      .eq('collector_key', 'google_news_rss')
      .like('source_url', 'https://news.google.com/%');
    if (error) throw new Error(`loadUnresolvedGoogleNewsEvidence: ${error.message}`);
    rows.push(...((data ?? []) as GoogleNewsEvidenceCandidate[]));
  }
  const now = Date.now();
  return rows.filter((candidate) => {
    const attemptedAt = candidate.structured?.canonical_resolution_attempted_at;
    return typeof attemptedAt !== 'string' || now - new Date(attemptedAt).getTime() >= 6 * 60 * 60 * 1000;
  }).slice(0, limit);
}

export async function saveGoogleNewsResolution(
  candidate: GoogleNewsEvidenceCandidate,
  outcome: { url: string | null; reason: string },
): Promise<void> {
  const attemptedAt = new Date().toISOString();
  const structured = {
    ...candidate.structured,
    canonical_resolution_attempted_at: attemptedAt,
    canonical_resolution_reason: outcome.reason,
    canonical_resolution_url: outcome.url,
  };
  const { error } = await db().from('signal_observations').update({
    source_url: outcome.url ?? candidate.source_url,
    structured,
    updated_at: attemptedAt,
  }).eq('id', candidate.id);
  if (error) throw new Error(`saveGoogleNewsResolution: ${error.message}`);
}

/**
 * Insert observations, ignoring ones we already hold.
 *
 * ignoreDuplicates + select() means the returned rows are exactly the NEW ones,
 * so the duplicate count falls out for free. That count is genuinely useful: a
 * collector reporting 100% duplicates every run is polling correctly but the
 * cursor is not advancing.
 */
export async function writeObservations(
  source: SignalSource,
  observations: RawObservation[],
): Promise<WriteStats> {
  if (observations.length === 0) return { written: 0, duplicate: 0 };

  const rows = observations.map((o) => ({
    source_id: source.id,
    collector_key: source.collector_key,
    external_id: o.external_id,
    source_url: o.source_url ?? null,
    title: o.title ?? null,
    body_text: o.body_text ?? null,
    structured: o.structured ?? null,
    entity_hints: o.entity_hints ?? {},
    event_type: o.event_type ?? null,
    published_at: o.published_at ?? null,
    // Structured sources skip LLM extraction entirely — mark them ready for
    // resolution so the extract tick never sees them and never bills for them.
    status: o.structured && !o.body_text ? 'extracted' : 'pending',
    extracted: o.structured && !o.body_text ? o.structured : null,
  }));

  const { data, error } = await db()
    .from('signal_observations')
    .upsert(rows, { onConflict: 'source_id,external_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`writeObservations: ${error.message}`);

  const written = data?.length ?? 0;
  return { written, duplicate: observations.length - written };
}

// ---------------------------------------------------------------------------
// Run telemetry
// ---------------------------------------------------------------------------

export async function startRun(collectorKey: string, sourceId?: string): Promise<string> {
  const { data, error } = await db()
    .from('signal_engine_runs')
    .insert({ collector_key: collectorKey, source_id: sourceId ?? null, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`startRun: ${error.message}`);
  return data.id as string;
}

export async function finishRun(
  runId: string,
  outcome: {
    status: 'success' | 'failed';
    written?: number;
    duplicate?: number;
    error?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db()
    .from('signal_engine_runs')
    .update({
      status: outcome.status,
      finished_at: new Date().toISOString(),
      observations_written: outcome.written ?? 0,
      observations_duplicate: outcome.duplicate ?? 0,
      error: outcome.error ? outcome.error.slice(0, 2000) : null,
      meta: outcome.meta ?? {},
    })
    .eq('id', runId);
}

/** Persistent liveness beat consumed by ACA's ingestion-health monitor. */
export async function writeWorkerHeartbeat(metrics: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db().from('worker_heartbeats').upsert({
    worker: 'signal-engine',
    last_run_at: now,
    updated_at: now,
    metrics,
  }, { onConflict: 'worker' });
  if (error) throw new Error(`writeWorkerHeartbeat: ${error.message}`);
}

// ---------------------------------------------------------------------------
// ATS boards
// ---------------------------------------------------------------------------

export interface AtsBoard {
  id: string;
  company_identity_id: string | null;
  provider: string;
  token: string;
  board_url: string | null;
  active: boolean;
  last_job_count: number | null;
  last_checked_at: string | null;
  consecutive_failures: number;
}

export async function loadDueBoards(limit: number): Promise<AtsBoard[]> {
  const { data, error } = await db()
    .from('ats_boards')
    .select('id, company_identity_id, provider, token, board_url, active, last_job_count, last_checked_at, consecutive_failures')
    .eq('active', true)
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`loadDueBoards: ${error.message}`);
  return (data ?? []) as AtsBoard[];
}

export async function latestSnapshotJobIds(boardId: string): Promise<string[] | null> {
  const { data, error } = await db()
    .from('ats_job_snapshots')
    .select('job_ids')
    .eq('board_id', boardId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`latestSnapshotJobIds: ${error.message}`);
  return data ? ((data.job_ids ?? []) as string[]) : null;
}

export async function writeSnapshot(row: {
  board_id: string;
  job_count: number;
  job_ids: string[];
  new_job_ids: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await db().from('ats_job_snapshots').insert({ ...row, meta: row.meta ?? {} });
  if (error) throw new Error(`writeSnapshot: ${error.message}`);
}

export async function markBoardChecked(
  boardId: string,
  outcome: { jobCount?: number; error?: string | null; deactivate?: boolean },
): Promise<void> {
  const patch: Record<string, unknown> = {
    last_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (outcome.error) {
    patch.last_error = outcome.error.slice(0, 1000);
  } else {
    patch.last_error = null;
    patch.consecutive_failures = 0;
    if (typeof outcome.jobCount === 'number') patch.last_job_count = outcome.jobCount;
  }
  if (outcome.deactivate) patch.active = false;

  await db().from('ats_boards').update(patch).eq('id', boardId);

  if (outcome.error) {
    const { data } = await db()
      .from('ats_boards')
      .select('consecutive_failures')
      .eq('id', boardId)
      .maybeSingle();
    const failures = (data?.consecutive_failures ?? 0) + 1;
    // A board that has failed repeatedly is almost always gone for good (the
    // company churned off that ATS). Park it rather than re-checking forever.
    await db()
      .from('ats_boards')
      .update({ consecutive_failures: failures, active: failures < 10 })
      .eq('id', boardId);
  }
}
