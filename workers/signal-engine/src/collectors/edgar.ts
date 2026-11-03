/**
 * EDGAR collector — SEC filings as funding and M&A signals.
 *
 * WHY THE DAILY INDEX, NOT FULL-TEXT SEARCH
 * ---------------------------------------------------------------------------
 * v1 (sec-form-d.ts, removed in 1a812ac8) queried efts.sec.gov full-text search
 * with an empty `q`. Full-text search is built for term queries; using it to
 * mean "every Form D in this window" is off-label, silently caps results, and
 * changes shape without notice.
 *
 * The daily index is the canonical enumeration instead:
 *   https://www.sec.gov/Archives/edgar/daily-index/2026/QTR3/master.20260817.idx
 * Pipe-delimited, one line per filing, complete by construction. Weekends and
 * federal holidays simply have no file — see fetchDailyIndex for why that shows
 * up as a 403 rather than a 404, and why the difference matters.
 *
 * WHY FORM D IS A FUNDING SIGNAL
 * ---------------------------------------------------------------------------
 * Form D is the notice filed for a Reg D exempt offering — the dominant filing
 * for a venture round. Unlike a press mention it is a legal filing: it cannot
 * be spin, it is dated, and it is self-corroborating (confidence does not need
 * a second source).
 *
 * The primary_doc.xml is far richer than v1 ever used. Beyond issuer name and
 * CIK it carries the offering amount, amount already sold, industry group,
 * revenue band, and — most valuable — relatedPersonsList: the executives and
 * directors, by name, with their relationship. Those are decision-maker hints
 * that arrive free with the signal, before any enrichment spend.
 *
 * IDENTITY
 * ---------------------------------------------------------------------------
 * CIK is a permanent, globally unique SEC company id that never collides. It is
 * the strongest resolution hint any of our sources produces — the resolver can
 * key on it directly instead of fuzzy-matching a company name, which is exactly
 * the failure that killed v1.
 */

import { XMLParser } from 'fast-xml-parser';
import { HttpError, RateLimiter, fetchText, fetchWithRetry } from '../http.js';
import type { CollectContext, CollectResult, Collector, RawObservation } from '../types.js';

// SEC requires a User-Agent identifying the requester, and caps everyone at 10
// req/s. We run well under the cap: nothing here is latency-sensitive, and an
// IP ban would take out funding and M&A collection simultaneously.
// Set SEC_USER_AGENT to "<name> <contact email>"; the fallback names the install's own OPS_EMAIL.
const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT || `ACA signal engine ${process.env.OPS_EMAIL ?? ''}`.trim();
const secLimiter = new RateLimiter(5);

const SEC_HEADERS = {
  'User-Agent': SEC_USER_AGENT,
  'Accept-Encoding': 'gzip, deflate',
};

const xml = new XMLParser({
  ignoreAttributes: true,
  // Keep everything a string: CIKs have significant leading zeros that numeric
  // coercion destroys, and "Indefinite" is a legal value for an offering amount.
  parseTagValue: false,
  trimValues: true,
});

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

interface IndexEntry {
  cik: string;
  companyName: string;
  formType: string;
  dateFiled: string;
  fileName: string;
  accession: string;
}

function quarterOf(d: Date): number {
  return Math.floor(d.getUTCMonth() / 3) + 1;
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Enumerate the UTC dates in [since, now], newest first, capped. */
function datesSince(since: Date, maxDays: number): Date[] {
  const out: Date[] = [];
  const today = new Date();
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const floor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  while (cursor >= floor && out.length < maxDays) {
    out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

/**
 * Fetch and parse one daily master index.
 *
 * Format after a 7-line header:
 *   CIK|Company Name|Form Type|Date Filed|Filename
 *
 * MISSING DAYS COME BACK AS 403, NOT 404.
 * The archive is served from S3, which answers a nonexistent key with
 * `AccessDenied` rather than `NoSuchKey`. Weekends, federal holidays and
 * today-before-publication therefore all 403. Treating that as fatal kills the
 * whole run on any Saturday.
 *
 * But a 403 is ALSO what SEC returns when it blocks a client for an undeclared
 * User-Agent or for exceeding the rate limit. Swallowing that indiscriminately
 * is the nastier bug: every day would look "not published", the collector would
 * return zero forever, and nothing would report an error. So we separate the two
 * on the response body — S3 sends an XML `<Code>AccessDenied</Code>` document,
 * while a genuine block sends an HTML notice — and let the real one throw.
 */
async function fetchDailyIndex(date: Date, signal?: AbortSignal): Promise<IndexEntry[]> {
  const url =
    `https://www.sec.gov/Archives/edgar/daily-index/${date.getUTCFullYear()}` +
    `/QTR${quarterOf(date)}/master.${yyyymmdd(date)}.idx`;

  let body: string | null;
  try {
    body = await fetchText(url, {
      headers: SEC_HEADERS,
      limiter: secLimiter,
      signal,
      allow404: true,
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 403 && /<Code>AccessDenied<\/Code>/i.test(err.body)) {
      return []; // no index published for this date
    }
    throw err;
  }
  if (!body) return [];

  const entries: IndexEntry[] = [];
  for (const line of body.split('\n')) {
    const parts = line.split('|');
    if (parts.length < 5) continue;
    const [cik, companyName, formType, dateFiled, fileName] = parts.map((p) => p.trim());
    if (!/^\d+$/.test(cik)) continue; // header / separator rows

    // edgar/data/1234567/0001234567-26-000001.txt -> 0001234567-26-000001
    const accession = fileName.split('/').pop()?.replace(/\.txt$/, '') ?? '';
    if (!accession) continue;

    entries.push({ cik, companyName, formType, dateFiled, fileName, accession });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Form D
// ---------------------------------------------------------------------------

interface FormD {
  entityName?: string;
  cik?: string;
  jurisdiction?: string;
  yearOfInc?: string;
  city?: string;
  stateOrCountry?: string;
  industryGroup?: string;
  revenueRange?: string;
  totalOfferingAmount?: string;
  totalAmountSold?: string;
  totalRemaining?: string;
  investorCount?: string;
  dateOfFirstSale?: string;
  isAmendment?: boolean;
  relatedPersons: Array<{ name: string; relationships: string[] }>;
}

interface FormDXmlRelatedPerson {
  relatedPersonName?: { firstName?: string; middleName?: string; lastName?: string };
  relatedPersonRelationshipList?: { relationship?: string | string[] };
}

interface FormDXmlRoot {
  edgarSubmission?: {
    primaryIssuer?: {
      entityName?: string;
      cik?: string;
      jurisdictionOfInc?: string;
      yearOfInc?: { value?: string };
      issuerAddress?: { city?: string; stateOrCountry?: string };
    };
    offeringData?: {
      industryGroup?: { industryGroupType?: string };
      issuerSize?: { revenueRange?: string };
      offeringSalesAmounts?: {
        totalOfferingAmount?: string;
        totalAmountSold?: string;
        totalRemaining?: string;
      };
      investors?: { totalNumberAlreadyInvested?: string };
      typeOfFiling?: {
        dateOfFirstSale?: { value?: string };
        newOrAmendment?: { isAmendment?: string | boolean };
      };
    };
    relatedPersonsList?: {
      relatedPersonInfo?: FormDXmlRelatedPerson | FormDXmlRelatedPerson[];
    };
  };
}

function parseFormD(doc: string): FormD | null {
  let root: FormDXmlRoot;
  try {
    root = xml.parse(doc) as FormDXmlRoot;
  } catch {
    return null;
  }
  const sub = root?.edgarSubmission;
  if (!sub) return null;

  const issuer = sub.primaryIssuer ?? {};
  const offering = sub.offeringData ?? {};
  const addr = issuer.issuerAddress ?? {};

  const relatedPersons = toArray<FormDXmlRelatedPerson>(sub.relatedPersonsList?.relatedPersonInfo)
    .map((p) => {
      const n = p?.relatedPersonName ?? {};
      const name = [n.firstName, n.middleName, n.lastName].filter(Boolean).join(' ').trim();
      const relationships = toArray<string>(
        p?.relatedPersonRelationshipList?.relationship,
      ).filter(Boolean);
      return { name, relationships };
    })
    .filter((p) => p.name.length > 0);

  return {
    entityName: issuer.entityName,
    cik: issuer.cik,
    jurisdiction: issuer.jurisdictionOfInc,
    // yearOfInc is a choice element: <value>2019</value> OR <overFiveYears>true</overFiveYears>.
    // Taking the raw node as a fallback would put an object into a string field.
    yearOfInc: typeof issuer.yearOfInc?.value === 'string' ? issuer.yearOfInc.value : undefined,
    city: addr.city,
    stateOrCountry: addr.stateOrCountry,
    industryGroup: offering.industryGroup?.industryGroupType,
    revenueRange: offering.issuerSize?.revenueRange,
    totalOfferingAmount: offering.offeringSalesAmounts?.totalOfferingAmount,
    totalAmountSold: offering.offeringSalesAmounts?.totalAmountSold,
    totalRemaining: offering.offeringSalesAmounts?.totalRemaining,
    investorCount: offering.investors?.totalNumberAlreadyInvested,
    // Nested under typeOfFiling, NOT directly on offeringData.
    dateOfFirstSale: offering.typeOfFiling?.dateOfFirstSale?.value,
    isAmendment: String(offering.typeOfFiling?.newOrAmendment?.isAmendment) === 'true',
    relatedPersons,
  };
}

/**
 * Industry groups that are financial vehicles rather than operating companies.
 *
 * Roughly a third of all Form D filings are a fund raising a fund, an SPV, or a
 * real-estate syndication — none of which is a company that just got budget to
 * spend, so none of them is a lead. v1 fought this with a name regex
 * (`looksLikeInvestmentVehicle`) that had to guess from strings like
 * "GREAT LAKES ADVISORS, LLC". Form D states it outright in a structured field,
 * so we filter on that instead of guessing.
 *
 * Scoped to Form D's own taxonomy. Two groups are excluded for different
 * reasons, and the distinction is worth keeping straight when tuning this:
 *
 *   Capital vehicles   — a fund raising a fund. Never an operating company.
 *   Real estate        — mostly single-property syndications. Occasionally a
 *                        genuine operator, so this is the half to relax first
 *                        if a client sells into property or construction.
 *
 * Deliberately NOT excluded: Insurance, Commercial Banking, and Other Banking
 * and Financial Services. Those read like vehicles but are also where real
 * fintech and insurtech companies file, and silently dropping every fintech
 * lead is a worse error than letting a few holding companies through.
 */
const DEFAULT_EXCLUDED_INDUSTRY_GROUPS = [
  // Capital vehicles
  'Pooled Investment Fund',
  'Investing',
  'Investment Banking',
  'REITS and Finance',
  // Real estate syndications
  'Other Real Estate',
  'Residential',
  'Commercial',
  'Construction',
];

function filingBaseUrl(cik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}`;
}

async function fetchFormDDoc(
  cik: string,
  accession: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${filingBaseUrl(cik, accession)}/primary_doc.xml`;
  return fetchText(url, {
    headers: SEC_HEADERS,
    limiter: secLimiter,
    signal,
    allow404: true,
  });
}

/**
 * The index reports Date Filed as bare YYYYMMDD, which `new Date()` rejects.
 * Returns null rather than an Invalid Date so a malformed row can't throw
 * mid-run and lose every observation collected before it.
 */
function parseFiledDate(raw: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "5000000" -> 5000000. "Indefinite" and junk -> null. */
function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const edgarFormDCollector: Collector = {
  key: 'edgar_form_d',
  kind: 'edgar',

  async collect({ source, since, limit, signal }: CollectContext): Promise<CollectResult> {
    const maxDays = Number(source.config.max_days ?? 7);
    const minAmount = Number(source.config.min_offering_amount ?? 0);
    const excludedGroups = new Set(
      ((source.config.exclude_industry_groups as string[] | undefined) ??
        DEFAULT_EXCLUDED_INDUSTRY_GROUPS).map((g) => g.toLowerCase()),
    );
    const dates = datesSince(since, maxDays);

    const observations: RawObservation[] = [];
    const seenAccessions = new Set<string>(
      (source.cursor.seen_accessions as string[] | undefined) ?? [],
    );
    let indexDays = 0;
    let candidates = 0;
    let skippedAmount = 0;
    let skippedVehicle = 0;

    for (const date of dates) {
      if (signal?.aborted || observations.length >= limit) break;

      const entries = await fetchDailyIndex(date, signal);
      if (entries.length === 0) continue;
      indexDays++;

      const formD = entries.filter((e) => e.formType === 'D' || e.formType === 'D/A');
      candidates += formD.length;

      for (const entry of formD) {
        if (signal?.aborted || observations.length >= limit) break;
        if (seenAccessions.has(entry.accession)) continue;

        const doc = await fetchFormDDoc(entry.cik, entry.accession, signal);
        if (!doc) continue;

        const parsed = parseFormD(doc);
        if (!parsed) continue;

        // Funds, SPVs and real-estate syndications file Form D constantly and
        // are never leads. Drop them before they cost us a resolution lookup.
        if (parsed.industryGroup && excludedGroups.has(parsed.industryGroup.toLowerCase())) {
          skippedVehicle++;
          seenAccessions.add(entry.accession);
          continue;
        }

        const offering = parseAmount(parsed.totalOfferingAmount);
        const sold = parseAmount(parsed.totalAmountSold);

        // A tiny raise is usually a friends-and-family note rather than a
        // company that just got real budget. Filter here rather than paying to
        // resolve and score it downstream.
        if (minAmount > 0 && (offering ?? sold ?? 0) < minAmount) {
          skippedAmount++;
          seenAccessions.add(entry.accession);
          continue;
        }

        const companyName = parsed.entityName || entry.companyName;
        const decisionMakers = parsed.relatedPersons.filter((p) =>
          p.relationships.some((r) => /executive officer|director|promoter/i.test(r)),
        );

        observations.push({
          external_id: entry.accession,
          source_url: `${filingBaseUrl(entry.cik, entry.accession)}/${entry.accession}-index.htm`,
          title: `${companyName} — Form ${entry.formType}`,
          // Structured: no LLM extraction needed or billed.
          structured: {
            event_type: 'funding',
            company_name: companyName,
            cik: entry.cik,
            form_type: entry.formType,
            is_amendment: parsed.isAmendment ?? entry.formType === 'D/A',
            filed_at: entry.dateFiled,
            date_of_first_sale: parsed.dateOfFirstSale ?? null,
            total_offering_amount: offering,
            total_amount_sold: sold,
            total_remaining: parseAmount(parsed.totalRemaining),
            investor_count: parsed.investorCount ? Number(parsed.investorCount) : null,
            currency: 'USD',
            industry_group: parsed.industryGroup ?? null,
            revenue_range: parsed.revenueRange ?? null,
            jurisdiction: parsed.jurisdiction ?? null,
            year_of_inc: parsed.yearOfInc ?? null,
            city: parsed.city ?? null,
            state_or_country: parsed.stateOrCountry ?? null,
            related_persons: parsed.relatedPersons,
            decision_makers: decisionMakers,
            evidence_url: `${filingBaseUrl(entry.cik, entry.accession)}/${entry.accession}-index.htm`,
          },
          entity_hints: {
            company_name: companyName,
            cik: entry.cik,
            state: parsed.stateOrCountry ?? undefined,
            industry: parsed.industryGroup ?? undefined,
          },
          event_type: 'funding',
          published_at: parseFiledDate(entry.dateFiled) ?? undefined,
        });

        seenAccessions.add(entry.accession);
      }
    }

    // Bound the cursor: it exists to stop us re-fetching primary_doc.xml for
    // filings we already hold, not to be a permanent ledger. The unique index
    // on (source_id, external_id) is the real idempotency guarantee.
    const trimmed = Array.from(seenAccessions).slice(-5000);

    return {
      observations,
      cursor: { seen_accessions: trimmed, last_index_date: dates[0]?.toISOString() ?? null },
      meta: {
        index_days_read: indexDays,
        form_d_candidates: candidates,
        skipped_investment_vehicle: skippedVehicle,
        skipped_below_min_amount: skippedAmount,
        // A full page is conservatively treated as incomplete. The durable
        // seen-accession cursor makes the next invocation continue this same
        // date window without duplicating rows.
        has_more: observations.length >= limit,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// 8-K — M&A
// ---------------------------------------------------------------------------

/**
 * 8-K is a high-volume form (hundreds a day) and only two of its items are
 * acquisition signals:
 *   1.01 Entry into a Material Definitive Agreement
 *   2.01 Completion of Acquisition or Disposition of Assets
 *
 * The item list lives in the SGML header of the submission .txt, so we can
 * filter on a cheap header read and only keep filings that qualify. We take the
 * header bytes rather than the whole document because a full 8-K with exhibits
 * can run to megabytes and we only need the first few hundred lines.
 */
const MA_ITEM_PATTERN = /ITEM INFORMATION:\s*(.*)/gi;
const MA_ITEMS = [
  'Entry into a Material Definitive Agreement',
  'Completion of Acquisition or Disposition of Assets',
];

export const edgar8kCollector: Collector = {
  key: 'edgar_8k',
  kind: 'edgar',

  async collect({ source, since, limit, signal }: CollectContext): Promise<CollectResult> {
    const maxDays = Number(source.config.max_days ?? 3);
    const dates = datesSince(since, maxDays);

    const observations: RawObservation[] = [];
    const seen = new Set<string>((source.cursor.seen_accessions as string[] | undefined) ?? []);
    let candidates = 0;
    let matched = 0;

    for (const date of dates) {
      if (signal?.aborted || observations.length >= limit) break;

      const entries = await fetchDailyIndex(date, signal);
      const eightKs = entries.filter((e) => e.formType === '8-K');
      candidates += eightKs.length;

      for (const entry of eightKs) {
        if (signal?.aborted || observations.length >= limit) break;
        if (seen.has(entry.accession)) continue;
        seen.add(entry.accession);

        const url = `https://www.sec.gov/Archives/${entry.fileName}`;
        const resp = await fetchWithRetry(url, {
          headers: { ...SEC_HEADERS, Range: 'bytes=0-8192' },
          limiter: secLimiter,
          signal,
          allow404: true,
          retries: 1,
        });
        if (!resp) continue;
        const header = await resp.text().catch(() => '');
        if (!header) continue;

        const items: string[] = [];
        for (const m of header.matchAll(MA_ITEM_PATTERN)) {
          const item = m[1]?.trim();
          if (item) items.push(item);
        }
        if (!items.some((i) => MA_ITEMS.some((t) => i.toLowerCase().includes(t.toLowerCase())))) {
          continue;
        }
        matched++;

        observations.push({
          external_id: entry.accession,
          source_url: `${filingBaseUrl(entry.cik, entry.accession)}/${entry.accession}-index.htm`,
          title: `${entry.companyName} — 8-K (${items.join('; ')})`,
          structured: {
            event_type: 'acquisition',
            company_name: entry.companyName,
            cik: entry.cik,
            form_type: '8-K',
            items,
            filed_at: entry.dateFiled,
            evidence_url: `${filingBaseUrl(entry.cik, entry.accession)}/${entry.accession}-index.htm`,
          },
          entity_hints: { company_name: entry.companyName, cik: entry.cik },
          event_type: 'acquisition',
          published_at: parseFiledDate(entry.dateFiled) ?? undefined,
        });
      }
    }

    return {
      observations,
      cursor: { seen_accessions: Array.from(seen).slice(-20000) },
      meta: {
        eight_k_candidates: candidates,
        matched_ma_items: matched,
        has_more: observations.length >= limit,
      },
    };
  },
};
