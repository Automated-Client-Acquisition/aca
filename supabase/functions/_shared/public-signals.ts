/**
 * Shared write path for the database-driven public /signals feed.
 *
 * One helper used by every push surface (the `push-public-signal` edge function
 * for the `aca` CLI + scraper, and the MCP `push_public_signal` tool). It upserts
 * a signal event into `public_signals` (idempotent on `dedup_key`) and any
 * attached decision-makers into the company-keyed `public_signal_people` table
 * (idempotent on `company_key + linkedin_url`), which the read RPC joins by
 * `lower(company_name)`. Optional firmographics land in the company-keyed
 * `public_signal_companies`, the table the auto-add size/revenue gates read.
 *
 * Reads happen via the SECURITY DEFINER RPCs; writes require a service-role
 * client (the tables are RLS-locked).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

export const PUBLIC_SIGNAL_TYPES = [
  "funding", "acquisition", "hiring", "hiring_demand", "job_change",
  "executive_hire", "customer_win", "award", "growth",
] as const;

export type PublicSignalType = (typeof PUBLIC_SIGNAL_TYPES)[number];

/** The Hermes web-scout: visits and evaluates the source page before pushing. */
export const HERMES_WEB_SOURCE = "hermes_web";
/** ACA-owned collector/refinery. Native rows must clear the same evidence gate. */
export const ACA_NATIVE_SOURCE = "aca_native";

/**
 * Sources permitted to publish straight to the public feed.
 *
 * Being on this list buys nothing on its own — a publishing caller still has to
 * clear `verified`, `quality_score >= 0.8` and an exact company identifier. It
 * only says the source is expected to have read the page it is citing, which is
 * the part no validator can check. `source_key` stays on the row, so one
 * source's signals can be audited or unpublished as a group.
 */
export const PUBLISHING_SOURCES = [HERMES_WEB_SOURCE, ACA_NATIVE_SOURCE, "n8n_web"] as const;

export interface PushSignalPerson {
  full_name: string;
  /** Required — part of the (company_key, linkedin_url) uniqueness key. */
  linkedin_url: string;
  title?: string | null;
  photo_url?: string | null;
  seniority_rank?: number | null;
  /** Optional verified business email. Shown only in authenticated library UI. */
  email?: string | null;
  /** verified | valid | catch_all | etc. Defaults to verified when email is present. */
  email_status?: string | null;
}

/**
 * Company firmographics, stored in the company-keyed `public_signal_companies`
 * table that the auto-add size/revenue gates read. Optional on a push: a signal
 * without it still saves, it just cannot match a sized rule (an unknown
 * firmographic is dropped by a set gate, same as the country gate).
 *
 * Only the keys present are written, so a thin push never blanks out richer
 * data a previous MoltSets enrichment already stored.
 */
export interface PushSignalCompany {
  /** Exact headcount — NOT the band. See note in upsertPublicSignal. */
  employee_count?: number | null;
  employee_range?: string | null;
  revenue_range?: string | null;
  industry?: string | null;
  linkedin_industries?: string[] | null;
  naics_titles?: string[] | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  /** Defaults to the signal's domain. */
  domain?: string | null;
  /** Provenance, e.g. "moltsets". Defaults to "push". */
  source?: string | null;
}

export interface PushSignalInput {
  company_name: string;
  signal_type: PublicSignalType;
  source_url: string;
  domain?: string | null;
  country?: string | null;
  location?: string | null;
  title?: string | null;
  summary?: string | null;
  why_it_matters?: string | null;
  amount_label?: string | null;
  amount_usd?: number | null;
  signal_date?: string | null;        // YYYY-MM-DD; defaults to today (UTC)
  date_precision?: "source" | "collected";
  source_key?: string | null;
  source_label?: string | null;
  confidence?: number | null;
  quality_score?: number | null;
  verified?: boolean;
  published?: boolean;
  company_linkedin_url?: string | null;
  logo_url?: string | null;
  dedup_key?: string | null;
  metadata?: Record<string, unknown> | null;
  people?: PushSignalPerson[];
  company?: PushSignalCompany | null;
}

export interface UpsertResult {
  id: string;
  company_name: string;
  company_key: string;
  signal_type: string;
  published: boolean;
  dedup_key: string;
  people_upserted: number;
  company_upserted: boolean;
}

/** Rough title → seniority score, mirrors enrich-signal-people. Higher = more senior. */
function seniorityRank(title?: string | null): number {
  const t = (title || "").toLowerCase();
  if (!t) return 0;
  if (/\b(founder|co-?founder|owner|ceo|chief executive|president|managing director|managing partner)\b/.test(t)) return 100;
  if (/\bc[tfdmiore]o\b|\bchief\b/.test(t)) return 90;
  if (/\b(partner|general partner|gp)\b/.test(t)) return 80;
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return 70;
  if (/\b(head of|head,|director)\b/.test(t)) return 60;
  return 0;
}

function hostFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "source"; }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isCanonicalPersonLinkedIn(value: string): boolean {
  return /^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#]+\/?$/i.test(value.trim());
}

class PushValidationError extends Error {}

export function validatePushSignal(input: PushSignalInput): void {
  if (!input || typeof input !== "object") throw new PushValidationError("signal payload is required");
  if (!input.company_name || !input.company_name.trim()) throw new PushValidationError("company_name is required");
  if (!input.signal_type) throw new PushValidationError("signal_type is required");
  if (!PUBLIC_SIGNAL_TYPES.includes(input.signal_type)) {
    throw new PushValidationError(`signal_type must be one of: ${PUBLIC_SIGNAL_TYPES.join(", ")}`);
  }
  if (!input.source_url || !input.source_url.trim()) throw new PushValidationError("source_url is required");
  if (!isHttpUrl(input.source_url)) throw new PushValidationError("source_url must be an http(s) URL");
  if (input.signal_date && !/^\d{4}-\d{2}-\d{2}$/.test(input.signal_date)) {
    throw new PushValidationError("signal_date must be YYYY-MM-DD");
  }
  for (const p of input.people ?? []) {
    if (!p.full_name || !p.full_name.trim()) throw new PushValidationError("each person needs a full_name");
    if (!p.linkedin_url || !isCanonicalPersonLinkedIn(p.linkedin_url)) {
      throw new PushValidationError("each person needs a canonical personal LinkedIn URL");
    }
    if (seniorityRank(p.title) < 60) {
      throw new PushValidationError("each person must have a senior decision-maker title");
    }
    if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) {
      throw new PushValidationError("person email must be a valid address when provided");
    }
  }

  const company = input.company;
  if (company) {
    if (typeof company !== "object" || Array.isArray(company)) {
      throw new PushValidationError("company must be an object");
    }
    const count = company.employee_count;
    if (count !== undefined && count !== null) {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        throw new PushValidationError("company.employee_count must be a non-negative integer");
      }
    }
    for (const key of ["linkedin_industries", "naics_titles"] as const) {
      const value = company[key];
      if (value !== undefined && value !== null) {
        if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
          throw new PushValidationError(`company.${key} must be an array of strings`);
        }
      }
    }
  }

  // The public surface is evidence-led, not a dump of every discovered row.
  // A publishing source is one that visits and evaluates the source page before
  // pushing (Hermes, and the n8n scout). Any other caller may still save a
  // record with published:false for review, but cannot expose it publicly.
  if (input.published !== false) {
    if (!PUBLISHING_SOURCES.includes(input.source_key as typeof PUBLISHING_SOURCES[number])) {
      throw new PushValidationError(
        `published public signals must come from a source that reads its evidence (${PUBLISHING_SOURCES.join(", ")})`,
      );
    }
    if (input.verified !== true) {
      throw new PushValidationError("published public signals must be verified against the source page");
    }
    if (!input.domain?.trim() && !input.company_linkedin_url?.trim()) {
      throw new PushValidationError("published public signals need an exact company domain or company LinkedIn URL");
    }
    if (typeof input.quality_score !== "number" || input.quality_score < 0.8) {
      throw new PushValidationError("published public signals need a quality_score of at least 0.8");
    }
  }
}

/**
 * Upsert one public signal (and its people). Throws PushValidationError on bad
 * input; lets DB errors bubble. `supabase` must be a service-role client.
 */
export async function upsertPublicSignal(
  supabase: SupabaseClient,
  input: PushSignalInput,
  opts: { createdBy?: string | null } = {},
): Promise<UpsertResult> {
  validatePushSignal(input);

  const companyName = input.company_name.trim();
  const companyKey = companyName.toLowerCase();
  const sourceKey = input.source_key?.trim() || null;
  const sourceLabel = input.source_label?.trim() || sourceKey || hostFromUrl(input.source_url);
  const dedupKey = (input.dedup_key?.trim()) ||
    `${companyKey}|${input.signal_type}|${input.source_url.trim()}`;

  const row = {
    company_name: companyName,
    domain: input.domain?.trim() || null,
    country: input.country?.trim() || null,
    location: input.location?.trim() || null,
    signal_type: input.signal_type,
    title: input.title?.trim() || null,
    summary: input.summary?.trim() || null,
    why_it_matters: input.why_it_matters?.trim() || null,
    amount_label: input.amount_label?.trim() || null,
    amount_usd: input.amount_usd ?? null,
    signal_date: input.signal_date || new Date().toISOString().slice(0, 10),
    date_precision: input.date_precision === "collected" ? "collected" : "source",
    source_key: sourceKey,
    source_label: sourceLabel,
    source_url: input.source_url.trim(),
    confidence: input.confidence ?? 0,
    quality_score: input.quality_score ?? 0,
    verified: input.verified ?? false,
    published: input.published ?? true,
    company_linkedin_url: input.company_linkedin_url?.trim() || null,
    logo_url: input.logo_url?.trim() || null,
    dedup_key: dedupKey,
    metadata: input.metadata ?? {},
    created_by: opts.createdBy ?? null,
  };

  const { data: signal, error } = await supabase
    .from("public_signals")
    .upsert(row, { onConflict: "dedup_key" })
    .select("id, company_name, signal_type, published, dedup_key")
    .single();
  if (error) throw error;

  let peopleUpserted = 0;
  const people = input.people ?? [];
  if (people.length > 0) {
    const peopleRows = people.map((p) => {
      const email = p.email?.trim().toLowerCase() || null;
      const statusRaw = (p.email_status || (email ? "verified" : "")).trim().toLowerCase();
      const emailStatus = email
        ? (["verified", "valid", "catch_all", "catch-all"].includes(statusRaw) ? (statusRaw === "catch-all" ? "catch_all" : statusRaw === "valid" ? "verified" : statusRaw) : "verified")
        : null;
      return {
        company_key: companyKey,
        company_linkedin_url: input.company_linkedin_url?.trim() || null,
        domain: input.domain?.trim() || null,
        full_name: p.full_name.trim(),
        title: p.title?.trim() || null,
        linkedin_url: p.linkedin_url.trim(),
        photo_url: p.photo_url?.trim() || null,
        seniority_rank: p.seniority_rank ?? seniorityRank(p.title),
        source: "push",
        email,
        email_status: emailStatus,
      };
    });
    const { error: pErr } = await supabase
      .from("public_signal_people")
      .upsert(peopleRows, { onConflict: "company_key,linkedin_url" });
    if (pErr) throw pErr;
    peopleUpserted = peopleRows.length;
  }

  // Firmographics live in their own company-keyed table — it is what the
  // auto-add employee/revenue gates read, and it is shared with the MoltSets
  // enrichment cron. Two rules follow from that:
  //
  //  - Only keys the caller actually sent are written. PostgREST builds the
  //    ON CONFLICT update list from the payload, so omitting a field preserves
  //    whatever richer value is already stored rather than nulling it.
  //  - `employee_count` must be the EXACT headcount, not a band. The gates
  //    derive bands from it (`public.signal_employee_band`) because MoltSets'
  //    smallest band, 1-10, cannot separate a solo founder from a small team;
  //    a company known only as 1-10 is treated as unknown.
  //
  // Writing here also refreshes `enriched_at`, which makes `enrich-signal-people`
  // treat the company as fresh and skip re-buying it — intended when the caller
  // is passing MoltSets data through, and the reason an empty block is ignored.
  let companyUpserted = false;
  const company = input.company;
  if (company) {
    const companyRow: Record<string, unknown> = { company_key: companyKey };

    const domain = company.domain?.trim() || input.domain?.trim() || null;
    if (domain) companyRow.domain = domain;

    if (company.employee_count !== undefined && company.employee_count !== null) {
      companyRow.employee_count = company.employee_count;
    }
    for (const key of ["employee_range", "revenue_range", "industry", "country", "state", "city"] as const) {
      const value = company[key]?.trim();
      if (value) companyRow[key] = value;
    }
    for (const key of ["linkedin_industries", "naics_titles"] as const) {
      const value = company[key];
      if (Array.isArray(value) && value.length > 0) {
        companyRow[key] = value.map((v) => v.trim()).filter(Boolean);
      }
    }

    // Nothing beyond the key and the domain we already knew: writing would only
    // bump enriched_at and starve the enrichment cron of a company to resolve.
    const hasFirmographics = Object.keys(companyRow).some(
      (k) => k !== "company_key" && k !== "domain",
    );
    if (hasFirmographics) {
      companyRow.source = company.source?.trim() || "push";
      companyRow.enriched_at = new Date().toISOString();

      const { error: cErr } = await supabase
        .from("public_signal_companies")
        .upsert(companyRow, { onConflict: "company_key" });
      if (cErr) throw cErr;
      companyUpserted = true;
    }
  }

  return {
    id: signal.id,
    company_name: signal.company_name,
    company_key: companyKey,
    signal_type: signal.signal_type,
    published: signal.published,
    dedup_key: signal.dedup_key,
    people_upserted: peopleUpserted,
    company_upserted: companyUpserted,
  };
}

/** Batch helper — upserts many signals, collecting per-item errors. */
export async function upsertPublicSignals(
  supabase: SupabaseClient,
  inputs: PushSignalInput[],
  opts: { createdBy?: string | null } = {},
): Promise<{ ok: UpsertResult[]; errors: { index: number; error: string }[] }> {
  const ok: UpsertResult[] = [];
  const errors: { index: number; error: string }[] = [];
  for (let i = 0; i < inputs.length; i++) {
    try {
      ok.push(await upsertPublicSignal(supabase, inputs[i], opts));
    } catch (e) {
      errors.push({ index: i, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, errors };
}

export { PushValidationError };
