/**
 * REST resource: /v1/pool
 *
 *   POST /v1/pool/search     preview matches + exact count
 *   POST /v1/pool/lists      enqueue a build, returns a job handle
 *   GET  /v1/pool/jobs/{id}  poll a build's progress
 *
 * Three problems, three mechanisms:
 *
 * 1. A query against 123M rows must be bounded BEFORE it runs. The selectivity
 *    guard in _shared/pool-query.ts rejects an unbounded filter outright, so
 *    search stays fast because it only ever runs narrow filters.
 *
 * 2. A build is a job, and this endpoint's only responsibility is to hand back a
 *    handle. The paginate/dedupe/insert work belongs to the cron-driven
 *    `process-pool-add-to-list`, so no HTTP request ever spans the work and
 *    there is nothing to time out.
 *
 * 3. The failure that actually hurts is not a timeout — it is materialising
 *    millions of contacts by accident. `max_contacts` is required, and the build
 *    is refused when the filter's exact count exceeds it. You cannot enqueue a
 *    four-million-row build by leaving a parameter out; you have to state the
 *    number and mean it. That also protects the webhook queue, since every new
 *    contact fires a contact_created event.
 *
 * Search is POST rather than GET so the filter object submitted to /search is
 * byte-identical to the one submitted to /lists. Two encodings for one filter is
 * how you end up previewing 500 rows and building 50,000.
 */

import {
  ApiError,
  createResource,
  json,
  requireUuid,
} from '../_shared/rest-api.ts';
import {
  poolSearch,
  poolCount,
  poolExportPresign,
  EXPORT_MAX_ROWS,
  PoolError,
  MAX_PREVIEW_LIMIT,
  type PoolFilter,
} from '../_shared/pool-query.ts';

/** Absolute ceiling on one build, whatever max_contacts asks for. */
const BUILD_HARD_CEILING = 250_000;

const JOB_COLUMNS =
  'id, status, total, processed, errors, error_message, current_offset, target_list_id, created_at, started_at, completed_at';

const EXPORT_COLUMNS =
  'id, status, estimated_rows, total_rows, slice_rows, next_slice, slices_total, rows_written, ' +
  'r2_prefix, parts, expires_at, error_message, created_at, started_at, completed_at';

function filterFrom(body: Record<string, unknown>): PoolFilter {
  const filter = (body.filter ?? body.query_body) as PoolFilter | undefined;
  if (!filter || typeof filter !== 'object') {
    throw new ApiError('filter is required and must be an object');
  }
  return filter;
}

/** Translate a pool-layer failure into the API's error shape. */
function rethrow(err: unknown): never {
  if (err instanceof PoolError) throw new ApiError(err.message, err.status);
  throw err;
}

Deno.serve(createResource({
  GET: async ({ url, supabase, caller }) => {
    if (url.searchParams.get('resource') === 'exports') {
      const id = url.searchParams.get('id');

      // Collection: how a caller finds the export they started yesterday,
      // before the lifecycle rule reaps the objects.
      if (!id) {
        const { data, error } = await supabase
          .from('pool_export_jobs')
          .select(EXPORT_COLUMNS)
          .eq('organization_id', caller.organization_id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw new Error(error.message);
        return json({ success: true, data });
      }

      const jobId = requireUuid(id, 'id');
      const { data: job, error } = await supabase
        .from('pool_export_jobs')
        .select(EXPORT_COLUMNS)
        .eq('organization_id', caller.organization_id)
        .eq('id', jobId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!job) throw new ApiError('Export not found', 404);

      const parts = (job.parts ?? []) as Array<{ key: string; rows: number }>;
      const expired = job.expires_at ? new Date(job.expires_at) < new Date() : false;

      // URLs are minted here, per read, rather than stored on the row. A
      // presigned URL is a bearer token for the objects behind it; one that
      // lives in a database row outlives every access decision made about it.
      // Refusing once the objects are gone turns a confusing 404 into an
      // honest "expired".
      let signed: Array<{ key: string; rows: number; url?: string; expires_at?: string }> = parts;
      if (job.status === 'completed' && parts.length > 0 && !expired) {
        try {
          const urls = await poolExportPresign(parts.map((p) => p.key));
          const byKey = new Map(urls.map((u) => [u.key, u]));
          signed = parts.map((p) => ({ ...p, ...(byKey.get(p.key) ?? {}) }));
        } catch (err) {
          rethrow(err);
        }
      }

      return json({
        success: true,
        data: {
          ...job,
          format: 'ndjson+gzip',
          parts: signed,
          objects_expired: expired,
          download_hint:
            'Fetch the parts in order, then: cat part-*.ndjson.gz | gunzip > pool.ndjson',
        },
      });
    }

    if (url.searchParams.get('resource') !== 'jobs') {
      throw new ApiError(
        'Unknown pool resource. Use POST /v1/pool/search, POST /v1/pool/lists, or GET /v1/pool/jobs/{id}.',
        404,
      );
    }

    const jobId = requireUuid(url.searchParams.get('id'), 'id');
    const { data, error } = await supabase
      .from('pool_add_to_list_jobs')
      .select(JOB_COLUMNS)
      .eq('organization_id', caller.organization_id)
      .eq('id', jobId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new ApiError('Job not found', 404);

    return json({ success: true, data });
  },

  POST: async ({ url, supabase, caller, body }) => {
    const resource = url.searchParams.get('resource');

    /* ── Preview ─────────────────────────────────────────────── */
    if (resource === 'search') {
      const filter = filterFrom(body);
      const limit = typeof body.limit === 'number' ? body.limit : 25;

      try {
        // Count first: it is the number that decides whether a build is even
        // allowed, so returning it alongside the sample means a caller never has
        // to guess how big the follow-up would be.
        const [total, results] = await Promise.all([
          poolCount(filter),
          poolSearch(filter, limit),
        ]);

        // Filters the pool cannot honour are dropped, never applied silently.
        // A caller who filtered on something that did nothing has to be able to
        // see that from the response, or they trust a scope they never got.
        const ignored: string[] = Array.isArray(results?.ignored_filters)
          ? results.ignored_filters
          : [];

        return json({
          success: true,
          total,
          data: results?.rows ?? [],
          preview_limit: Math.min(Math.max(limit, 1), MAX_PREVIEW_LIMIT),
          ...(ignored.length > 0
            ? {
                warnings: [
                  `These filters were ignored — the pool has no column for them: ${ignored.join(', ')}. ` +
                    'The count and sample above are NOT restricted by them.',
                ],
              }
            : {}),
        });
      } catch (err) {
        rethrow(err);
      }
    }

    /* ── Build ───────────────────────────────────────────────── */
    if (resource === 'lists') {
      const filter = filterFrom(body);

      const maxContacts = body.max_contacts;
      if (typeof maxContacts !== 'number' || !Number.isFinite(maxContacts) || maxContacts < 1) {
        throw new ApiError(
          'max_contacts is required and must be a positive integer. It is the ceiling on how many ' +
            'contacts this build may create — run POST /v1/pool/search first to see the exact count.',
        );
      }
      if (maxContacts > BUILD_HARD_CEILING) {
        throw new ApiError(
          `max_contacts may not exceed ${BUILD_HARD_CEILING}. Narrow the filter and build in stages.`,
        );
      }

      // Resolve the destination first, so a filter that is too broad never
      // creates an orphan list as a side effect of being rejected.
      let listId: string;
      if (body.list_id) {
        listId = requireUuid(body.list_id, 'list_id');
        const { data: list, error } = await supabase
          .from('lead_lists')
          .select('id')
          .eq('id', listId)
          .eq('organization_id', caller.organization_id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!list) throw new ApiError('List not found', 404);
      } else if (typeof body.list_name === 'string' && body.list_name.trim()) {
        listId = '';
      } else {
        throw new ApiError('Provide either list_id (existing list) or list_name (create one)');
      }

      // The gate. Exact, not estimated — a build whose size is unknown is a
      // build that can run away.
      let total: number;
      try {
        total = await poolCount(filter);
      } catch (err) {
        rethrow(err);
      }

      if (total > maxContacts) {
        throw new ApiError(
          `This filter matches ${total.toLocaleString('en-US')} contacts, above your max_contacts ` +
            `of ${maxContacts.toLocaleString('en-US')}. Narrow the filter, or raise max_contacts if ` +
            'you genuinely intend to create that many.',
        );
      }
      if (total === 0) {
        throw new ApiError('This filter matches no contacts. Nothing to build.', 404);
      }

      if (!listId) {
        const { data: created, error } = await supabase
          .from('lead_lists')
          .insert({
            organization_id: caller.organization_id,
            name: (body.list_name as string).trim(),
            description: typeof body.description === 'string' ? body.description : null,
            source_type: 'pool_search',
            status: 'active',
            created_by: caller.user_id,
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        listId = created.id;
      }

      const { data: job, error: jobError } = await supabase
        .from('pool_add_to_list_jobs')
        .insert({
          organization_id: caller.organization_id,
          target_list_id: listId,
          created_by: caller.user_id,
          query_body: filter,
          status: 'pending',
          total,
        })
        .select(JOB_COLUMNS)
        .single();

      if (jobError) throw new Error(jobError.message);

      // 202: accepted, not done. The work happens on the next worker tick.
      return json({ success: true, data: job, list_id: listId, matched: total }, 202);
    }

    /* ── Export ──────────────────────────────────────────────────────────
     * Note what is absent: `max_contacts`. That parameter exists on /lists
     * because a build materialises a contact per match and fires a webhook
     * for each, so its size is a decision the caller has to make on
     * purpose. An export creates nothing — the ceiling is a system
     * constant, and asking the caller to restate it would be ceremony.
     */
    if (resource === 'exports') {
      const filter = filterFrom(body);

      let total: number;
      try {
        total = await poolCount(filter);
      } catch (err) {
        rethrow(err);
      }

      if (total === 0) {
        throw new ApiError('This filter matches no contacts. Nothing to export.', 404);
      }
      // The count is approx_count_distinct (HyperLogLog, ~2% error), so it
      // cannot be the hard gate — the worker's materialization LIMIT is.
      // Leaving headroom means a filter that would overshoot is refused here,
      // cheaply, instead of after a multi-minute materialization.
      if (total > EXPORT_MAX_ROWS * 0.95) {
        throw new ApiError(
          `This filter matches roughly ${total.toLocaleString('en-US')} contacts, at or above the ` +
            `${EXPORT_MAX_ROWS.toLocaleString('en-US')}-row export ceiling. Narrow it and export in stages.`,
        );
      }

      const { data: job, error } = await supabase
        .from('pool_export_jobs')
        .insert({
          organization_id: caller.organization_id,
          created_by: caller.user_id,
          query_body: filter,
          dedup_by_email: body.dedup_by_email !== false,
          status: 'pending',
          estimated_rows: total,
        })
        .select(EXPORT_COLUMNS)
        .single();
      if (error) throw new Error(error.message);

      // Kick the pump so the export starts now rather than on the next
      // minute boundary. Fire-and-forget: cron is the recovery path.
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-pool-export`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ source: 'api', job_id: job.id }),
      }).catch(() => {});

      return json({ success: true, data: job, estimated_rows: total }, 202);
    }

    throw new ApiError(
      'Unknown pool resource. Use POST /v1/pool/search, POST /v1/pool/lists, or POST /v1/pool/exports.',
      404,
    );
  },
}));
