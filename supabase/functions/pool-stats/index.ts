/**
 * Read-only vital statistics for the shared lead pool.
 *
 * The pool is a community asset built from an old leak dump, and its attribute
 * columns cannot be trusted (see lead_pool_verified's migration for the
 * measurements). Repairing it needs one number above all others: how many
 * DISTINCT DOMAINS it actually contains. That decides whether re-deriving every
 * company's category from its website is a weekend of compute or a year of it —
 * 123M rows is not 123M companies.
 *
 * Deliberately NOT a SQL proxy. The worker's /debug-sql runs arbitrary
 * statements against a 123M-row database; exposing that through an HTTP
 * function would hand any caller a way to table-scan the pool off a single
 * leaked token. This serves a fixed set of named, bounded aggregates instead,
 * so the blast radius is a known query plan rather than whatever the caller
 * typed.
 */

import { createResource, json, ApiError } from '../_shared/rest-api.ts';
import { poolQueryWorkerUrl } from "../_shared/site-config.ts";

const WORKER_HMAC_SECRET = Deno.env.get('POOL_QUERY_WORKER_SECRET');

/**
 * The fixed query set. Every entry is an aggregate over the whole table — no
 * user input reaches the SQL, so there is nothing to inject into.
 *
 * `coverage` is the one that sizes the repair job: total rows, distinct
 * domains, and how many rows carry the fields we established are trustworthy
 * (domain, email, person_linkedin_url) versus the ones we know are not.
 */
const QUERIES: Record<string, string> = {
  coverage: `
    SELECT
      count(*)                                              AS total_rows,
      count(DISTINCT domain)                                AS distinct_domains,
      count(DISTINCT email)                                 AS distinct_emails,
      count(*) FILTER (WHERE domain IS NOT NULL
                         AND domain <> '\\N')               AS rows_with_domain,
      count(*) FILTER (WHERE email IS NOT NULL
                         AND email <> '\\N')                AS rows_with_email,
      count(*) FILTER (WHERE person_linkedin_url IS NOT NULL
                         AND person_linkedin_url <> '\\N')  AS rows_with_linkedin,
      count(DISTINCT person_linkedin_url)                   AS distinct_linkedin
    FROM lead_pool`,

  /** Distinct domains that have at least one LinkedIn URL — the reachable set
   *  for MoltSets reverse lookup, which is per-company, not per-person. */
  enrichable: `
    SELECT
      count(*) AS domains_total,
      count(*) FILTER (WHERE has_li)  AS domains_with_linkedin,
      count(*) FILTER (WHERE has_em)  AS domains_with_email
    FROM (
      SELECT domain,
             max(CASE WHEN person_linkedin_url IS NOT NULL
                       AND person_linkedin_url <> '\\N' THEN 1 ELSE 0 END) = 1 AS has_li,
             max(CASE WHEN email IS NOT NULL
                       AND email <> '\\N' THEN 1 ELSE 0 END) = 1 AS has_em
      FROM lead_pool
      WHERE domain IS NOT NULL AND domain <> '\\N'
      GROUP BY domain
    )`,

  /**
   * A working sample for the repair pipeline: domains that carry a LinkedIn
   * URL, so BOTH passes can run on them — website classification and MoltSets
   * reverse lookup. Capped at 2000 because this is a pipeline test, not an
   * export path; pool-export exists for bulk.
   *
   * One row per domain (min() picks a stable representative), so we never pay
   * for the same company twice inside one batch.
   */
  sample_enrichable: `
    SELECT domain,
           min(person_linkedin_url) AS linkedin_url,
           min(company)             AS company,
           count(*)                 AS pool_rows
    FROM lead_pool
    WHERE domain IS NOT NULL AND domain <> '\\N'
      AND person_linkedin_url IS NOT NULL AND person_linkedin_url <> '\\N'
    GROUP BY domain
    LIMIT 2000`,

  /**
   * Read-back proof: how much of the pool now carries verified attributes.
   * This is the acceptance test for pool-apply-verified — it reads the DuckDB
   * table itself, not the Postgres source, so a row counted here really did
   * change inside the pool.
   */
  verified_coverage: `
    SELECT
      count(*)                                        AS total_rows,
      count(*) FILTER (WHERE v_category IS NOT NULL)  AS rows_with_category,
      count(DISTINCT CASE WHEN v_category IS NOT NULL THEN domain END)
                                                      AS domains_with_category,
      count(*) FILTER (WHERE v_employee_count IS NOT NULL)
                                                      AS rows_with_size,
      count(*) FILTER (WHERE v_business_email IS NOT NULL)
                                                      AS rows_with_fresh_email,
      count(*) FILTER (WHERE v_verified_at IS NOT NULL)
                                                      AS rows_verified
    FROM lead_pool`,

  /**
   * A worked example: fully-repaired companies, each shown next to the pool's
   * own (wrong) values. One row per domain, and only domains where BOTH passes
   * landed — this is the before/after the whole exercise is judged on.
   */
  verified_sample: `
    SELECT domain,
           any_value(employees)         AS pool_employees,
           any_value(email)             AS pool_email,
           any_value(v_category)        AS v_category,
           any_value(v_employee_count)  AS v_employee_count,
           any_value(v_revenue_range)   AS v_revenue_range,
           any_value(v_business_email)  AS v_business_email,
           count(*)                     AS rows_repaired
    FROM lead_pool
    WHERE v_category IS NOT NULL
      AND v_employee_count IS NOT NULL
      AND v_business_email IS NOT NULL
    GROUP BY domain
    ORDER BY rows_repaired DESC
    LIMIT 12`,

  /**
   * Person-level read-back. The interesting case is a row where the pool's own
   * `domain` disagrees with `v_current_domain` — someone who changed employer
   * since the dump. Both are shown so the move is legible instead of one
   * silently overwriting the other.
   */
  person_sample: `
    SELECT first_name, last_name,
           title            AS pool_title,
           v_person_title   AS real_title,
           domain           AS pool_domain,
           v_current_domain AS works_at_now,
           v_current_company,
           email            AS pool_email,
           v_business_email,
           v_email_risk
    FROM lead_pool
    WHERE v_person_verified_at IS NOT NULL
    ORDER BY (v_current_domain IS DISTINCT FROM domain) DESC
    LIMIT 12`,

  person_coverage: `
    SELECT
      count(*) FILTER (WHERE v_person_verified_at IS NOT NULL)          AS rows_person_verified,
      count(*) FILTER (WHERE v_current_domain IS NOT NULL
                         AND lower(v_current_domain) <> lower(domain))  AS rows_changed_employer,
      count(*) FILTER (WHERE v_business_email IS NOT NULL)              AS rows_with_email,
      count(*) FILTER (WHERE v_email_risk IN ('A','B'))                 AS rows_email_grade_ab
    FROM lead_pool`,

  /**
   * Website-verified target companies for company-first decision-maker search.
   * One row per domain means the recurring worker spends search allowance on
   * current people at target firms instead of enriching stale people from the
   * original pool. Company size is deliberately not filtered here because
   * MoltSets owns current firmographic truth.
   */
  niche_b2b_target_companies: `
    SELECT lower(domain) AS domain,
           min(company) AS company,
           any_value(v_category) AS v_category,
           any_value(v_category_confidence) AS v_category_confidence,
           count(*) AS pool_rows
    FROM lead_pool
    WHERE v_category IN (
            'accounting_tax', 'construction_civil',
            'engineering_services', 'it_services_msp'
          )
      AND v_category_confidence IN ('high', 'medium')
      AND domain IS NOT NULL AND domain NOT IN ('', '\\N')
    GROUP BY lower(domain)
    ORDER BY lower(domain)
    LIMIT 20000`,

  /**
   * Senior people at website-verified niche B2B firms. This is a candidate feed,
   * not final truth: the pool title and employer are stale and MoltSets must
   * confirm both before a person reaches ACA. Up to four people per domain keeps
   * recall high without letting a 10k-person MSP consume the whole enrichment
   * allowance. Search quota is untouched because these are existing LinkedIn
   * URLs headed to reverse_linkedin_lookup.
   */
  niche_b2b_senior_candidates: `
    WITH ranked AS (
      SELECT lower(domain) AS domain,
             person_linkedin_url AS linkedin_url,
             company,
             title AS pool_title,
             seniority AS pool_seniority,
             v_category,
             v_category_confidence,
             profile_score,
             row_number() OVER (
               PARTITION BY lower(domain)
               ORDER BY
                 CASE lower(coalesce(seniority, ''))
                   WHEN 'cxo' THEN 1 WHEN 'partner' THEN 2 WHEN 'vp' THEN 3
                   WHEN 'head' THEN 4 WHEN 'director' THEN 5 ELSE 6 END,
                 profile_score DESC
             ) AS rn
      FROM lead_pool
      WHERE v_category IN (
              'accounting_tax', 'construction_civil',
              'engineering_services', 'it_services_msp'
            )
        AND v_category_confidence IN ('high', 'medium')
        AND person_linkedin_url IS NOT NULL
        AND person_linkedin_url NOT IN ('', '\\N')
        AND lower(person_linkedin_url) LIKE '%linkedin.com/in/%'
        AND lower(person_linkedin_url) NOT LIKE '%linkedin.com/in/acoa%'
        AND (
          lower(coalesce(seniority, '')) IN ('cxo', 'partner', 'vp', 'head', 'director')
          OR regexp_matches(
               lower(coalesce(title, '')),
               '(chief|ceo|founder|owner|partner|president|vice president|(^|[^a-z])vp([^a-z]|$)|head|director|principal)'
             )
        )
    )
    SELECT domain, linkedin_url, company, pool_title, pool_seniority,
           v_category, v_category_confidence, profile_score
    FROM ranked
    WHERE rn <= 4
    ORDER BY domain, rn
    LIMIT 15000`,

  /** How lopsided the pool is: a handful of huge employers dominate row count,
   *  so "rows per domain" tells us how much dedup work list building implies. */
  domain_skew: `
    SELECT
      count(*)                                   AS domains,
      round(avg(n), 2)                           AS avg_rows_per_domain,
      max(n)                                     AS max_rows_per_domain,
      count(*) FILTER (WHERE n = 1)              AS single_contact_domains,
      count(*) FILTER (WHERE n BETWEEN 2 AND 10) AS small_domains
    FROM (
      SELECT domain, count(*) AS n
      FROM lead_pool
      WHERE domain IS NOT NULL AND domain <> '\\N'
      GROUP BY domain
    )`,
};

async function callWorker(path: string, payload: Record<string, unknown>) {
  if (!WORKER_HMAC_SECRET) throw new ApiError('Pool query worker is not configured', 500);
  const raw = new TextEncoder().encode(JSON.stringify(payload));
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

  const res = await fetch(`${poolQueryWorkerUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': hex },
    body: raw,
  });
  if (!res.ok) {
    throw new ApiError(`Pool worker error: ${(await res.text()).slice(0, 300)}`, 502);
  }
  return await res.json();
}

/**
 * Paged domain list, for seeding the classification queue.
 *
 * The only parameterized query here, and the parameter is coerced to a bounded
 * integer before it reaches the SQL — no caller string is ever interpolated.
 * Kept separate from QUERIES so the fixed-query guarantee above still holds
 * literally: everything in that map is a constant.
 *
 * Ordered by domain so paging is stable across calls. Unordered LIMIT/OFFSET
 * against DuckDB can repeat and skip rows between pages, which would silently
 * leave part of the pool unclassified while looking complete.
 */
function domainsPageSql(offset: number, limit: number): string {
  const off = Math.max(0, Math.min(Math.trunc(offset) || 0, 20_000_000));
  const lim = Math.max(1, Math.min(Math.trunc(limit) || 5000, 20_000));
  return `
    SELECT domain FROM (
      SELECT DISTINCT domain FROM lead_pool
      WHERE domain IS NOT NULL AND domain <> '\\N' AND domain <> ''
      ORDER BY domain
      LIMIT ${lim} OFFSET ${off}
    )`;
}

/**
 * People (with LinkedIn URLs) for a specific set of domains.
 *
 * Every domain is validated against a hostname pattern and rejected outright
 * if it does not match, so nothing a caller sends can reach the SQL as
 * anything but a bare hostname. That check is the reason this can accept a
 * caller-supplied list at all — the rest of this endpoint is deliberately
 * constant SQL.
 *
 * One person per domain: the representative whose LinkedIn URL will be
 * reverse-looked-up. Enrichment is billed per record, so paying for five
 * colleagues at one company to learn the same company facts is waste.
 */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

function peopleForDomainsSql(domains: string[]): string {
  const clean = domains
    .map((d) => String(d).toLowerCase().trim())
    .filter((d) => d.length >= 4 && d.length <= 253 && HOSTNAME.test(d))
    .slice(0, 5000);
  if (clean.length === 0) return '';
  const list = clean.map((d) => `'${d}'`).join(',');
  return `
    SELECT domain,
           min(person_linkedin_url) AS linkedin_url,
           any_value(company)       AS company,
           count(*)                 AS pool_rows
    FROM lead_pool
    WHERE domain IN (${list})
      AND person_linkedin_url IS NOT NULL
      AND person_linkedin_url <> '\\N'
      AND person_linkedin_url <> ''
    GROUP BY domain`;
}

Deno.serve(createResource({
  POST: async ({ body }) => {
    const name = String(body.query ?? 'coverage');

    if (name === 'people_for_domains') {
      const started = Date.now();
      const sql = peopleForDomainsSql((body.domains ?? []) as string[]);
      if (!sql) throw new ApiError('domains[] must contain at least one valid hostname');
      const result = await callWorker('/debug-sql', { sql });
      const firstResult = (result as { results?: unknown[] })?.results?.[0];
      const rows = (Array.isArray(firstResult) ? firstResult : []) as Array<Record<string, unknown>>;
      return json({ success: true, count: rows.length, data: rows, elapsed_ms: Date.now() - started });
    }

    if (name === 'domains_page') {
      const started = Date.now();
      const result = await callWorker(
        '/debug-sql',
        { sql: domainsPageSql(Number(body.offset ?? 0), Number(body.limit ?? 5000)) },
      );
      const firstResult = (result as { results?: unknown[] })?.results?.[0];
      const rows = (Array.isArray(firstResult) ? firstResult : []) as Array<{ domain: string }>;
      return json({
        success: true,
        query: name,
        offset: Number(body.offset ?? 0),
        count: rows.length,
        domains: rows.map((r) => r.domain),
        elapsed_ms: Date.now() - started,
      });
    }

    const sql = QUERIES[name];
    if (!sql) {
      throw new ApiError(
        `Unknown query "${name}". Available: ${Object.keys(QUERIES).join(', ')}`,
        400,
      );
    }

    const started = Date.now();
    const result = await callWorker('/debug-sql', { sql });
    return json({
      success: true,
      query: name,
      data: result?.results ?? result,
      elapsed_ms: Date.now() - started,
    });
  },
}));
