// ============================================================================
// process-pool-add-to-list
// ----------------------------------------------------------------------------
// Cron-driven worker (1-min tick) that processes pending pool_add_to_list_jobs.
// For each job:
//   1. If total is unknown, call pool-query-worker /count to populate it.
//   2. Page through pool-query-worker /search in chunks of BATCH_SIZE.
//   3. Upsert each batch into crm_contacts (email-then-linkedin dedup, copying
//      the process-csv-import flow).
//   4. Insert (list_id, contact_id) into lead_list_members with
//      onConflict 'list_id,contact_id' ignore.
//   5. Update job row {processed, current_offset} after each batch.
//   6. Mark status='completed' when current_offset >= total.
//
// Per-tick wall budget: returns after one batch of BATCH_SIZE so a single
// invocation stays well under Supabase's 150s edge-function ceiling. Larger
// jobs span multiple ticks; state lives in pool_add_to_list_jobs.
// ============================================================================

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';
import { poolQueryWorkerUrl } from "../_shared/site-config.ts";

// Reduced from 1000 → 500: with the (list_id, email_lower) pre-check in
// Phase 3, 1000-row batches were tipping over the edge function's 150s
// gateway timeout. 500 keeps each tick comfortably under that.
const BATCH_SIZE = 500;

/**
 * How long one tick holds a job. Comfortably longer than a tick's worst
 * observed runtime (~35s) so a slow tick isn't preempted, and short enough that
 * a crashed tick frees its job within a few minutes.
 */
const LEASE_SECONDS = 300;

/**
 * Rows per statement when writing contacts.
 *
 * Small on purpose. `crm_contacts` has a partial UNIQUE index on
 * (organization_id, lower(primary_email)) for some organizations, and a plain
 * INSERT aborts the WHOLE statement on one duplicate. Chunking bounds the blast
 * radius; the per-row retry below reduces it to the offending row.
 */
const WRITE_CHUNK = 100;

/** Emails per existence-lookup. 500 long emails in one .in() builds a URL big enough to be rejected. */
const LOOKUP_CHUNK = 100;

// Feature flag — set to 'false' on the edge function env to fall back to the
// legacy offset-paged path (re-runs FTS scan per page). New jobs land on
// cursor when true (default); in-flight jobs with cursor_id=NULL continue on
// legacy regardless.
const USE_POOL_CURSOR =
  (Deno.env.get('USE_POOL_CURSOR') ?? 'true').toLowerCase() !== 'false';

interface JobRow {
  id: string;
  organization_id: string;
  target_list_id: string;
  query_body: Record<string, unknown>;
  total: number | null;
  processed: number;
  current_offset: number;
  errors: number;
  status: string;
  cursor_id: string | null;
  cursor_row_count: number | null;
  /** Present because claim_pool_add_to_list_job() returns j.* — used to
   *  attribute enrichment requests back to whoever asked for the list. */
  created_by: string | null;
}

interface PoolRow {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  company?: string | null;
  domain?: string | null;
  person_linkedin_url?: string | null;
  mobile_phone?: string | null;
  person_city?: string | null;
  person_state?: string | null;
  industry?: string | null;
  sic_code?: string | null;
  employees?: number | null;
  employees_range?: string | null;
  p_industry?: string | null;
  p_sic?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let body: { source?: string; job_id?: string } = {};
    try {
      body = await req.json();
    } catch { /* empty body is fine */ }

    // Pick the next job. If body.job_id is set (immediate kick from
    // pool-add-to-list), prefer that one. Otherwise grab the oldest
    // pending|running.
    // Atomically LEASE a job rather than just selecting one.
    //
    // The old picker took the oldest pending|running row with no lock. The cron
    // fires every minute and a tick runs 30s+, so ticks overlapped: on
    // 2026-08-08 ~20 invocations were live at once, all on the SAME job,
    // re-fetching the same cursor offset and re-inserting the same rows. That
    // overlap generated the duplicate emails that then aborted whole insert
    // batches, and multiplied load on crm_contacts by the number of live ticks.
    //
    // claim_pool_add_to_list_job() uses FOR UPDATE SKIP LOCKED plus a lease, so
    // a second tick either takes a *different* job or returns nothing.
    const { data: claimed, error: claimError } = await supabase
      .rpc('claim_pool_add_to_list_job', {
        p_lease_seconds: LEASE_SECONDS,
        p_job_id: body.job_id ?? null,
      });

    if (claimError) {
      console.error('[process] claim failed', claimError.message);
      return json({ ok: false, error: claimError.message }, 500);
    }

    const job = (Array.isArray(claimed) ? claimed[0] : claimed) as JobRow | null;
    if (!job) {
      // Every job is already leased by another tick. Not an error — the common
      // case now that ticks no longer pile onto one job.
      return json({ ok: true, picked: null });
    }

    // First touch: stamp running + started_at and bootstrap totals.
    //
    // Cursor path (preferred): open a server-side cursor via
    // /search/cursor/start. The worker materializes the full FTS result set
    // once into pool.cursor_<id> and returns the exact row count. Subsequent
    // ticks fetch slices from that cursor — no FTS re-scan per page.
    //
    // Legacy path (USE_POOL_CURSOR=false or cursor-start failed): fall back
    // to /count + paged /search with offset. Worse perf but identical
    // semantics; lets us flip back if the cursor path misbehaves.
    if (job.status === 'pending' || job.total == null) {
      let total = 0;
      let cursorId: string | null = null;
      let cursorRowCount: number | null = null;

      if (USE_POOL_CURSOR) {
        try {
          const startRes = await callPoolWorker('/search/cursor/start', {
            ...job.query_body,
            dedup_by_email: false,
            // Cursor TTL = 4h. A 100k-row job at 1000/batch with ~3s/page
            // and ~30s cold-starts lands well inside that.
            cursor_ttl_ms: 4 * 60 * 60 * 1000,
          }) as { cursor_id?: string; row_count?: number; error?: string };
          if (startRes.cursor_id && typeof startRes.row_count === 'number') {
            cursorId = startRes.cursor_id;
            cursorRowCount = startRes.row_count;
            total = startRes.row_count;
          } else {
            console.warn(
              '[process] cursor-start did not return id/row_count; falling back',
              JSON.stringify(startRes).slice(0, 300),
            );
          }
        } catch (err) {
          console.warn('[process] cursor-start failed, falling back to /count', err);
        }
      }
      if (cursorId === null) {
        total = await fetchCount(supabaseUrl, serviceKey, job.query_body);
      }

      await supabase
        .from('pool_add_to_list_jobs')
        .update({
          status: 'running',
          total,
          cursor_id: cursorId,
          cursor_row_count: cursorRowCount,
          started_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      job.total = total;
      job.cursor_id = cursorId;
      job.cursor_row_count = cursorRowCount;
      job.status = 'running';
    }

    if (job.total == null || job.current_offset >= job.total) {
      // Already done — flip to completed (defensive). Drop the cursor if
      // we have one; best-effort, the worker's TTL sweep is the safety net.
      if (job.cursor_id) {
        await callPoolWorker('/search/cursor/end', { cursor_id: job.cursor_id }).catch(() => {});
      }
      await supabase
        .from('pool_add_to_list_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          lease_until: null,
        })
        .eq('id', job.id);
      return json({ ok: true, job_id: job.id, finished: true });
    }

    // --- fetch one batch from worker --------------------------------------
    const rows = job.cursor_id
      ? await fetchCursorBatch(job.cursor_id, job.current_offset, BATCH_SIZE)
      : await fetchSearchBatch(
          supabaseUrl,
          serviceKey,
          job.query_body,
          job.current_offset,
          BATCH_SIZE,
        );

    if (rows.length === 0) {
      if (job.cursor_id) {
        await callPoolWorker('/search/cursor/end', { cursor_id: job.cursor_id }).catch(() => {});
      }
      await supabase
        .from('pool_add_to_list_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          total: job.processed, // correct for case where /count over-estimated
          lease_until: null,
        })
        .eq('id', job.id);
      return json({ ok: true, job_id: job.id, finished: true, processed: job.processed });
    }

    // --- upsert into crm_contacts + lead_list_members ---------------------
    const { inserted, errored } = await ingestBatch(
      supabase,
      job.organization_id,
      job.target_list_id,
      rows,
    );

    // --- queue these companies for MoltSets enrichment ---------------------
    // This is the demand signal. A domain being pulled into a real list is the
    // best available evidence that somebody is about to mail it, and the ~75k
    // records/week ceiling means a blind sweep of the 2.19M reachable domains
    // would take ~29 weeks. Spending the budget here instead means the slice
    // of the pool people actually use converges on verified size and an
    // A-grade email, while the long tail stays category-only until wanted.
    //
    // enqueue_pool_enrichment() skips anything already looked up — the
    // verified layer is global, so a domain resolved for one org is resolved
    // for everyone — which is why this can enqueue every batch blindly.
    // Best-effort: enrichment is an enhancement, and failing a list build over
    // it would trade something the user asked for against something they did not.
    try {
      const enrichable = rows
        .filter((r) => r.domain && r.person_linkedin_url)
        .map((r) => ({ domain: r.domain, linkedin_url: r.person_linkedin_url }));
      if (enrichable.length) {
        await supabase.rpc('enqueue_pool_enrichment', {
          p_rows: enrichable,
          p_source: 'pool_build',
          p_priority: 50, // ahead of speculative backfill
          p_requested_by: job.created_by ?? null,
        });
      }
    } catch (err) {
      console.log('[process] enrichment enqueue failed (non-fatal):', err);
    }

    const newOffset = job.current_offset + rows.length;
    const newProcessed = job.processed + inserted;
    const newErrors = job.errors + errored;
    const finished = rows.length < BATCH_SIZE || newOffset >= (job.total ?? Infinity);

    if (finished && job.cursor_id) {
      // Best-effort cursor cleanup. The worker's TTL sweep is the safety net.
      await callPoolWorker('/search/cursor/end', { cursor_id: job.cursor_id }).catch(() => {});
    }

    await supabase
      .from('pool_add_to_list_jobs')
      .update({
        current_offset: newOffset,
        processed: newProcessed,
        errors: newErrors,
        status: finished ? 'completed' : 'running',
        completed_at: finished ? new Date().toISOString() : null,
        // RELEASE the lease as soon as the batch lands. The lease exists to stop
        // two ticks working one job at the same time — not to reserve the job
        // for the rest of its 5-minute window. Holding it after the batch is
        // done idles the job until it expires: measured 500 rows per ~220s
        // instead of per tick. Clearing it lets the very next tick continue.
        lease_until: null,
      })
      .eq('id', job.id)
      // Don't resurrect a job that was cancelled mid-batch. Without this
      // guard, a self-kick already in flight at cancel-time will write
      // status='running' back and the cron picker re-grabs it forever.
      .in('status', ['pending', 'running']);

    // Self-kick the next batch so a big job moves fast (don't wait for the
    // 1-min cron tick). Fire-and-forget.
    if (!finished) {
      fetch(`${supabaseUrl}/functions/v1/process-pool-add-to-list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ source: 'self-kick', job_id: job.id }),
      }).catch(() => {});
    }

    return json({
      ok: true,
      job_id: job.id,
      processed: newProcessed,
      total: job.total,
      finished,
    });
  } catch (err) {
    console.error('[process-pool-add-to-list] fatal', err);
    return json({
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ----------------------------------------------------------------------------
// Direct call to the Fly pool worker, signed with the same HMAC the
// list-building-pool-search edge function uses. We bypass the edge function
// because it requires a real user JWT, and this worker only has a
// service-role key. Same-origin server-to-server call: as long as the HMAC
// is valid, the Fly worker accepts it.

async function signBody(body: Uint8Array): Promise<string> {
  const secret = Deno.env.get('POOL_QUERY_WORKER_SECRET');
  if (!secret) throw new Error('POOL_QUERY_WORKER_SECRET not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, body);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function callPoolWorker(
  path:
    | '/search'
    | '/count'
    | '/search/cursor/start'
    | '/search/cursor/fetch'
    | '/search/cursor/end',
  body: Record<string, unknown>,
): Promise<unknown> {
  const raw = new TextEncoder().encode(JSON.stringify(body));
  const sig = await signBody(raw);
  const resp = await fetch(`${poolQueryWorkerUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': sig },
    body: raw,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`worker ${path} ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

async function fetchCursorBatch(
  cursorId: string,
  offset: number,
  limit: number,
): Promise<PoolRow[]> {
  const data = await callPoolWorker('/search/cursor/fetch', {
    cursor_id: cursorId,
    offset,
    limit,
  }) as { rows?: PoolRow[] };
  return Array.isArray(data?.rows) ? data.rows : [];
}

async function fetchCount(
  _supabaseUrl: string,
  _serviceKey: string,
  queryBody: Record<string, unknown>,
): Promise<number> {
  try {
    const data = await callPoolWorker('/count', queryBody) as {
      total_distinct_emails?: number;
    };
    return Number(data?.total_distinct_emails ?? 0);
  } catch (err) {
    console.warn('[process] count call failed', err);
    return 0;
  }
}

async function fetchSearchBatch(
  _supabaseUrl: string,
  _serviceKey: string,
  queryBody: Record<string, unknown>,
  offset: number,
  limit: number,
): Promise<PoolRow[]> {
  const data = await callPoolWorker('/search', {
    ...queryBody,
    limit,
    offset,
    skip_count: true,
    dedup_by_email: false,
  }) as { rows?: PoolRow[] };
  return Array.isArray(data?.rows) ? data.rows : [];
}

// Email-first-then-LinkedIn dedup, mirroring process-csv-import/index.ts:
//   1. Look up existing crm_contacts by primary_email in this org → reuse.
//   2. Upsert remaining rows by (organization_id, primary_linkedin_url).
//   3. Insert any rows without LinkedIn URL.
// Then insert (list_id, contact_id) with ignore-duplicates.
async function ingestBatch(
  supabase: SupabaseClient,
  organizationId: string,
  targetListId: string,
  rows: PoolRow[],
): Promise<{ inserted: number; errored: number }> {
  // Apollo's CSV uses '\N' as a NULL marker. Treat blank/`\N` as null so we
  // don't (a) pollute the CRM with literal '\N' strings, and (b) cause
  // ON CONFLICT row collisions when many rows share the same '\N'
  // primary_linkedin_url.
  const nz = (v: string | null | undefined): string | null => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || s === '\\N' || s === '/N' || s === '\\\\N') return null;
    return s;
  };

  // Skip generated columns (full_name, company_name, title, email, phone,
  // linkedin_url) — Postgres rejects any non-DEFAULT value for them.
  const contacts = rows
    .filter((r) => nz(r.email))
    .map((r) => ({
      organization_id: organizationId,
      display_name: [nz(r.first_name), nz(r.last_name)].filter(Boolean).join(' ') ||
        nz(r.email)!,
      first_name: nz(r.first_name),
      last_name: nz(r.last_name),
      job_title: nz(r.title),
      company: nz(r.company),
      company_website: nz(r.domain) ? `https://${nz(r.domain)}` : null,
      primary_email: nz(r.email)!.toLowerCase(),
      primary_linkedin_url: nz(r.person_linkedin_url),
      primary_phone: nz(r.mobile_phone),
      city: nz(r.person_city),
      state: nz(r.person_state),
      source: 'pool_search',
      enrichment_data: {
        industry: nz(r.industry),
        sic_code: nz(r.sic_code),
        p_industry: nz(r.p_industry),
        p_sic: nz(r.p_sic),
        employees: r.employees ?? null,
        employees_range: nz(r.employees_range),
      },
    }));

  if (contacts.length === 0) return { inserted: 0, errored: 0 };

  // Resolved (contact_id, email_lower) pairs. Email is carried alongside
  // the id so Phase 3 can dedupe members by email (the lead_list_members
  // table has a unique index on (list_id, email_lower) that contact-id
  // dedup alone doesn't catch).
  const resolved: Array<{ id: string; email: string }> = [];
  let errored = 0;

  // Phase 1: existing-by-email lookup.
  //
  // This is the load-bearing dedup: anything it misses reaches the INSERT below
  // and, where the organization has the partial unique email index, takes the
  // whole statement down with it.
  //
  // Two things were wrong here and both produced the same symptom (a ~74% error
  // rate on 2026-08-08): the lookup passed all 500 emails to a single .in(),
  // which builds a URL long enough to be rejected, and its error was discarded
  // — a failed lookup silently yielded "nothing exists yet", so every row went
  // to INSERT and every batch collided. Chunk it, and treat a lookup failure as
  // fatal for the tick rather than quietly mis-ingesting.
  const existingByEmail = new Map<string, string>();
  const emailList = contacts.map((c) => c.primary_email);
  for (let i = 0; i < emailList.length; i += LOOKUP_CHUNK) {
    const slice = emailList.slice(i, i + LOOKUP_CHUNK);
    const { data: existing, error: lookupErr } = await supabase
      .from('crm_contacts')
      .select('id, primary_email')
      .eq('organization_id', organizationId)
      .in('primary_email', slice);

    if (lookupErr) {
      throw new Error(`existing-contact lookup failed: ${lookupErr.message}`);
    }
    for (const e of (existing ?? [])) {
      // Key on lower(email): that is what the unique index keys on, so a
      // legacy row stored with different casing must still count as existing.
      if (e.primary_email) existingByEmail.set(e.primary_email.toLowerCase(), e.id);
    }
  }
  for (const [email, id] of existingByEmail) resolved.push({ id, email });

  // Phase 2: upsert remaining (split LinkedIn vs no-LinkedIn). Dedupe by
  // primary_linkedin_url within the batch — Postgres ON CONFLICT errors
  // with "command cannot affect row a second time" if two input rows hit
  // the same conflict target. Also dedupe by primary_email *across* both
  // buckets: lead_list_members has a unique (list_id, email_lower) index,
  // so if the same email enters via both the LI and no-LI paths it produces
  // two contact_ids and the second member-insert crashes the chunk.
  const remaining = contacts.filter((c) =>
    !existingByEmail.has(c.primary_email)
  );
  const seenLI = new Set<string>();
  const withLI: typeof remaining = [];
  const seenEmailGlobal = new Set<string>();
  const withoutLI: typeof remaining = [];
  for (const c of remaining) {
    if (seenEmailGlobal.has(c.primary_email)) continue;
    seenEmailGlobal.add(c.primary_email);
    if (c.primary_linkedin_url) {
      if (seenLI.has(c.primary_linkedin_url)) continue;
      seenLI.add(c.primary_linkedin_url);
      withLI.push(c);
    } else {
      withoutLI.push(c);
    }
  }

  if (withLI.length > 0) {
    // Chunked upsert with a per-row retry, for the same reason the no-LinkedIn
    // path below has one — except the failure that actually bites here is a
    // statement timeout, not a duplicate. `crm_contacts` is heavily indexed and
    // fires a webhook per row, so upserting a whole 500-row batch in one
    // statement is slow enough to be cancelled outright. This used to write off
    // every row in the batch (`errored += withLI.length`), and since most pool
    // rows carry a LinkedIn URL, one timeout discarded the bulk of a build:
    // measured 8,098 of 17,419 valid contacts dropped on 2026-08-12.
    //
    // Smaller statements make the timeout unlikely; the per-row replay means a
    // chunk that still fails costs only the rows that genuinely cannot land.
    for (let i = 0; i < withLI.length; i += WRITE_CHUNK) {
      const chunk = withLI.slice(i, i + WRITE_CHUNK);
      const { data: chunkData, error: chunkErr } = await supabase
        .from('crm_contacts')
        .upsert(chunk, {
          onConflict: 'organization_id,primary_linkedin_url',
          ignoreDuplicates: false,
        })
        .select('id, primary_email');

      if (!chunkErr) {
        for (const d of (chunkData ?? [])) {
          if (d.id && d.primary_email) resolved.push({ id: d.id, email: d.primary_email });
        }
        continue;
      }

      console.error(
        '[process] withLI chunk upsert error, replaying per row',
        chunkErr.message,
        'chunk_size',
        chunk.length,
      );

      for (const row of chunk) {
        const { data: one, error: oneErr } = await supabase
          .from('crm_contacts')
          .upsert(row, {
            onConflict: 'organization_id,primary_linkedin_url',
            ignoreDuplicates: false,
          })
          .select('id, primary_email')
          .maybeSingle();

        if (!oneErr && one?.id && one.primary_email) {
          resolved.push({ id: one.id, email: one.primary_email });
          continue;
        }

        // Recover the existing row rather than writing the contact off. Try the
        // conflict target first, then email — a concurrent tick may have landed
        // the same person under either key.
        const { data: byLinkedIn } = await supabase
          .from('crm_contacts')
          .select('id, primary_email')
          .eq('organization_id', organizationId)
          .eq('primary_linkedin_url', row.primary_linkedin_url)
          .limit(1)
          .maybeSingle();

        if (byLinkedIn?.id && byLinkedIn.primary_email) {
          resolved.push({ id: byLinkedIn.id, email: byLinkedIn.primary_email });
          continue;
        }

        const { data: byEmail } = await supabase
          .from('crm_contacts')
          .select('id, primary_email')
          .eq('organization_id', organizationId)
          .ilike('primary_email', row.primary_email)
          .limit(1)
          .maybeSingle();

        if (byEmail?.id && byEmail.primary_email) {
          resolved.push({ id: byEmail.id, email: byEmail.primary_email });
        } else {
          errored += 1;
        }
      }
    }
  }
  if (withoutLI.length > 0) {
    // Chunked insert with a per-row retry.
    //
    // ON CONFLICT can't help here: the only unique email index is PARTIAL
    // (scoped to one organization), and Postgres cannot infer a partial index
    // as a conflict target through PostgREST's on_conflict. So a duplicate
    // raises, and a plain INSERT aborts every row in the statement — which is
    // how a single repeat email used to discard 500 good contacts.
    //
    // Insert in small chunks; if a chunk raises, replay it one row at a time so
    // only the genuinely conflicting rows are lost.
    for (let i = 0; i < withoutLI.length; i += WRITE_CHUNK) {
      const chunk = withoutLI.slice(i, i + WRITE_CHUNK);
      const { data: chunkData, error: chunkErr } = await supabase
        .from('crm_contacts')
        .insert(chunk)
        .select('id, primary_email');

      if (!chunkErr) {
        for (const d of (chunkData ?? [])) {
          if (d.id && d.primary_email) resolved.push({ id: d.id, email: d.primary_email });
        }
        continue;
      }

      for (const row of chunk) {
        const { data: one, error: oneErr } = await supabase
          .from('crm_contacts')
          .insert(row)
          .select('id, primary_email')
          .maybeSingle();

        if (oneErr || !one) {
          // Almost always a duplicate that Phase 1 could not see (e.g. inserted
          // by a concurrent tick). Recover the existing row so the contact still
          // reaches the list instead of being written off.
          const { data: found } = await supabase
            .from('crm_contacts')
            .select('id, primary_email')
            .eq('organization_id', organizationId)
            .ilike('primary_email', row.primary_email)
            .limit(1)
            .maybeSingle();

          if (found?.id && found.primary_email) {
            resolved.push({ id: found.id, email: found.primary_email });
          } else {
            errored += 1;
          }
          continue;
        }
        resolved.push({ id: one.id, email: one.primary_email });
      }
    }
  }
  // Phase 3: lead_list_members. Two unique constraints exist on this table:
  //   - lead_list_members_list_id_contact_id_key   (list_id, contact_id)
  //   - lead_list_members_list_email_lower_uniq    (list_id, email_lower)
  //                                                  WHERE email_lower IS NOT NULL
  // Supabase's upsert can only target one. So we dedupe in-app against both,
  // pre-check what's already in the list, and use insert-with-ignore on the
  // (contact_id) key. The email_lower side is enforced by pre-filtering.
  if (resolved.length > 0) {
    // (a) Dedupe within batch: one row per email, and one row per contact_id.
    const seenEmail = new Set<string>();
    const seenContact = new Set<string>();
    const candidates: Array<{ contact_id: string; email_lower: string }> = [];
    for (const r of resolved) {
      if (!r.id || !r.email) continue;
      const emailLower = r.email.toLowerCase();
      if (seenEmail.has(emailLower) || seenContact.has(r.id)) continue;
      seenEmail.add(emailLower);
      seenContact.add(r.id);
      candidates.push({ contact_id: r.id, email_lower: emailLower });
    }
    if (candidates.length === 0) {
      return { inserted: resolved.length, errored };
    }

    // (b) Pre-filter against existing members on email_lower. Done in
    // chunks because .in() on a giant array is slow and may hit URL limits.
    const alreadyInListEmails = new Set<string>();
    for (let i = 0; i < candidates.length; i += 500) {
      const slice = candidates.slice(i, i + 500).map((c) => c.email_lower);
      const { data: hit } = await supabase
        .from('lead_list_members')
        .select('email_lower')
        .eq('list_id', targetListId)
        .in('email_lower', slice);
      for (const h of (hit ?? [])) {
        if (h.email_lower) alreadyInListEmails.add(h.email_lower);
      }
    }
    const toInsert = candidates.filter((c) => !alreadyInListEmails.has(c.email_lower));

    // (c) Insert with ON CONFLICT on (list_id, contact_id) — handles the
    // contact_id half. The email_lower half is already guaranteed unique by
    // the pre-filter above + the batch dedup. Chunk to keep statements small.
    let memberErrCount = 0;
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200).map((c) => ({
        list_id: targetListId,
        contact_id: c.contact_id,
      }));
      const { error: memberErr } = await supabase
        .from('lead_list_members')
        .upsert(chunk, {
          onConflict: 'list_id,contact_id',
          ignoreDuplicates: true,
        });
      if (memberErr) {
        console.error(
          '[process] member upsert error',
          memberErr.message,
          'chunk_size',
          chunk.length,
          'sample',
          JSON.stringify(chunk[0]),
        );
        memberErrCount += chunk.length;
      }
    }
    if (memberErrCount > 0) errored += memberErrCount;
  }

  return { inserted: resolved.length, errored };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
