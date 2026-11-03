/**
 * SignalBase pack source module — calls the SignalBase Apify actor
 * (signalbase/signalbase-api, id `fzywn8Ow4rvDK6VPc`).
 *
 * Replaces the regex-based Crunchbase / SEC / Product Hunt / TechCrunch / VC
 * scrapers. One synchronous Apify run per pack refresh, clean structured
 * records returned in the dataset.
 *
 * Auth: existing `provider='apify'` API key in api_keys (already used by
 * apify-leads-import). No SignalBase-specific account or token needed —
 * the Apify actor handles SignalBase access on the user's behalf.
 *
 * Pricing: $0.01 / result + $0.00005 startup on the actor itself.
 */

import type { AsyncRunHandle, PackModule } from '../types.ts';
import type { DiscoveryRecord } from '../types.ts';
import { decryptApiKey } from '../../../apify-leads-utils.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

export type SignalType = 'funding' | 'acquisitions' | 'hiring' | 'job-changes';

const APIFY_ACTOR_ID = 'fzywn8Ow4rvDK6VPc';
const APIFY_SYNC_URL = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items`;
const APIFY_ASYNC_RUN_URL = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs`;

/**
 * SignalBase actor record (verified against live datasets 2026-05-03).
 * Each row is one signal. Field shape varies by signalType:
 *
 *  - funding/acquisitions: company-level signal with roundType/amount/investors
 *  - hiring: ONE JOB POSTING per record (jobId, title, seniorityLevel,
 *    jobFunction, datePosted, location, city, region) plus the hiring company
 *    flattened as companyXxx. The actor does NOT echo back the `positions` /
 *    `departments` / `seniorities` filter values into the record.
 *  - job-changes: signal carries personName, personLinkedinUrl, newRole, oldRole
 */
interface SignalBaseSignal {
  // Universal / shared
  id?: string;
  signalId?: string;
  signalType?: string;
  occurredAt?: string;
  discoveredAt?: string;
  createdAt?: string;
  // Company (flattened with companyXxx prefix)
  companyId?: string;
  companyName?: string;
  companySlug?: string;
  companyLogo?: string;
  companyDescription?: string | null;
  companyWebsite?: string | null;
  companyLinkedin?: string | null;
  companyLinkedinUrl?: string | null;
  companyTwitter?: string | null;
  companyIndustry?: string | null;
  companySubcategory?: string | null;
  companyCategories?: string | null;
  companySpecialties?: string | null;
  companyCountry?: string | null;
  companyFoundedYear?: number | null;
  companyEmployeeCount?: number | null;
  companyLogoUrl?: string | null;
  // Funding-specific
  roundType?: string;
  roundFlavor?: string | null;
  amount?: number;
  currency?: string;
  announcedDate?: string;
  investors?: Array<{ name?: string; logo?: string } | string>;
  // Acquisition-specific
  acquiringCompanyId?: string | null;
  acquiringCompanyName?: string | null;
  acquiringCompanySlug?: string | null;
  acquiringCompanyLogo?: string | null;
  acquiringCompanyWebsite?: string | null;
  acquiringCompanyLinkedin?: string | null;
  acquiringCompanyIndustry?: string | null;
  acquiringCompanyCountry?: string | null;
  acquiringCompanyFoundedYear?: number | null;
  acquiringCompanyEmployeeCount?: number | null;
  acquiringCompany?: Record<string, unknown> | null;
  percentage?: number | null;
  // Hiring-specific (per actual actor output). `id` and `createdAt` are
  // declared once in the universal block above; the actor sends the same keys
  // for hiring records, so they are not redeclared here.
  jobId?: string;
  jobUrl?: string;
  title?: string;                 // job title, e.g. "Plant Controller"
  location?: string;
  city?: string;
  region?: string;
  country?: string;
  jobCountry?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string;
  seniorityLevel?: string;        // "Director", "Mid-Senior level", etc.
  jobFunction?: string;           // "Accounting/Auditing and Finance"
  industries?: string;            // free-text on the job posting
  numApplicants?: string | null;
  descriptionText?: string;
  position?: string;
  department?: string;
  seniority?: string;
  // Job-change-specific
  personName?: string;
  personLinkedinUrl?: string;
  newRole?: string;
  oldRole?: string;
  postContent?: string;
  source?: string;
  // Universal
  confidenceScore?: number;
  verificationStatus?: string;
  isFreeAccess?: boolean;
  sources?: Array<{
    url?: string;
    sourceType?: string;
    title?: string | null;
    publishedAt?: string | null;
    isPrimary?: boolean;
  }>;
}

interface SignalBaseConfig {
  countries?: string;          // 'US,GB,FR'
  round?: string;              // 'Seed,Series A,Series B'
  round_flavor?: string;
  amount_min?: number;
  amount_max?: number;
  currency?: string;
  verification_status?: string;
  investor_name?: string;
  industry?: string;
  categories?: string;
  employee_count_min?: number;
  employee_count_max?: number;
  positions?: string;
  departments?: string;
  seniorities?: string;
  states?: string;
  city?: string;
  team_size?: string;
  applicants?: string;
  personLinkedinUrl?: string;
  companyLinkedinUrl?: string;
  search?: string;
  date_preset?: 'today' | 'last_7d' | 'last_14d' | 'last_30d' | 'last_60d' | 'last_90d';
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

interface SignalDetail {
  type: string;
  date: string;
  detail: string;
  evidence_url: string;
  context: Record<string, unknown>;
}

function buildQueryString(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) usp.set(k, v.join(','));
    } else {
      usp.set(k, String(v));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

function formatMoney(amount: number, currency = 'USD'): string {
  const rounded = Math.round(amount);
  if (currency === 'USD') return `$${rounded.toLocaleString()}`;
  return `${rounded.toLocaleString()} ${currency}`;
}

function parseCategories(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // SignalBase can also return a plain delimiter-separated string.
  }
  return raw.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
}

function buildOutreachContext(signalType: SignalType, rec: SignalBaseSignal, detail: string, date: string): string {
  const company = rec.companyName ?? 'This company';
  switch (signalType) {
    case 'funding': {
      const investors = (rec.investors ?? [])
        .map((i) => (typeof i === 'string' ? i : (i.name ?? '')))
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      return `${company} announced ${detail} on ${date}${investors ? ` with ${investors}` : ''}.`;
    }
    case 'hiring': {
      const role = rec.title ?? rec.position ?? 'new roles';
      const functionLabel = rec.jobFunction ?? rec.department;
      return `${company} is hiring for ${role}${functionLabel ? ` in ${functionLabel}` : ''}${rec.location ? ` (${rec.location})` : ''}, detected on ${date}.`;
    }
    case 'job-changes':
      return rec.personName
        ? `${rec.personName} moved into ${rec.newRole ?? 'a new leadership role'} at ${company}, detected on ${date}.`
        : `${company} had a leadership change detected on ${date}.`;
    case 'acquisitions': {
      const acquirer = rec.acquiringCompanyName ? ` involving ${rec.acquiringCompanyName}` : '';
      const value = typeof rec.amount === 'number' && rec.amount > 0
        ? ` valued at ${formatMoney(rec.amount, rec.currency ?? 'USD')}`
        : '';
      return `${company} showed acquisition activity${acquirer}${value}, detected on ${date}.`;
    }
  }
}

function buildSignalContext(signalType: SignalType, rec: SignalBaseSignal, detail: string, date: string, evidenceUrl: string): Record<string, unknown> {
  const sourceUrls = (rec.sources ?? [])
    .map((s) => s.url)
    .filter((u): u is string => !!u);
  const investorNames = (rec.investors ?? [])
    .map((i) => (typeof i === 'string' ? i : (i.name ?? '')))
    .filter(Boolean);

  return {
    signal_id: rec.signalId ?? null,
    signal_type_raw: rec.signalType ?? signalType,
    occurred_at: rec.occurredAt ?? null,
    discovered_at: rec.discoveredAt ?? null,
    signal_date: date,
    signal_detail: detail,
    outreach_context: buildOutreachContext(signalType, rec, detail, date),
    evidence_url: evidenceUrl,
    source_urls: sourceUrls,
    sources: (rec.sources ?? []).map((s) => ({
      url: s.url ?? null,
      source_type: s.sourceType ?? null,
      title: s.title ?? null,
      published_at: s.publishedAt ?? null,
      is_primary: !!s.isPrimary,
    })),
    confidence_score: rec.confidenceScore ?? null,
    verification_status: rec.verificationStatus ?? null,
    free_access: rec.isFreeAccess ?? null,
    company: {
      id: rec.companyId ?? null,
      name: rec.companyName ?? null,
      slug: rec.companySlug ?? null,
      website: rec.companyWebsite ?? null,
      linkedin: rec.companyLinkedin ?? rec.companyLinkedinUrl ?? null,
      twitter: rec.companyTwitter ?? null,
      industry: rec.companyIndustry ?? null,
      subcategory: rec.companySubcategory ?? null,
      categories: parseCategories(rec.companyCategories),
      country: rec.companyCountry ?? null,
      founded_year: rec.companyFoundedYear ?? null,
      employee_count: rec.companyEmployeeCount ?? null,
      description: rec.companyDescription ?? null,
      logo: rec.companyLogo ?? rec.companyLogoUrl ?? null,
    },
    funding: signalType === 'funding'
      ? {
          round_type: rec.roundType ?? null,
          round_flavor: rec.roundFlavor ?? null,
          amount: rec.amount ?? null,
          currency: rec.currency ?? null,
          announced_date: rec.announcedDate ?? null,
          investors: investorNames,
        }
      : null,
    hiring: signalType === 'hiring'
      ? {
          id: rec.id ?? null,
          job_id: rec.jobId ?? null,
          job_url: rec.jobUrl ?? null,
          title: rec.title ?? rec.position ?? null,
          location: rec.location ?? null,
          city: rec.city ?? null,
          region: rec.region ?? null,
          country: rec.country ?? null,
          date_posted: rec.datePosted ?? null,
          valid_through: rec.validThrough ?? null,
          employment_type: rec.employmentType ?? null,
          seniority_level: rec.seniorityLevel ?? rec.seniority ?? null,
          job_function: rec.jobFunction ?? rec.department ?? null,
          industries: rec.industries ?? null,
          num_applicants: rec.numApplicants ?? null,
          description_text: rec.descriptionText ?? null,
          created_at: rec.createdAt ?? null,
        }
      : null,
    job_change: signalType === 'job-changes'
      ? {
          person_name: rec.personName ?? null,
          person_linkedin_url: rec.personLinkedinUrl ?? null,
          new_role: rec.newRole ?? null,
          old_role: rec.oldRole ?? null,
          post_content: rec.postContent ?? null,
          source: rec.source ?? null,
          company_linkedin_url: rec.companyLinkedinUrl ?? rec.companyLinkedin ?? null,
        }
      : null,
    acquisition: signalType === 'acquisitions'
      ? {
          acquiring_company_id: rec.acquiringCompanyId ?? null,
          acquiring_company_name: rec.acquiringCompanyName ?? null,
          acquiring_company_slug: rec.acquiringCompanySlug ?? null,
          acquiring_company_logo: rec.acquiringCompanyLogo ?? null,
          acquiring_company_website: rec.acquiringCompanyWebsite ?? null,
          acquiring_company_linkedin: rec.acquiringCompanyLinkedin ?? null,
          acquiring_company_industry: rec.acquiringCompanyIndustry ?? null,
          acquiring_company_country: rec.acquiringCompanyCountry ?? null,
          acquiring_company_founded_year: rec.acquiringCompanyFoundedYear ?? null,
          acquiring_company_employee_count: rec.acquiringCompanyEmployeeCount ?? null,
          acquiring_company: rec.acquiringCompany ?? null,
          amount: rec.amount ?? null,
          currency: rec.currency ?? null,
          percentage: rec.percentage ?? null,
          announced_date: rec.announcedDate ?? null,
        }
      : null,
  };
}

function buildSignalDetail(signalType: SignalType, rec: SignalBaseSignal): SignalDetail {
  // Date precedence varies: hiring uses datePosted, funding uses announcedDate.
  const dateRaw =
    rec.announcedDate
    ?? rec.datePosted
    ?? rec.occurredAt
    ?? rec.discoveredAt
    ?? rec.createdAt
    ?? new Date().toISOString();
  const date = String(dateRaw).slice(0, 10);

  let detail = '';
  let detailType = '';
  switch (signalType) {
    case 'funding': {
      detailType = 'just_funded';
      const parts: string[] = [];
      if (rec.roundType) parts.push(`${rec.roundType.charAt(0).toUpperCase()}${rec.roundType.slice(1)}`);
      if (typeof rec.amount === 'number') {
        parts.push(formatMoney(rec.amount, rec.currency ?? 'USD'));
      }
      const investorNames = (rec.investors ?? [])
        .map((i) => (typeof i === 'string' ? i : (i.name ?? '')))
        .filter(Boolean);
      if (investorNames.length > 0) parts.push(`${investorNames.slice(0, 2).join(', ')}-led`);
      detail = parts.join(', ') || 'Funding round announced';
      break;
    }
    case 'acquisitions':
      detailType = 'recent_acquisition';
      detail = rec.acquiringCompanyName
        ? `Acquisition activity: ${rec.acquiringCompanyName}`
        : 'Acquisition activity detected';
      break;
    case 'hiring': {
      detailType = 'aggressive_hiring';
      // Hiring records are job postings; the actor returns title/seniorityLevel/
      // jobFunction/location. position/department/seniority are filter inputs
      // (kept for compat with older actor versions).
      const parts: string[] = [];
      if (rec.title || rec.position) parts.push(rec.title ?? rec.position!);
      if (rec.seniorityLevel) parts.push(`(${rec.seniorityLevel})`);
      else if (rec.seniority) parts.push(`(${rec.seniority})`);
      if (rec.jobFunction || rec.department) parts.push(`[${rec.jobFunction ?? rec.department}]`);
      if (rec.location) parts.push(`in ${rec.location}`);
      else if (rec.city) parts.push(`in ${rec.city}${rec.region ? ', ' + rec.region : ''}`);
      detail = parts.length > 0 ? `Hiring: ${parts.join(' ')}` : 'Aggressive hiring activity';
      break;
    }
    case 'job-changes':
      detailType = 'new_leadership';
      detail = rec.personName
        ? `${rec.personName} now ${rec.newRole ?? 'in new role'}`
        : `Executive change${rec.newRole ? `: ${rec.newRole}` : ''}`;
      break;
  }

  const primarySource = rec.sources?.find((s) => s.isPrimary) ?? rec.sources?.[0];
  const evidenceUrl = primarySource?.url
    ?? rec.jobUrl
    ?? (rec.companySlug ? `https://app.trysignalbase.com/${signalType}/${rec.companySlug}` : '');

  return {
    type: detailType,
    date,
    detail,
    evidence_url: evidenceUrl,
    context: buildSignalContext(signalType, rec, detail, date, evidenceUrl),
  };
}

function normalizeLinkedInUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  return t.startsWith('http') ? t : `https://${t}`;
}

function normalizeWebsite(raw: string | null | undefined): { domain: string | null; url: string | null } {
  if (!raw) return { domain: null, url: null };
  let url = raw.trim();
  if (!url) return { domain: null, url: null };
  if (!url.startsWith('http')) url = `https://${url}`;
  try {
    const u = new URL(url);
    return { domain: u.hostname.toLowerCase().replace(/^www\./, ''), url };
  } catch {
    return { domain: null, url: null };
  }
}

/**
 * ACA-internal fields that pollute the actor input if they slip through
 * from `pack_subscriptions.config`. The SignalBase actor schema doesn't
 * know about these — they're our own pipeline knobs.
 */
const ACA_INTERNAL_FIELDS = new Set([
  'dm_filter',
  'daily_cap',
  'weekly_cap',
  'icp_id',
  'min_icp_score',
  'refresh_cadence',
  'max_results_per_refresh',
  // Person-first fields that don't apply to SignalBase
  'engagement_mode',
  'monitor_profile_urls',
  'post_urls',
  'engagement_types',
  'comments_lookback',
  'posts_lookback',
  'max_posts_per_profile',
  'max_engagement_per_post',
  'account_id',
  'sources',
  'post_ids',
  'exclude_if_outbound_within_days',
  'search_query',
  'posted_limit',
]);

function sanitizeForActor(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (ACA_INTERNAL_FIELDS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

async function fetchSignalBase(
  apifyToken: string,
  signalType: SignalType,
  params: SignalBaseConfig,
  signal?: AbortSignal,
): Promise<SignalBaseSignal[]> {
  // The actor takes SignalBase API params directly as the run input.
  // Returns dataset items (one row per signal record) on completion.
  const url = `${APIFY_SYNC_URL}?token=${apifyToken}&format=json`;
  const input = { signalType, ...sanitizeForActor(params as Record<string, unknown>) };
  console.log(`[signalbase] POST ${signalType} input=${JSON.stringify(input).slice(0, 300)}`);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`SignalBase actor ${signalType} ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const json = await resp.json();
  if (Array.isArray(json)) return json as SignalBaseSignal[];
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as SignalBaseSignal[];
    if (Array.isArray(obj.results)) return obj.results as SignalBaseSignal[];
    if (Array.isArray(obj.items)) return obj.items as SignalBaseSignal[];
  }
  return [];
}

interface BuildOptions {
  packKey: string;
  signalType: SignalType;
  defaultFilters?: Partial<SignalBaseConfig>;
  label: string;
  tier: 'signal' | 'trade' | 'pro_services';
}

/**
 * Map one raw SignalBase actor record into our canonical DiscoveryRecord
 * shape. Pulled out of the run() loop so the async path (apify-poller →
 * dataset items) can use the same translation.
 *
 * Returns null when the record is unusable (no companyName).
 */
function mapSignalBaseRecord(
  rec: SignalBaseSignal,
  ctx: { signalType: SignalType; moduleKey: string },
): DiscoveryRecord | null {
  if (!rec.companyName) return null;
  // The actor schema documents `companyLinkedinUrl` but some modules return
  // `companyLinkedin`. Accept both.
  const linkedinUrl = normalizeLinkedInUrl(rec.companyLinkedinUrl ?? rec.companyLinkedin);
  const { domain, url } = normalizeWebsite(rec.companyWebsite);
  const sigDetail = buildSignalDetail(ctx.signalType, rec);

  const out: DiscoveryRecord = {
    company: {
      company_name: rec.companyName,
      domain,
      website_url: url,
      linkedin_url: linkedinUrl,
      employee_signal:
        rec.companyEmployeeCount != null
          ? `${rec.companyEmployeeCount} employees (signalbase)`
          : null,
      employee_count_estimate:
        typeof rec.companyEmployeeCount === 'number' ? rec.companyEmployeeCount : null,
      country: rec.companyCountry ?? null,
      source: 'directory',
      raw_html_snippet: null,
    },
    signal_metadata: sigDetail,
    source: ctx.moduleKey,
    source_url:
      sigDetail.evidence_url
      || `https://app.trysignalbase.com/${ctx.signalType}/${rec.companySlug ?? rec.signalId ?? ''}`,
    // Carry every raw SignalBase field through so the activity feed can
    // show the full datapoint set — the user picks what's useful without
    // us guessing.
    raw_signal: rec as unknown as Record<string, unknown>,
  };

  // Job-change records arrive with the person attached — pass through as DM hint.
  if (ctx.signalType === 'job-changes' && rec.personName) {
    out.person = {
      first: rec.personName.split(/\s+/)[0],
      last: rec.personName.split(/\s+/).slice(1).join(' '),
      title: rec.newRole ?? '',
      linkedin_url: rec.personLinkedinUrl,
    };
  }

  return out;
}

/**
 * Kick off a SignalBase actor run asynchronously. Returns the run handle
 * (run_id + dataset_id). The apify-poller resumes processing once Apify
 * marks the run SUCCEEDED.
 *
 * The sync `run-sync-get-dataset-items` path silently fails on big queries
 * (US-wide hiring, etc.) because of Apify's 5-minute sync timeout. Async
 * lets the actor take 5-30 minutes if it needs to.
 */
async function kickoffActorRun(
  apifyToken: string,
  signalType: SignalType,
  params: SignalBaseConfig,
  abortSignal?: AbortSignal,
): Promise<{ run_id: string; dataset_id: string }> {
  const url = `${APIFY_ASYNC_RUN_URL}?token=${apifyToken}`;
  const input = { signalType, ...sanitizeForActor(params as Record<string, unknown>) };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: abortSignal,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`SignalBase actor kickoff ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const json = await resp.json();
  // Apify wraps responses in { data: {...} }
  const data = (json as { data?: Record<string, unknown> }).data ?? (json as Record<string, unknown>);
  const run_id = (data.id as string) ?? '';
  const dataset_id = (data.defaultDatasetId as string) ?? '';
  if (!run_id || !dataset_id) {
    throw new Error(`SignalBase actor returned malformed run handle: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { run_id, dataset_id };
}

export function buildSignalBaseModule(opts: BuildOptions): PackModule {
  const moduleKey = `signalbase_${opts.signalType.replace('-', '_')}`;
  return {
    key: moduleKey,
    pack: opts.packKey,
    tier: opts.tier,
    label: opts.label,
    async *run({ organizationId, filters, sinceIso, limit, signal }) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
      if (!encryptionKey) {
        throw new Error('ENCRYPTION_KEY env var not configured on the edge function');
      }

      const supabase = createClient(supabaseUrl, serviceKey);
      const { data: keyRow } = await supabase
        .from('api_keys')
        .select('key_encrypted, is_valid')
        .eq('organization_id', organizationId)
        .eq('provider', 'apify')
        .maybeSingle();

      if (!keyRow) {
        throw new Error('No Apify API key found for this organization — add one in Settings → API Keys (the SignalBase actor lives on Apify)');
      }
      if (!keyRow.is_valid) {
        throw new Error('Apify API key is marked invalid — re-enter it in Settings → API Keys to re-validate');
      }

      const apifyToken = await decryptApiKey(keyRow.key_encrypted as string, encryptionKey);

      const fetchLimit = Math.min(limit ?? 50, 100);
      const userFilters = (filters ?? {}) as Partial<SignalBaseConfig>;
      const userSuppliedDateWindow =
        userFilters.date_preset != null ||
        userFilters.dateFrom != null ||
        userFilters.dateTo != null;
      const params: SignalBaseConfig = {
        date_preset: 'last_14d',
        ...opts.defaultFilters,
        ...userFilters,
        page: 1,
        limit: fetchLimit,
      };
      // Only fall back to `sinceIso` as dateFrom if the user did not pick a
      // date window themselves. Otherwise the subscription's last_refreshed_at
      // clobbers their explicit `last_30d` choice and the actor returns
      // ~0 items (hiring/funding deltas within a single day are sparse).
      if (sinceIso && !userSuppliedDateWindow) {
        params.dateFrom = sinceIso.slice(0, 10);
        delete params.date_preset;
      }

      let records: SignalBaseSignal[];
      try {
        records = await fetchSignalBase(apifyToken, opts.signalType, params, signal);
      } catch (err) {
        console.error(`[${moduleKey}] fetch failed`, err);
        return;
      }

      console.log(`[${moduleKey}] received ${records.length} records`);

      let yielded = 0;
      for (const rec of records) {
        if (signal?.aborted) return;
        if (yielded >= fetchLimit) return;
        // Use the shared helper so sync + async paths produce the same
        // record shape. mapSignalBaseRecord handles the company-not-found
        // skip + person hint for job-changes internally.
        const mapped = mapSignalBaseRecord(rec, { signalType: opts.signalType, moduleKey });
        if (!mapped) continue;
        yield mapped;
        yielded++;
      }
    },

    // Async kickoff: launches the actor on Apify and returns immediately
    // with the run handle. The apify-poller picks up the dataset once the
    // run reaches SUCCEEDED.
    async kickoff({ organizationId, filters, sinceIso, limit }) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
      if (!encryptionKey) {
        throw new Error('ENCRYPTION_KEY env var not configured on the edge function');
      }
      const supabase = createClient(supabaseUrl, serviceKey);
      const { data: keyRow } = await supabase
        .from('api_keys')
        .select('key_encrypted, is_valid')
        .eq('organization_id', organizationId)
        .eq('provider', 'apify')
        .maybeSingle();
      if (!keyRow) {
        throw new Error('No Apify API key found for this organization — add one in Settings → API Keys');
      }
      if (!keyRow.is_valid) {
        throw new Error('Apify API key is marked invalid — re-enter it in Settings → API Keys to re-validate');
      }
      const apifyToken = await decryptApiKey(keyRow.key_encrypted as string, encryptionKey);

      // SignalBase actor returns up to 100 results per call. To pull more
      // (the typical user wants all funded SaaS this week, not the first 100
      // alphabetically) we kick off one Apify run per page and let the
      // poller fan-in the datasets. Each run is independent — failures don't
      // block the others.
      const PAGE_SIZE = 100;
      const HARD_MAX = 1000;  // 10 pages — enough headroom for any realistic signal volume
      const requestedLimit = Math.min(limit ?? 100, HARD_MAX);
      const pageCount = Math.max(1, Math.ceil(requestedLimit / PAGE_SIZE));

      const userFilters = (filters ?? {}) as Partial<SignalBaseConfig>;
      const userSuppliedDateWindow =
        userFilters.date_preset != null ||
        userFilters.dateFrom != null ||
        userFilters.dateTo != null;
      const baseParams: SignalBaseConfig = {
        date_preset: 'last_14d',
        ...opts.defaultFilters,
        ...userFilters,
        limit: PAGE_SIZE,
      };
      // Only fall back to `sinceIso` as dateFrom if the user did not pick a
      // date window themselves — see sync path above for the rationale.
      if (sinceIso && !userSuppliedDateWindow) {
        baseParams.dateFrom = sinceIso.slice(0, 10);
        delete baseParams.date_preset;
      }

      const handles: AsyncRunHandle[] = [];
      for (let page = 1; page <= pageCount; page++) {
        try {
          const handle = await kickoffActorRun(apifyToken, opts.signalType, {
            ...baseParams,
            page,
          });
          console.log(`[${moduleKey}] kicked off page=${page}/${pageCount} run=${handle.run_id} dataset=${handle.dataset_id}`);
          handles.push({
            run_id: handle.run_id,
            dataset_id: handle.dataset_id,
            module_key: moduleKey,
            signal_type: opts.signalType,
            source: moduleKey,
          });
        } catch (err) {
          console.error(`[${moduleKey}] kickoff page=${page} failed`, err);
          // Continue with other pages — partial results are better than none.
        }
      }
      return handles;
    },

    mapRecord(raw, ctx) {
      return mapSignalBaseRecord(raw as SignalBaseSignal, {
        signalType: ctx.signalType as SignalType,
        moduleKey: ctx.moduleKey,
      });
    },
  };
}

export const justFundedSaasModule = buildSignalBaseModule({
  packKey: 'just_funded_saas',
  signalType: 'funding',
  tier: 'signal',
  label: 'SignalBase Funding Rounds',
  defaultFilters: { date_preset: 'last_14d' },
});

export const aggressiveHiringModule = buildSignalBaseModule({
  packKey: 'aggressive_hiring',
  signalType: 'hiring',
  tier: 'signal',
  label: 'SignalBase Hiring Signals',
  defaultFilters: { date_preset: 'last_30d' },
});

export const newLeadershipModule = buildSignalBaseModule({
  packKey: 'new_leadership',
  signalType: 'job-changes',
  tier: 'signal',
  label: 'SignalBase Executive Changes',
  defaultFilters: { date_preset: 'last_30d' },
});

export const acquisitionsModule = buildSignalBaseModule({
  packKey: 'recent_acquisitions',
  signalType: 'acquisitions',
  tier: 'signal',
  label: 'SignalBase Acquisitions',
  defaultFilters: { date_preset: 'last_30d' },
});
