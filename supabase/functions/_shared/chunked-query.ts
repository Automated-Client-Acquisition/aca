/**
 * Chunked Supabase query utilities for edge functions.
 *
 * PostgREST encodes .in() values in the URL query string.
 * Large UUID arrays exceed the Deno edge runtime's HTTP client limits.
 * 50 UUIDs @ 36 chars each ≈ ~2 KB — safe for any HTTP client.
 *
 * Chunks run with bounded concurrency, not one at a time: a caller with
 * 15k ids and the default chunk size needs ~300 chunks, and at ~150ms/chunk
 * sequential round trips alone blow the platform's 150s request budget
 * (this is exactly what 504'd enroll-leads on a 15k-contact list on
 * 2026-09-18 — three separate selectInChunks call sites in that one
 * request, each walking the full id list one chunk at a time). Chunks
 * target disjoint id slices, so nothing downstream needs them ordered or
 * serialized — running EDGE_CONCURRENCY of them at once is safe for
 * SELECT/UPDATE/DELETE alike and cuts wall time by roughly that factor.
 */

const EDGE_IN_CHUNK = 50;
const EDGE_CONCURRENCY = 10;

function toChunks(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += EDGE_IN_CHUNK) {
    chunks.push(ids.slice(i, i + EDGE_IN_CHUNK));
  }
  return chunks;
}

/** Run `run` over `chunks` with at most EDGE_CONCURRENCY in flight at once. */
async function runChunked<R>(
  chunks: string[][],
  run: (chunk: string[]) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < chunks.length; i += EDGE_CONCURRENCY) {
    const batch = chunks.slice(i, i + EDGE_CONCURRENCY);
    results.push(...await Promise.all(batch.map(run)));
  }
  return results;
}

/** Run a Supabase .in() SELECT in chunks, concatenating results. */
// deno-lint-ignore no-explicit-any
export async function selectInChunks<T = any>(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  table: string,
  selectCols: string,
  inColumn: string,
  ids: string[],
  // deno-lint-ignore no-explicit-any
  extraFilters?: (q: any) => any,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const pages = await runChunked(toChunks(ids), async (chunk) => {
    let q = supabase.from(table).select(selectCols).in(inColumn, chunk);
    if (extraFilters) q = extraFilters(q);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as T[];
  });
  return pages.flat();
}

/** Run a Supabase .in() UPDATE in chunks. */
export async function updateInChunks(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  table: string,
  // deno-lint-ignore no-explicit-any
  updateData: Record<string, any>,
  inColumn: string,
  ids: string[],
  // deno-lint-ignore no-explicit-any
  extraFilters?: (q: any) => any,
): Promise<void> {
  if (ids.length === 0) return;
  await runChunked(toChunks(ids), async (chunk) => {
    let q = supabase.from(table).update(updateData).in(inColumn, chunk);
    if (extraFilters) q = extraFilters(q);
    const { error } = await q;
    if (error) throw error;
  });
}

/**
 * Run `run` over `items` in fixed-size batches with bounded concurrency —
 * for bulk insert/upsert calls, which aren't id-`.in()`-shaped so they can't
 * go through runChunked above but hit the same sequential-round-trip cost.
 */
export async function runInBatches<T, R>(
  items: T[],
  batchSize: number,
  run: (batch: T[]) => Promise<R>,
): Promise<R[]> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  const results: R[] = [];
  for (let i = 0; i < batches.length; i += EDGE_CONCURRENCY) {
    const slice = batches.slice(i, i + EDGE_CONCURRENCY);
    results.push(...await Promise.all(slice.map(run)));
  }
  return results;
}

/** Run a Supabase .in() DELETE in chunks. */
export async function deleteInChunks(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  table: string,
  inColumn: string,
  ids: string[],
  // deno-lint-ignore no-explicit-any
  extraFilters?: (q: any) => any,
): Promise<void> {
  if (ids.length === 0) return;
  await runChunked(toChunks(ids), async (chunk) => {
    let q = supabase.from(table).delete().in(inColumn, chunk);
    if (extraFilters) q = extraFilters(q);
    const { error } = await q;
    if (error) throw error;
  });
}
