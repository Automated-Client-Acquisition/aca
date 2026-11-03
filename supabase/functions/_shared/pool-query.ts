import { poolQueryWorkerUrl } from "./site-config.ts";
/**
 * Shared access to the 123M-row B2B lead pool.
 *
 * The pool lives behind a Fly query worker that only accepts HMAC-signed
 * requests, so an edge function is the only thing that can reach it. This module
 * holds the signing and the selectivity guard so the public REST surface
 * (`api-pool`) enforces exactly the same limits as the dashboard path
 * (`list-building-pool-search`).
 *
 * The guard is the whole design. An unfiltered query against 123M rows is a
 * table scan no index rescues, so a query that cannot be bounded is rejected
 * before it is ever sent — cheaply, with a message naming the predicate to add.
 * Speed here comes from refusing bad queries, not from clever planning.
 */

const WORKER_HMAC_SECRET = Deno.env.get('POOL_QUERY_WORKER_SECRET');

/** Filter accepted by the pool worker. Mirrors list-building-pool-search. */
export interface PoolFilter {
  keyword?: string;
  /** Not supported — the pool has no country column. Rejected; use `state`. */
  country?: string;
  city?: string;
  state?: string;
  industry_pattern?: string;
  industry_exact?: string;
  p_bucket?: string;
  sic_code_in?: string[];
  match_combinator?: 'and' | 'or';
  /** Bucket FLOOR in the dump, not a headcount, and wrong ~71% of the time.
   *  Prefer v_employees_* — see project_pool_employee_buckets_unreliable. */
  employees_min?: number;
  employees_max?: number;
  /** Verified filters, re-derived from primary sources. */
  v_category_in?: string[];
  v_confidence_in?: string[];
  v_employees_min?: number;
  v_employees_max?: number;
  v_revenue_in?: string[];
  v_email_risk_in?: string[];
  v_has_fresh_email?: boolean;
  v_still_there?: boolean;
  verified_only?: boolean;
  seniority_in?: string[];
  has_linkedin?: boolean;
  has_phone?: boolean;
  email_status?: string;
  dedup_by_email?: boolean;
  limit?: number;
  offset?: number;
}

export class PoolError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Rows a single preview may return. Previews are for judging a filter, not bulk export. */
export const MAX_PREVIEW_LIMIT = 100;

/**
 * Reject a filter the pool cannot actually apply.
 *
 * `country` has no backing column in the current pool, so it was dropped in
 * silence by the worker — while still satisfying the selectivity guard below.
 * The combination is the worst of both: {country, employees_min} was accepted
 * as a bounded query and then ran with no geographic restriction whatsoever, so
 * a caller asking for the United States got whatever the rest of the filter
 * matched, worldwide. A filter that cannot run must fail loudly, not quietly.
 */
export function assertSupported(filter: PoolFilter): void {
  if (filter.country) {
    throw new PoolError(
      'country is not a supported pool filter — the pool has no country column, so it would ' +
        'match every row regardless of geography rather than narrowing to that country. ' +
        "Use state (US 2-letter code, e.g. 'TX') or city instead.",
    );
  }
}

/**
 * Reject a filter that cannot be bounded.
 *
 * Deliberately identical to the guard in list-building-pool-search: at least one
 * of an industry filter, a keyword of two or more characters, or a state paired
 * with a minimum company size.
 */
export function assertSelective(filter: PoolFilter): void {
  const hasIndustry = Boolean(
    filter.industry_pattern ||
      filter.industry_exact ||
      filter.p_bucket ||
      (filter.sic_code_in && filter.sic_code_in.length > 0),
  );
  const hasKeyword = typeof filter.keyword === 'string' && filter.keyword.trim().length >= 2;
  // `state` only — `country` is rejected by assertSupported precisely because
  // it counted toward this bound while restricting nothing.
  const hasGeoEmployeeBound =
    Boolean(filter.state) && typeof filter.employees_min === 'number';

  // A verified category is the MOST selective predicate available — far more
  // than the legacy ones it joins. Only ~9.5k of 8.1M domains are classified
  // so far, and even at full coverage a single category is a few percent of
  // the pool, versus a keyword that matches company free-text and drags in
  // ~97% noise. It qualifies a query on its own.
  const hasVerifiedCategory = Boolean(
    filter.v_category_in && filter.v_category_in.length > 0,
  );

  if (!hasIndustry && !hasKeyword && !hasGeoEmployeeBound && !hasVerifiedCategory) {
    throw new PoolError(
      'Filter is not selective enough to run against a 123M-row pool. Supply at least one of: ' +
        'v_category_in (preferred — verified from the company website), industry_pattern, ' +
        'industry_exact, p_bucket, sic_code_in, a keyword of 2+ characters, ' +
        'or a state together with employees_min.',
    );
  }
}

async function signBody(body: Uint8Array): Promise<string> {
  if (!WORKER_HMAC_SECRET) throw new PoolError('Pool query worker is not configured', 500);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WORKER_HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, body);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function callWorker(path: string, payload: Record<string, unknown>): Promise<any> {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const response = await fetch(`${poolQueryWorkerUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': await signBody(raw) },
    body: raw,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new PoolError(`Pool query failed: ${detail}`, 502);
  }
  return await response.json();
}

/** Sample rows matching a filter. Never a bulk path — capped hard. */
export async function poolSearch(filter: PoolFilter, limit: number): Promise<any> {
  assertSupported(filter);
  assertSelective(filter);
  return await callWorker('/search', {
    ...filter,
    limit: Math.min(Math.max(limit, 1), MAX_PREVIEW_LIMIT),
    offset: Math.max(filter.offset ?? 0, 0),
  });
}

/**
 * Exact number of distinct matches.
 *
 * This is what makes the build cap enforceable: the size of a build is known
 * before any work is queued, so an over-large one is refused rather than
 * discovered halfway through.
 */
export async function poolCount(filter: PoolFilter): Promise<number> {
  assertSupported(filter);
  assertSelective(filter);
  const data = await callWorker('/count', { ...filter, mode: 'count' });
  // The worker names this `total_distinct_emails` — it counts DISTINCT
  // recipients, not rows, which is the number that actually bounds a build.
  // The other aliases are kept for older worker builds.
  const total = data?.total_distinct_emails ?? data?.total ?? data?.count ?? data?.rows_count;
  if (typeof total !== 'number') {
    throw new PoolError('Pool worker returned no usable count', 502);
  }
  return total;
}

/* ── Export ────────────────────────────────────────────────────────────────
 * An export never creates a contact, so unlike a list build it has no
 * per-row cost to bound — the ceiling is a system constant, not a
 * per-caller consent gate. What it does have is a worker that serializes
 * every query through one DuckDB process, which is why the lifecycle below
 * is deliberately one unit of work per call: the pump drives it so a slice
 * can never outlive the request that asked for it.
 */

/** Ceiling on one export. Enforced exactly by the worker's materialization LIMIT. */
export const EXPORT_MAX_ROWS = 5_000_000;

/** The worker's id shape. Minted here from the job UUID so every call is replayable. */
export function exportIdFromJobId(jobId: string): string {
  return `e_${jobId.replace(/-/g, '').toLowerCase()}`;
}

/**
 * Kick off materialization. Returns as soon as the worker has accepted it —
 * a 5M-row CTAS runs past Caddy's 10-minute proxy timeout, so this cannot be
 * a request that waits for completion.
 */
export async function poolExportStart(
  filter: PoolFilter,
  exportId: string,
): Promise<{ state: string; slice_rows?: number }> {
  assertSupported(filter);
  assertSelective(filter);
  return await callWorker('/export/start', { ...filter, export_id: exportId });
}

export async function poolExportStatus(
  exportId: string,
): Promise<{ state: string; row_count?: number; error?: string; slice_rows?: number }> {
  return await callWorker('/export/status', { export_id: exportId });
}

export async function poolExportSlice(
  exportId: string,
  sliceIndex: number,
  prefix: string,
): Promise<{ key: string; rows: number }> {
  return await callWorker('/export/slice', {
    export_id: exportId,
    slice_index: sliceIndex,
    prefix,
  });
}

export async function poolExportFinalize(exportId: string): Promise<void> {
  await callWorker('/export/finalize', { export_id: exportId });
}

export async function poolExportAbort(exportId: string): Promise<void> {
  // Best-effort by design: a cleanup failure must not strand the job.
  try {
    await callWorker('/export/abort', { export_id: exportId });
  } catch {
    // The worker's boot sweep is the backstop.
  }
}

/**
 * Mint presigned GETs.
 *
 * Called on every read rather than stored, so a leaked API response is a
 * capability that expires in an hour instead of one that lives in a Postgres
 * row for the life of the object.
 */
export async function poolExportPresign(
  keys: string[],
  expiresIn = 3600,
): Promise<Array<{ key: string; url: string; expires_at: string }>> {
  if (keys.length === 0) return [];
  const data = await callWorker('/export/presign', { keys, expires_in: expiresIn });
  return data?.urls ?? [];
}
