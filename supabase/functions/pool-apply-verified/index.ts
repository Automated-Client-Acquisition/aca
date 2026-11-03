/**
 * Push verified attributes from Postgres INTO the pool's DuckDB table, so that
 * anyone querying the pool — the dashboard, the API, the community — filters on
 * data we re-derived from a primary source instead of the leak dump's own
 * columns.
 *
 * Two layers, on purpose:
 *
 *   lead_pool_verified (Postgres)   the DURABLE record. Survives everything.
 *   lead_pool.v_* (DuckDB)          a PROJECTION of it, for query speed.
 *
 * The DuckDB copy is disposable: bootstrap.sh re-downloads /data/pool.duckdb
 * from R2 whenever the snapshot ETag moves, taking any local writes with it.
 * That is survivable because scripts/build-fts-index/build-fts.sh now joins
 * lead_pool_verified into the snapshot as it materializes, so a fresh snapshot
 * already carries these columns.
 *
 * This endpoint is what keeps the pool current BETWEEN those 4-8h builds —
 * enrich a domain today, push it, and everyone querying the pool sees it
 * without waiting for the next snapshot.
 *
 * Every verified column is prefixed `v_` so it can never be confused with the
 * dump's native columns. `employees`, `sic_code` and `p_industry` stay exactly
 * as they are — wrong, but untouched, so nothing silently changes meaning under
 * an existing query.
 *
 * POST { mode?: 'maintenance'|'purge_emails'|'persons', limit?, offset?, domains?: string[] }
 *
 * Default mode projects COMPANY facts by domain. 'persons' projects PERSON
 * facts by LinkedIn URL — title, current employer, and the validated email,
 * which belongs to a human rather than to a domain.
 *
 * The maintenance modes are full 123M-row scans and run alone. The default
 * (apply) mode is paged via offset so a long job resumes instead of restarting.
 */

import { createResource, json, ApiError } from '../_shared/rest-api.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { poolQueryWorkerUrl } from "../_shared/site-config.ts";

const WORKER_HMAC_SECRET = Deno.env.get('POOL_QUERY_WORKER_SECRET');

/** Rows pushed per UPDATE. Each one scans the 123M-row table once, so batching
 *  wide beats batching often. */
const APPLY_CHUNK = 1000;

/**
 * SQL string literal. Values here originate from scraped web pages and a third
 * party API, so they are untrusted text heading into a database that also
 * accepts arbitrary SQL on another route — quote them properly rather than
 * trusting them to be tame.
 */
function lit(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function intLit(value: unknown): string {
  // Number(null) is 0 and Number.isFinite(0) is true, so a missing headcount
  // used to be written as a literal 0 — which then MATCHES a "1 to 10
  // employees" filter and quietly makes every unenriched company look tiny.
  // In a pool other people build lists from, that is worse than leaving the
  // field empty. Guard the empty cases before coercing.
  if (value === null || value === undefined || value === '') return 'NULL';
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : 'NULL';
}

async function callWorker(sql: string): Promise<unknown> {
  if (!WORKER_HMAC_SECRET) throw new ApiError('Pool query worker is not configured', 500);
  const raw = new TextEncoder().encode(JSON.stringify({ sql }));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WORKER_HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, raw);
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const res = await fetch(`${poolQueryWorkerUrl()}/debug-sql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': hex },
    body: raw,
  });
  if (!res.ok) {
    throw new ApiError(`Pool worker error: ${(await res.text()).slice(0, 400)}`, 502);
  }
  return await res.json();
}

/**
 * One-off maintenance, kept OUT of the per-batch path.
 *
 * Each statement here scans all 123M rows, so running them on every apply call
 * is what pushed the function past its wall clock and produced a 504 — with no
 * way to tell how much of the batch had landed. Long jobs need the expensive
 * setup separated from the resumable work.
 */
const MAINTENANCE = `
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_category TEXT;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_category_confidence TEXT;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_employee_count INTEGER;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_employee_range TEXT;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_revenue_range TEXT;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_linkedin_industry TEXT;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_business_email TEXT;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_email_validated_at DATE;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_email_risk TEXT;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_verified_at TIMESTAMP;
  -- Person-level. The pool files someone under the employer they had when the
  -- dump was captured; these say who they are NOW. v_current_domain is kept
  -- alongside the row's own stale domain column so a job change is visible
  -- than silently overwriting history.
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_person_title TEXT;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_person_seniority TEXT;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_current_domain TEXT;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_current_company TEXT;
  ALTER TABLE lead_pool ADD COLUMN IF NOT EXISTS v_person_verified_at TIMESTAMP;
  UPDATE lead_pool SET v_employee_count = NULL WHERE v_employee_count = 0;
`;

/**
 * Drop every email written by the old domain-wide UPDATE.
 *
 * Cannot be surgical: a domain-wide write whose address happened to match the
 * domain is indistinguishable from a correct per-person one. Clearing the
 * column and letting the per-person pass refill it is the only way to be sure
 * nobody inherits a colleague's address.
 */
const PURGE_EMAILS = `
  UPDATE lead_pool SET v_business_email = NULL, v_email_validated_at = NULL,
                       v_email_risk = NULL
   WHERE v_business_email IS NOT NULL;
`;

Deno.serve(createResource({
  POST: async ({ body, caller }) => {
    // Rewrites the shared pool for every tenant (incl. purge_emails / maintenance).
    // Platform-only: an aca_ token or user JWT must never reach this.
    if ((caller as { source?: string }).source !== 'service_role') {
      throw new ApiError('Forbidden', 403);
    }
    const started = Date.now();
    const limit = Math.min(Number(body.limit ?? 5000) || 5000, 50_000);
    const offset0 = Math.max(Number(body.offset ?? 0) || 0, 0);
    const only = Array.isArray(body.domains) ? (body.domains as string[]) : null;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Maintenance modes run alone — they are full scans, and mixing them with a
    // batch is what caused the timeout.
    if (body.mode === 'maintenance') {
      await callWorker(MAINTENANCE);
      return json({ success: true, mode: 'maintenance', elapsed_ms: Date.now() - started });
    }
    if (body.mode === 'purge_emails') {
      await callWorker(PURGE_EMAILS);
      return json({ success: true, mode: 'purge_emails', elapsed_ms: Date.now() - started });
    }

    /* ── Person projection ───────────────────────────────────────────────
     * Matched on person_linkedin_url, NOT on domain — and deliberately with
     * no domain guard on the email.
     *
     * The earlier company pass had to require the address to belong to the
     * row's domain, because it keyed by domain and would otherwise have
     * stamped one person's address across all their colleagues. Keyed by the
     * person, that risk is gone: an address reaches exactly the human it
     * belongs to, so a job-changer keeps their real, current, validated email
     * instead of being discarded for disagreeing with a years-old dump.
     *
     * v_current_domain carries where they actually work now. The row's own
     * `domain` still holds the stale employer, so the move is visible and
     * nobody has to guess which one is current.
     */
    if (body.mode === 'persons') {
      const PAGE = 1000;
      let applied = 0;
      const chunks: number[] = [];

      for (let offset = offset0; offset < offset0 + limit; offset += PAGE) {
        const { data, error } = await supabase
          .from('lead_pool_person_verified')
          .select(
            'linkedin_url, title, seniority, company_domain, company_name, ' +
              'business_email, business_email_validated_at, business_email_risk, checked_at',
          )
          .order('linkedin_url')
          .range(offset, Math.min(offset + PAGE, offset0 + limit) - 1);
        if (error) throw new Error(error.message);
        if (!data?.length) break;

        // Cast for the same reason the company path does: the client is
        // untyped here, so the row type infers as GenericStringError.
        const people = data as unknown as Record<string, unknown>[];
        const values = people
          .map((r) =>
            `(${lit(r.linkedin_url)},${lit(r.title)},${lit(r.seniority)},` +
            `${lit(r.company_domain)},${lit(r.company_name)},${lit(r.business_email)},` +
            `${r.business_email_validated_at ? `DATE ${lit(r.business_email_validated_at)}` : 'NULL'},` +
            `${lit(r.business_email_risk)},${lit(r.checked_at)})`
          )
          .join(',');

        await callWorker(`
          UPDATE lead_pool AS p SET
            v_person_title       = COALESCE(v.title, p.v_person_title),
            v_person_seniority   = COALESCE(v.seniority, p.v_person_seniority),
            v_current_domain     = COALESCE(v.company_domain, p.v_current_domain),
            v_current_company    = COALESCE(v.company_name, p.v_current_company),
            v_business_email     = COALESCE(v.biz_email, p.v_business_email),
            v_email_validated_at = COALESCE(v.email_validated, p.v_email_validated_at),
            v_email_risk         = COALESCE(v.email_risk, p.v_email_risk),
            v_person_verified_at = CAST(v.checked_at AS TIMESTAMP)
          FROM (VALUES ${values}) AS v(li_url, title, seniority, company_domain,
                                       company_name, biz_email, email_validated,
                                       email_risk, checked_at)
          WHERE lower(replace(replace(p.person_linkedin_url, 'https://', ''), 'http://', '')) = v.li_url`);

        applied += people.length;
        chunks.push(people.length);
        if (people.length < PAGE) break;
      }

      return json({
        success: true,
        mode: 'persons',
        applied,
        chunks,
        elapsed_ms: Date.now() - started,
      });
    }

    const COLS = 'domain, category, category_confidence, employee_count, employee_range, ' +
      'revenue_range, linkedin_industry, business_email, business_email_validated_at, business_email_risk, updated_at, linkedin_url';

    // PostgREST caps a response at 1000 rows whatever .limit() says, so page
    // with .range() instead. Passing .limit(20000) silently returned 1000 and
    // looked like success — the sort of partial write that is worse than a
    // failure, because nothing tells you the other 90% never happened.
    const PAGE = 1000;
    const rows: Record<string, unknown>[] = [];
    for (let offset = offset0; offset < offset0 + limit; offset += PAGE) {
      let q = supabase
        .from('lead_pool_verified')
        .select(COLS)
        .order('domain')
        .range(offset, Math.min(offset + PAGE, offset0 + limit) - 1);

      // Only push rows that actually carry a verified fact — a row that is all
      // nulls would overwrite nothing but still cost a full table scan.
      // Chunk the domain filter: a multi-thousand-element IN blows past the
      // URL length limit and comes back as an opaque "Bad Request".
      if (only) q = q.in('domain', only.slice(offset, offset + PAGE));
      else q = q.not('category', 'is', null);

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      rows.push(...(data as unknown as Record<string, unknown>[]));
      if (data.length < PAGE) break;
      if (only && offset + PAGE >= only.length) break;
    }

    if (!rows.length) return json({ success: true, applied: 0, note: 'nothing to apply' });

    let applied = 0;
    const chunks: number[] = [];
    for (let i = 0; i < rows.length; i += APPLY_CHUNK) {
      const chunk = rows.slice(i, i + APPLY_CHUNK);
      const values = chunk
        .map((r) =>
          `(${lit(r.domain)},${lit(r.category)},${lit(r.category_confidence)},` +
          `${intLit(r.employee_count)},${lit(r.employee_range)},${lit(r.revenue_range)},` +
          `${lit(r.linkedin_industry)},${lit(r.business_email)},` +
          `${r.business_email_validated_at ? `DATE ${lit(r.business_email_validated_at)}` : 'NULL'},` +
          `${lit(r.updated_at)},${lit(r.linkedin_url)})`
        )
        .join(',');

      // Two writes, because the two kinds of fact have different scope.
      //
      // COMPANY attributes (category, size, revenue, industry) describe the
      // organisation, so they are correct for every row sharing the domain.
      //
      // The EMAIL does not. reverse_linkedin_lookup returns the address of the
      // ONE person whose profile we looked up — and if that person has since
      // changed jobs it is not even on this domain (observed: the
      // worldwildlife.org representative resolved to dglass@ngs.org). Writing
      // it domain-wide would stamp one address onto all 2,447 people at
      // wasteconnections.com. So it is matched per PERSON, on the LinkedIn URL
      // that produced it, and only when the address actually belongs to this
      // company's domain.
      //
      // COALESCE throughout so a pass that has not run yet never erases what an
      // earlier pass already wrote.
      const companySql = `
        UPDATE lead_pool AS p SET
          v_category            = COALESCE(v.category, p.v_category),
          v_category_confidence = COALESCE(v.confidence, p.v_category_confidence),
          v_employee_count      = COALESCE(v.emp_count, p.v_employee_count),
          v_employee_range      = COALESCE(v.emp_range, p.v_employee_range),
          v_revenue_range       = COALESCE(v.rev_range, p.v_revenue_range),
          v_linkedin_industry   = COALESCE(v.li_industry, p.v_linkedin_industry),
          v_verified_at         = CAST(v.verified_at AS TIMESTAMP)
        FROM (VALUES ${values}) AS v(domain, category, confidence, emp_count, emp_range,
                                     rev_range, li_industry, biz_email, email_validated,
                                     verified_at, li_url)
        WHERE p.domain = v.domain`;
      await callWorker(companySql);

      const emailRows = chunk.filter((r) => r.business_email && r.linkedin_url);
      if (emailRows.length) {
        const emailValues = emailRows
          .map((r) =>
            `(${lit(r.domain)},${lit(r.business_email)},` +
            `${r.business_email_validated_at ? `DATE ${lit(r.business_email_validated_at)}` : 'NULL'},` +
            `${lit(String(r.linkedin_url).replace(/^https?:\/\//i, '').replace(/\/$/, ''))})`
          )
          .join(',');

        const emailSql = `
          UPDATE lead_pool AS p SET
            v_business_email     = v.biz_email,
            v_email_validated_at = v.email_validated
          FROM (VALUES ${emailValues}) AS v(domain, biz_email, email_validated, email_risk, li_url)
          WHERE replace(replace(p.person_linkedin_url, 'https://', ''), 'http://', '') = v.li_url
            AND lower(split_part(v.biz_email, '@', 2)) = lower(p.domain)`;
        await callWorker(emailSql);
      }
      applied += chunk.length;
      chunks.push(chunk.length);
    }

    return json({
      success: true,
      applied,
      chunks,
      elapsed_ms: Date.now() - started,
      note: 'DuckDB copy is a projection; re-run after any R2 snapshot publish.',
    });
  },
}));
