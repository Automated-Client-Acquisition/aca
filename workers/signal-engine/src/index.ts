/**
 * ACA Signal Engine worker — Fly.io
 *
 *   GET  /health
 *   POST /collect/edgar   — poll SEC daily indexes (Form D funding, 8-K M&A)
 *   POST /collect/ats     — sweep ATS job boards for newly opened roles
 *   POST /collect/news    — sweep the versioned Google News RSS query registry
 *   POST /collect/yc      — refresh YC directory identity observations
 *
 * Driven by pg_cron over HTTP, so the machine sits at zero between runs. The
 * worker's only job is to get raw rows into signal_observations; extraction,
 * company resolution and event dedupe all happen later in the refinery ticks.
 * That separation is deliberate — see src/types.ts.
 */

import http from 'node:http';
import { edgar8kCollector, edgarFormDCollector } from './collectors/edgar.js';
import { sweepAtsBoards } from './collectors/ats.js';
import { collectGoogleNews, GOOGLE_NEWS_QUERIES } from './collectors/google-news.js';
import { resolveGoogleNewsArticle } from './collectors/google-news-resolver.js';
import { collectYcDirectory } from './collectors/yc-directory.js';
import {
  finishRun,
  loadDueSources,
  markSourceRun,
  loadUnresolvedGoogleNewsEvidence,
  saveGoogleNewsResolution,
  startRun,
  upsertSource,
  writeObservations,
  writeWorkerHeartbeat,
} from './store.js';
import type { Collector, SignalSource } from './types.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const ENGINE_SECRET = process.env.SIGNAL_ENGINE_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!ENGINE_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SIGNAL_ENGINE_SECRET, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const COLLECTORS: Record<string, Collector> = {
  [edgarFormDCollector.key]: edgarFormDCollector,
  [edgar8kCollector.key]: edgar8kCollector,
};

const stats = {
  startedAt: new Date().toISOString(),
  runs: 0,
  observationsWritten: 0,
  errors: 0,
};

function respond(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** `since` for a source: its last success, else the configured lookback. */
function sinceFor(source: SignalSource, fallbackDays: number): Date {
  if (source.last_success_at) return new Date(source.last_success_at);
  return new Date(Date.now() - fallbackDays * 24 * 60 * 60 * 1000);
}

async function heartbeat(endpoint: string, outcome: 'success' | 'failed'): Promise<void> {
  try {
    await writeWorkerHeartbeat({
      ...stats,
      endpoint,
      outcome,
      recordedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Telemetry must never convert a successful collection into a failed run.
    console.error('[signal-engine] heartbeat failed', err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// EDGAR
// ---------------------------------------------------------------------------

async function runEdgar(body: Record<string, unknown>) {
  const limit = Math.max(1, Math.min(1000, Number(body.limit ?? 500)));
  const maxPages = Math.max(1, Math.min(50, Number(body.max_pages ?? 10)));
  const lookbackDays = Number(body.lookback_days ?? 3);
  const only = typeof body.collector_key === 'string' ? body.collector_key : undefined;

  const sources = await loadDueSources('edgar', 20);
  const results: unknown[] = [];

  for (const source of sources) {
    if (only && source.collector_key !== only) continue;
    const collector = COLLECTORS[source.collector_key];
    if (!collector) {
      results.push({ source: source.label, error: `no collector for ${source.collector_key}` });
      continue;
    }

    const runId = await startRun(collector.key, source.id);
    try {
      // Never let `since` advance past the lookback floor. The daily index for
      // day D is only published after D closes, so a `since` of "an hour ago"
      // yields just today's (not yet published) index and every filing from
      // yesterday is silently skipped. seen_accessions makes the re-read cheap.
      const floor = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
      const lastSuccess = sinceFor(source, lookbackDays);
      const since = lastSuccess < floor ? lastSuccess : floor;
      let pages = 0;
      let found = 0;
      let writtenCount = 0;
      let duplicateCount = 0;
      let hasMore = true;
      const pageMeta: Record<string, unknown>[] = [];

      while (hasMore && pages < maxPages) {
        const result = await collector.collect({ source, since, limit });
        const written = await writeObservations(source, result.observations);
        pages++;
        found += result.observations.length;
        writtenCount += written.written;
        duplicateCount += written.duplicate;
        pageMeta.push(result.meta ?? {});
        hasMore = result.meta?.has_more === true;
        if (result.cursor) {
          source.cursor = result.cursor;
          // Persist after every page so a timeout resumes instead of replaying
          // all primary-document fetches from the beginning.
          await markSourceRun(source.id, { empty: false, cursor: result.cursor });
        }
      }

      await finishRun(runId, {
        status: 'success',
        written: writtenCount,
        duplicate: duplicateCount,
        meta: { pages, has_more: hasMore, page_meta: pageMeta },
      });
      await markSourceRun(source.id, { empty: writtenCount === 0, cursor: source.cursor });

      stats.runs++;
      stats.observationsWritten += writtenCount;
      results.push({
        source: source.label,
        collector: collector.key,
        pages,
        found,
        written: writtenCount,
        duplicate: duplicateCount,
        has_more: hasMore,
        page_meta: pageMeta,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors++;
      await finishRun(runId, { status: 'failed', error: msg });
      await markSourceRun(source.id, { empty: true, error: msg });
      results.push({ source: source.label, collector: collector.key, error: msg });
    }
  }

  return { kind: 'edgar', sources: sources.length, results };
}

// ---------------------------------------------------------------------------
// ATS
// ---------------------------------------------------------------------------

async function runAts(body: Record<string, unknown>) {
  const limit = Number(body.limit ?? 200);

  // All board observations hang off one synthetic source row; the board itself
  // is identified inside entity_hints. Boards come and go far too often to
  // justify a signal_sources row each.
  const source = await upsertSource({
    kind: 'ats',
    collector_key: 'ats_boards',
    external_key: 'all',
    label: 'ATS job boards',
  });

  const runId = await startRun('ats_boards', source.id);
  try {
    const sweep = await sweepAtsBoards({ limit });
    const written = await writeObservations(
      source,
      sweep.observations.map((o) => o.observation),
    );

    await finishRun(runId, {
      status: 'success',
      written: written.written,
      duplicate: written.duplicate,
      meta: {
        boards_checked: sweep.boardsChecked,
        boards_with_new_jobs: sweep.boardsWithNewJobs,
        errors: sweep.errors.slice(0, 20),
      },
    });
    await markSourceRun(source.id, { empty: written.written === 0 });

    stats.runs++;
    stats.observationsWritten += written.written;
    return {
      kind: 'ats',
      boards_checked: sweep.boardsChecked,
      boards_with_new_jobs: sweep.boardsWithNewJobs,
      ...written,
      errors: sweep.errors.slice(0, 20),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.errors++;
    await finishRun(runId, { status: 'failed', error: msg });
    await markSourceRun(source.id, { empty: true, error: msg });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Google News RSS + YC directory
// ---------------------------------------------------------------------------

async function runGoogleNews(body: Record<string, unknown>) {
  // One source row for the whole registry is deliberate: the same publisher
  // article matching several queries is not independent corroboration.
  const source = await upsertSource({
    kind: 'rss',
    collector_key: 'google_news_rss',
    external_key: 'aca-buying-signals-en-us',
    label: 'Google News buying-signal queries',
    config: { locale: 'en-US', query_count: GOOGLE_NEWS_QUERIES.length },
  });
  const runId = await startRun('google_news_rss', source.id);
  try {
    const result = await collectGoogleNews({
      days: Number(body.lookback_days ?? 2),
      perQuery: Number(body.per_query ?? 100),
      seenExternalIds: (source.cursor.seen_external_ids as string[] | undefined) ?? [],
    });
    const written = await writeObservations(source, result.observations);
    let canonicalUrlsResolved = 0;
    let canonicalUrlsDeferred = 0;
    // Best-effort: a resolver failure must not fail a run whose observations
    // are already written, or the source cursor never advances.
    try {
      const resolutionCandidates = await loadUnresolvedGoogleNewsEvidence(30);
      for (const candidate of resolutionCandidates) {
        const outcome = await resolveGoogleNewsArticle(candidate.source_url);
        await saveGoogleNewsResolution(candidate, outcome);
        if (outcome.url) canonicalUrlsResolved++;
        else canonicalUrlsDeferred++;
      }
    } catch (err) {
      console.error('[signal-engine] canonical resolution failed', err instanceof Error ? err.message : String(err));
    }
    const meta = {
      query_count: GOOGLE_NEWS_QUERIES.length,
      queries_run: result.queriesRun,
      queries_failed: result.queriesFailed,
      queries_limited: result.queriesLimited,
      source_capped_queries: result.sourceCappedQueries,
      limited_query_labels: result.limitedQueryLabels,
      capped_query_labels: result.cappedQueryLabels,
      duplicates_filtered: result.duplicatesFiltered,
      canonical_urls_resolved: canonicalUrlsResolved,
      canonical_urls_deferred: canonicalUrlsDeferred,
      errors: result.errors.slice(0, 20),
    };
    await finishRun(runId, { status: 'success', ...written, meta });
    await markSourceRun(source.id, {
      empty: written.written === 0,
      cursor: { seen_external_ids: result.seenExternalIds },
    });
    stats.runs++;
    stats.observationsWritten += written.written;
    return { kind: 'news', found: result.observations.length, ...written, ...meta };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.errors++;
    await finishRun(runId, { status: 'failed', error: msg });
    await markSourceRun(source.id, { empty: true, error: msg });
    throw err;
  }
}

async function runYcDirectory() {
  const source = await upsertSource({
    kind: 'directory',
    collector_key: 'yc_directory',
    external_key: 'https://www.ycombinator.com/companies',
    label: 'Y Combinator company directory',
    config: { purpose: 'identity_seed', creates_buying_signal: false },
  });
  const runId = await startRun('yc_directory', source.id);
  try {
    const result = await collectYcDirectory();
    const written = await writeObservations(source, result.observations);
    const meta = {
      companies_found: result.companiesFound,
      pages_fetched: result.pagesFetched,
      identity_seed_only: true,
    };
    await finishRun(runId, { status: 'success', ...written, meta });
    await markSourceRun(source.id, { empty: written.written === 0 });
    stats.runs++;
    stats.observationsWritten += written.written;
    return { kind: 'yc', ...written, ...meta };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.errors++;
    await finishRun(runId, { status: 'failed', error: msg });
    await markSourceRun(source.id, { empty: true, error: msg });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    respond(res, 200, { ok: true, ...stats, collectors: Object.keys(COLLECTORS) });
    return;
  }

  if (req.method !== 'POST') {
    respond(res, 404, { error: 'not found' });
    return;
  }

  if (req.headers['x-engine-secret'] !== ENGINE_SECRET) {
    respond(res, 401, { error: 'unauthorized' });
    return;
  }

  try {
    const body = await parseBody(req);
    if (url.pathname === '/collect/edgar') {
      const result = await runEdgar(body);
      await heartbeat(url.pathname, 'success');
      respond(res, 200, result);
      return;
    }
    if (url.pathname === '/collect/ats') {
      const result = await runAts(body);
      await heartbeat(url.pathname, 'success');
      respond(res, 200, result);
      return;
    }
    if (url.pathname === '/collect/news') {
      const result = await runGoogleNews(body);
      await heartbeat(url.pathname, 'success');
      respond(res, 200, result);
      return;
    }
    if (url.pathname === '/collect/yc') {
      const result = await runYcDirectory();
      await heartbeat(url.pathname, 'success');
      respond(res, 200, result);
      return;
    }
    respond(res, 404, { error: 'not found' });
  } catch (err) {
    stats.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[signal-engine] request failed', msg);
    await heartbeat(url.pathname, 'failed');
    respond(res, 500, { error: msg });
  }
});

server.listen(PORT, () => {
  console.log(`[signal-engine] listening on :${PORT}`);
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`[signal-engine] ${sig} received, closing`);
    server.close(() => process.exit(0));
  });
}
