/**
 * Edge Function: enrich-signal-people
 * ----------------------------------------------------------------------------
 * Populates the "Decision-makers" teaser on the public /signals page.
 *
 * For each public company it:
 *   1. Searches people through MoltSets by the company's exact domain.
 *   2. Keeps only senior decision-makers with personal LinkedIn URLs.
 *   3. Re-hosts each headshot in the public `signal-people-avatars` bucket so
 *      the URL is stable (LinkedIn photo URLs expire and block hotlinking).
 *   4. Upserts the people into `public_signal_people`, keyed by company_key
 *      (lowercased company name) which the read RPC joins on.
 *
 * Companies come from `public_signals` (published rows), not from a static
 * signals.json over HTTP — see loadFeedCompanies.
 *
 * The public page shows the photo BLURRED + first-name + last-initial only.
 * A row in `public_signal_people_takedowns` (scope 'person' or 'company')
 * excludes someone from the public set.
 *
 * This intentionally has no name-only fallback: company names collide and a
 * public page must not associate a person with the wrong company.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';
import { isPlausibleHumanName } from '../_shared/list-building/name-validator.ts';
import { HOUSE_ORG_ID } from "../_shared/site-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-enrich-secret',
};

const AVATAR_BUCKET = 'signal-people-avatars';
const PUBLIC_SIGNALS_ORG_ID = HOUSE_ORG_ID;
// A buying signal is an account-level event. Surface a useful buying committee,
// not a single arbitrary contact, so public signal lists can reach decision
// makers without requiring one signal per person.
const MAX_PEOPLE_PER_COMPANY = 5;
const MOLTSETS_API_BASE = 'https://api.moltsets.com/api/v1/tools';
// Headcount and revenue move slowly; re-buying them every sweep would spend a
// token per company per run for a number that rarely changes.
const FIRMOGRAPHIC_TTL_DAYS = 30;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Seniority ranking — higher is more senior; 0 means "not a decision-maker".
// ---------------------------------------------------------------------------
function seniorityRank(title?: string | null): number {
  const t = (title || '').toLowerCase();
  if (!t) return 0;
  if (/\b(founder|co-?founder|owner|ceo|chief executive|president|managing director|managing partner)\b/.test(t)) return 100;
  if (/\b(c[tfdmiore]o|chief\s+\w+\s+officer|chief\b)\b/.test(t)) return 90;
  if (/\b(partner|general partner|gp)\b/.test(t)) return 80;
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return 70;
  if (/\b(head of|head,|director|director of)\b/.test(t)) return 60;
  return 0;
}

interface CompanyInput {
  company: string;
  company_linkedin_url?: string | null;
  domain?: string | null;
}

interface Person {
  full_name: string;
  title: string | null;
  linkedin_url: string;
  photo_url: string | null; // raw LinkedIn url before re-hosting
  email: string | null;
  email_status: string | null;
  rank: number;
}

interface MoltsetsEmailLookup {
  email: string | null;
  status: string | null;
}

interface CompanyFirmographics {
  employee_count: number | null;
  employee_range: string | null;
  revenue_range: string | null;
  industry: string | null;
  // Shown as columns on /signals/dashboard. Same response, no extra token.
  linkedin_industries: string[] | null;
  naics_titles: string[] | null;
  country: string | null;
  state: string | null;
  city: string | null;
}

function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function normalizePerson(profile: Record<string, unknown>): Person | null {
  const firstName = (profile.first_name || profile.firstName) as string | undefined;
  const lastName = (profile.last_name || profile.lastName) as string | undefined;
  const fullName = (
    profile.name || profile.display_name || profile.full_name ||
    (firstName && lastName ? `${firstName} ${lastName}` : firstName)
  ) as string | undefined;

  const headline = (profile.headline || profile.title || profile.occupation || profile.job_title) as string | undefined;
  const title = (
    profile.title || profile.job_title || profile.jobTitle || profile.occupation ||
    (headline && headline.length <= 120 ? headline : null)
  ) as string | null | undefined;

  const photo = (
    profile.avatar_url || profile.profile_picture_url || profile.picture_url ||
    profile.image_url || profile.picture
  ) as string | undefined;

  const publicId = profile.public_identifier as string | undefined;
  const email = (profile.email || profile.work_email || profile.business_email) as string | undefined;
  const emailStatus = (profile.email_status || profile.emailStatus || profile.email_verification_status) as string | undefined;
  const linkedinUrl = (
    profile.public_profile_url || profile.profile_url || profile.linkedin_url ||
    (publicId ? `https://www.linkedin.com/in/${publicId}` : null)
  ) as string | undefined;

  const nameParts = (fullName || '').trim().split(/\s+/);
  if (!fullName || !linkedinUrl || !linkedinUrl.includes('linkedin.com/in/') ||
    !isPlausibleHumanName(firstName ?? nameParts[0], lastName ?? (nameParts.slice(1).join(' ') || null))) {
    return null;
  }
  return {
    full_name: fullName,
    title: (title as string) || null,
    linkedin_url: linkedinUrl,
    photo_url: photo || null,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.trim().toLowerCase() : null,
    email_status: emailStatus || null,
    rank: seniorityRank((title as string) || headline),
  };
}

function peopleFromMoltsetsResponse(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  if (!body || typeof body !== 'object') return [];
  const root = body as Record<string, unknown>;
  for (const value of [root.results, root.people, root.data]) {
    if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>;
      for (const list of [nested.people, nested.data, nested.results]) {
        if (Array.isArray(list)) return list as Array<Record<string, unknown>>;
      }
    }
  }
  return [];
}

function moltsetsSearchRequestsPerMinute(plan: unknown): number {
  switch (String(plan ?? '').toLowerCase()) {
    case 'tier_27': return 30;
    case 'tier_997': return 250;
    // Tier 97 is configured for 1,000 requests/minute. Keep this aligned
    // with the shared MoltSets plan contract rather than the old pilot cap.
    case 'tier_97': return 1_000;
    case 'unlimited': return 20;
    default: return 1;
  }
}

async function getMoltsetsToken(
  supabase: SupabaseClient,
  encryptionKey: string,
): Promise<{ token: string; searchRequestsPerMinute: number }> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('key_encrypted, metadata')
    .eq('organization_id', PUBLIC_SIGNALS_ORG_ID)
    .eq('provider', 'moltsets')
    .eq('is_valid', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`MoltSets key lookup failed: ${error.message}`);
  if (!data) throw new Error('No valid MoltSets API key available for public signal enrichment');
  const key = data as { key_encrypted: string; metadata?: { plan?: string } | null };
  return {
    token: await decryptApiKey(key.key_encrypted, encryptionKey),
    searchRequestsPerMinute: moltsetsSearchRequestsPerMinute(key.metadata?.plan),
  };
}

async function reserveMoltsetsSearch(
  supabase: SupabaseClient,
  requestsPerMinute: number,
): Promise<{ granted: boolean; waitMs: number }> {
  const { data, error } = await supabase.rpc('reserve_enrichment_provider_request', {
    p_organization_id: PUBLIC_SIGNALS_ORG_ID,
    p_provider: 'moltsets_public_people_search',
    p_requests_per_minute: requestsPerMinute,
    p_daily_cap: null,
    p_max_wait_ms: 60_000,
  });
  if (error) throw new Error(`MoltSets search reservation failed: ${error.message}`);
  const reservation = Array.isArray(data) ? data[0] : data;
  return {
    granted: reservation?.reservation_status === 'granted',
    waitMs: Math.max(0, Number(reservation?.wait_ms) || 0),
  };
}

async function searchPeople(token: string, company: CompanyInput): Promise<Person[]> {
  const domain = normalizeDomain(company.domain);
  if (!domain) return [];
  const response = await fetch(`${MOLTSETS_API_BASE}/search_people`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_domain: domain, limit: MAX_PEOPLE_PER_COMPANY }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`MoltSets people search ${response.status}`);
  return peopleFromMoltsetsResponse(body)
    .filter((raw) => {
      const resultDomain = normalizeDomain(String(raw.company_domain || raw.companyDomain || ''));
      return !resultDomain || resultDomain === domain;
    })
    .map(normalizePerson)
    .filter((person): person is Person => !!person && person.rank > 0);
}

/**
 * Company firmographics for the same domain we just searched people at.
 *
 * This is the data behind the auto-add rule's "company size" and "revenue"
 * gates. MoltSets returns an EXACT employee_count alongside the coarse
 * employee_range, and the exact number is the whole point: the provider's
 * smallest band is "1-10", which cannot tell a solopreneur from a six-person
 * team — the single cut those rules most need to make.
 *
 * One extra token per company, on a lane we already call per company.
 */
async function searchCompanyFirmographics(
  token: string,
  domain: string,
): Promise<CompanyFirmographics | null> {
  const response = await fetch(`${MOLTSETS_API_BASE}/search_companies`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, limit: 1 }),
    signal: AbortSignal.timeout(20_000),
  });
  // A 404 is an honest "not in the index", not a failure to retry.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`MoltSets company search ${response.status}`);

  // The REST endpoint nests one level deeper than the MCP wrapper does:
  // { results: { results: [ … ], total } }. Accept both shapes so a provider
  // response change doesn't silently turn every company into "not_found".
  const body = await response.json().catch(() => null) as { results?: unknown } | null;
  const outer = body?.results;
  const list = Array.isArray(outer)
    ? outer
    : (outer && typeof outer === 'object' && Array.isArray((outer as { results?: unknown }).results)
        ? (outer as { results: unknown[] }).results
        : []);
  const first = (list[0] ?? null) as Record<string, unknown> | null;
  if (!first) return null;

  // employee_count arrives as a string ("2323") on this endpoint.
  const rawCount = first.employee_count ?? first.employeeCount;
  const parsedCount = typeof rawCount === 'number'
    ? rawCount
    : Number.parseInt(String(rawCount ?? ''), 10);

  return {
    employee_count: Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : null,
    employee_range: cleanFirmographic(first.employee_range ?? first.employeeRange),
    revenue_range: cleanFirmographic(first.revenue_range ?? first.revenueRange),
    industry: cleanFirmographic(first.industry),
    linkedin_industries: cleanFirmographicList(first.linkedin_industry ?? first.linkedin_industries),
    naics_titles: cleanFirmographicList(first.naics_titles ?? first.naics_title),
    country: cleanFirmographic(first.country),
    state: cleanFirmographic(first.state),
    city: cleanFirmographic(first.city),
  };
}

/** Drops the provider's placeholder values so "Unknown" never reads as a band. */
function cleanFirmographic(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return ['unknown', 'n/a', 'none'].includes(text.toLowerCase()) ? null : text;
}

/**
 * The same cleaning for the list-shaped fields. MoltSets sends these as an
 * array, but a single string shows up often enough that treating one as a
 * one-element list is worth more than the strictness.
 */
function cleanFirmographicList(value: unknown): string[] | null {
  const raw = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  const cleaned = raw
    .map((entry) => cleanFirmographic(entry))
    .filter((entry): entry is string => !!entry);
  return cleaned.length ? cleaned : null;
}

/** Companies whose firmographics are still fresh — never re-bought. */
async function loadFreshFirmographicKeys(supabase: SupabaseClient): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - FIRMOGRAPHIC_TTL_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('public_signal_companies')
    .select('company_key')
    .gte('enriched_at', cutoff);
  if (error) throw new Error(`Could not load company firmographics: ${error.message}`);
  return new Set((data ?? []).map((row) => String(row.company_key).toLowerCase()));
}

/**
 * Resolve + store one company's firmographics. Returns a summary fragment for
 * the response. Never throws into the caller's loop: a firmographic miss must
 * not cost the people enrichment that shares the iteration.
 */
async function enrichCompanyFirmographics(
  supabase: SupabaseClient,
  token: string,
  companyKey: string,
  domain: string,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  try {
    const firmographics = await searchCompanyFirmographics(token, domain);
    if (!firmographics) return { firmographics: 'not_found' };
    if (dryRun) return { firmographics };

    const { error } = await supabase.from('public_signal_companies').upsert({
      company_key: companyKey,
      domain,
      employee_count: firmographics.employee_count,
      employee_range: firmographics.employee_range,
      revenue_range: firmographics.revenue_range,
      industry: firmographics.industry,
      linkedin_industries: firmographics.linkedin_industries,
      naics_titles: firmographics.naics_titles,
      country: firmographics.country,
      state: firmographics.state,
      city: firmographics.city,
      source: 'moltsets',
      enriched_at: new Date().toISOString(),
    }, { onConflict: 'company_key' });
    if (error) return { firmographics: `write_failed: ${error.message}` };

    return {
      firmographics: 'stored',
      employee_count: firmographics.employee_count,
      revenue_range: firmographics.revenue_range,
    };
  } catch (err) {
    return { firmographics: `error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * MoltSets person search deliberately does not promise an email field. Resolve
 * the selected, exact LinkedIn profile separately using MoltSets' dedicated
 * work-email endpoint. This is the only email provider used for public signals.
 */
async function findMoltsetsWorkEmail(token: string, linkedinUrl: string): Promise<MoltsetsEmailLookup> {
  const response = await fetch(`${MOLTSETS_API_BASE}/linkedin_to_best_email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkedin_url: linkedinUrl }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null) as {
    results?: { email?: string | null; last_validated_at?: string | null };
  } | null;

  // A MoltSets 404 is an honest no-email result, not an error to retry.
  if (response.status === 404) return { email: null, status: 'not_found' };
  if (!response.ok) throw new Error(`MoltSets email lookup ${response.status}`);

  const email = body?.results?.email?.trim().toLowerCase() || null;
  return {
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    status: body?.results?.last_validated_at || (email ? 'resolved' : 'not_found'),
  };
}

// ---------------------------------------------------------------------------
// Photo re-hosting
// ---------------------------------------------------------------------------
async function sha1(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function cachePhoto(
  supabase: SupabaseClient,
  companyKey: string,
  linkedinUrl: string,
  rawPhotoUrl: string | null,
): Promise<string | null> {
  if (!rawPhotoUrl) return null;
  try {
    const res = await fetch(rawPhotoUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      console.warn(`[enrich-signal-people] photo download ${res.status} for ${linkedinUrl}`);
      return null;
    }
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const bytes = new Uint8Array(await res.arrayBuffer());
    const path = `${companyKey}/${await sha1(linkedinUrl)}.${ext}`;
    const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (error) {
      console.warn(`[enrich-signal-people] storage upload failed for ${linkedinUrl}:`, error.message);
      return null;
    }
    return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (err) {
    console.warn(`[enrich-signal-people] photo cache error for ${linkedinUrl}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Company source — `public_signals`, the same live table the /signals feed and
// the /signals/c/:slug pages read. This used to fetch a static signals.json
// over HTTP, which meant the enricher worked off whatever the last export
// wrote (and, if SIGNALS_FEED_URL was unset, off a hardcoded domain we do not
// own). Reading the DB removes both the staleness and the external dependency.
// ---------------------------------------------------------------------------
async function loadFeedCompanies(supabase: SupabaseClient): Promise<CompanyInput[]> {
  const { data, error } = await supabase
    .from('public_signals')
    .select('company_name, company_linkedin_url, domain, signal_date')
    .eq('published', true)
    .order('signal_date', { ascending: false })
    .limit(2_000);
  if (error) throw new Error(`Could not load published signals: ${error.message}`);

  // One entry per company, newest signal first, keeping the best identifiers
  // seen across that company's events (older rows often carry the LinkedIn URL
  // or domain that the newest one is missing).
  const byKey = new Map<string, CompanyInput>();
  for (const row of data ?? []) {
    const company = String(row.company_name || '').trim();
    if (!company) continue;
    const key = company.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.company_linkedin_url ||= (row.company_linkedin_url as string) || null;
      existing.domain ||= (row.domain as string) || null;
    } else {
      byKey.set(key, {
        company,
        company_linkedin_url: (row.company_linkedin_url as string) || null,
        domain: (row.domain as string) || null,
      });
    }
  }

  // Companies with no public people yet go first — a run is capped at `limit`,
  // so spending it on already-enriched companies would starve the rest.
  const { data: enriched, error: peopleErr } = await supabase
    .from('public_signal_people')
    .select('company_key');
  if (peopleErr) throw new Error(`Could not load existing people: ${peopleErr.message}`);
  const hasPeople = new Set((enriched ?? []).map((p) => String(p.company_key).toLowerCase()));

  const all = [...byKey.entries()];
  return [
    ...all.filter(([key]) => !hasPeople.has(key)),
    ...all.filter(([key]) => hasPeople.has(key)),
  ].map(([, c]) => c);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!supabaseUrl || !serviceKey || !encryptionKey) {
      return new Response(JSON.stringify({ error: 'Missing required environment variables' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Optional shared-secret gate (this is an internal/admin task).
    const requiredSecret = Deno.env.get('SIGNAL_ENRICH_SECRET');
    if (requiredSecret && req.headers.get('x-enrich-secret') !== requiredSecret) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(200, Math.max(1, Number(body.limit) > 0 ? Number(body.limit) : 15));
    const dryRun: boolean = !!body.dryRun;
    const emailOnly: boolean = body.emailOnly === true;
    // Firmographics-only pass: no person search, no email lookups. This is the
    // cheap lane for backfilling the auto-add rule's size/revenue gates across
    // companies whose people are already enriched.
    const companiesOnly: boolean = body.companiesOnly === true;

    // Email backfill never re-runs person search. A public lead is only useful
    // when the exact person originally selected for its exact-domain company is
    // enriched, not when a later search happens to return somebody else.
    if (emailOnly) {
      const { data: signals, error: signalsError } = await supabase
        .from('public_signals')
        .select('company_name')
        .eq('published', true);
      if (signalsError) throw new Error(`Could not load public signals: ${signalsError.message}`);
      const companyKeys = [...new Set((signals || []).map((s) => String(s.company_name || '').toLowerCase()).filter(Boolean))];
      if (!companyKeys.length) {
        return new Response(JSON.stringify({ ok: true, emailOnly: true, count: 0, attempted: 0, found: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: people, error: peopleError } = await supabase
        .from('public_signal_people')
        .select('company_key, linkedin_url')
        .in('company_key', companyKeys)
        .is('email', null)
        .not('linkedin_url', 'is', null)
        .limit(limit);
      if (peopleError) throw new Error(`Could not load public people: ${peopleError.message}`);

      const moltsets = await getMoltsetsToken(supabase, encryptionKey);
      let found = 0;
      const results: Array<Record<string, unknown>> = [];
      for (let start = 0; start < (people || []).length; start += 5) {
        const group = (people || []).slice(start, start + 5);
        const groupResults = await Promise.all(group.map(async (person) => {
          const emailLookup = await findMoltsetsWorkEmail(moltsets.token, String(person.linkedin_url));
          if (!dryRun) {
            const { error } = await supabase
              .from('public_signal_people')
              .update({ email: emailLookup.email, email_status: emailLookup.status, enriched_at: new Date().toISOString() })
              .eq('company_key', person.company_key)
              .eq('linkedin_url', person.linkedin_url);
            if (error) throw new Error(`Could not write public email: ${error.message}`);
          }
          return { company: person.company_key, found: !!emailLookup.email, status: emailLookup.status };
        }));
        results.push(...groupResults);
        found += groupResults.filter((result) => result.found).length;
      }
      return new Response(JSON.stringify({ ok: true, emailOnly: true, count: people?.length || 0, attempted: people?.length || 0, found, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Companies to enrich.
    let companies: CompanyInput[] = Array.isArray(body.companies) && body.companies.length
      ? body.companies.map((c: CompanyInput | string) =>
          typeof c === 'string' ? { company: c } : { company: c.company, company_linkedin_url: c.company_linkedin_url, domain: c.domain })
      : await loadFeedCompanies(supabase);
    companies = companies.filter((c) => c.company);

    // loadFeedCompanies orders by PEOPLE coverage, so a firmographics-only pass
    // would hand back the same already-enriched head of the list every call and
    // never walk the feed. Drop the fresh ones before the limit, not after.
    const freshFirmographics = await loadFreshFirmographicKeys(supabase);
    if (companiesOnly) {
      companies = companies.filter((c) => !freshFirmographics.has(c.company.toLowerCase()));
    }
    companies = companies.slice(0, limit);

    // 2. Takedowns (skip suppressed people/companies).
    const { data: takedowns } = await supabase
      .from('public_signal_people_takedowns')
      .select('scope, company_key, linkedin_url');
    const suppressedCompanies = new Set(
      (takedowns || []).filter((t) => t.scope === 'company' && t.company_key).map((t) => String(t.company_key).toLowerCase()),
    );
    const suppressedPeople = new Set(
      (takedowns || []).filter((t) => t.scope === 'person' && t.linkedin_url).map((t) => String(t.linkedin_url)),
    );

    // 3. MoltSets search lane. Do not fall back to a name-only lookup: a
    // public decision-maker card must have an exact company-domain match.
    const moltsets = await getMoltsetsToken(supabase, encryptionKey);

    const summary: Array<Record<string, unknown>> = [];

    if (companiesOnly) {
      let stored = 0;
      for (const company of companies) {
        const companyKey = company.company.toLowerCase();
        const domain = normalizeDomain(company.domain);
        if (!domain) {
          summary.push({ company: company.company, skipped: 'missing_company_domain' });
          continue;
        }
        if (freshFirmographics.has(companyKey)) {
          summary.push({ company: company.company, skipped: 'firmographics_fresh' });
          continue;
        }
        const reservation = await reserveMoltsetsSearch(supabase, moltsets.searchRequestsPerMinute);
        if (!reservation.granted) {
          summary.push({ company: company.company, skipped: 'moltsets_search_rate_wait' });
          break;
        }
        if (reservation.waitMs > 0) await sleep(reservation.waitMs);

        const result = await enrichCompanyFirmographics(
          supabase, moltsets.token, companyKey, domain, dryRun,
        );
        if (result.firmographics === 'stored') stored++;
        summary.push({ company: company.company, ...result });
      }
      return new Response(
        JSON.stringify({ ok: true, companiesOnly: true, dryRun, count: companies.length, stored, results: summary }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    for (const company of companies) {
      const companyKey = company.company.toLowerCase();
      if (suppressedCompanies.has(companyKey)) {
        summary.push({ company: company.company, skipped: 'company_takedown' });
        continue;
      }

      const domain = normalizeDomain(company.domain);
      if (!domain) {
        summary.push({ company: company.company, skipped: 'missing_company_domain' });
        continue;
      }
      const reservation = await reserveMoltsetsSearch(supabase, moltsets.searchRequestsPerMinute);
      if (!reservation.granted) {
        summary.push({ company: company.company, skipped: 'moltsets_search_rate_wait' });
        break;
      }
      if (reservation.waitMs > 0) await sleep(reservation.waitMs);

      try {
        const found = await searchPeople(moltsets.token, company);
        const decisionMakers = found
          .filter((p) => p.rank > 0 && !suppressedPeople.has(p.linkedin_url))
          .sort((a, b) => b.rank - a.rank)
          .slice(0, MAX_PEOPLE_PER_COMPANY);

        if (dryRun) {
          summary.push({ company: company.company, found: found.length, decision_makers: decisionMakers.length, people: decisionMakers });
        } else {
          let written = 0;
          for (const p of decisionMakers) {
            const emailLookup = p.email
              ? { email: p.email, status: p.email_status }
              : await findMoltsetsWorkEmail(moltsets.token, p.linkedin_url);
            const photoUrl = await cachePhoto(supabase, companyKey, p.linkedin_url, p.photo_url);
            const { error } = await supabase.from('public_signal_people').upsert({
              company_key: companyKey,
              company_linkedin_url: company.company_linkedin_url || null,
              domain: company.domain || null,
              full_name: p.full_name,
              title: p.title,
              linkedin_url: p.linkedin_url,
              photo_url: photoUrl,
              email: emailLookup.email,
              email_status: emailLookup.status,
              seniority_rank: p.rank,
              source: 'moltsets',
              enriched_at: new Date().toISOString(),
            }, { onConflict: 'company_key,linkedin_url' });
            if (error) console.warn(`[enrich-signal-people] upsert failed for ${p.linkedin_url}:`, error.message);
            else written++;
          }
          // Same company, same domain, one more token: the firmographics that
          // back the auto-add size/revenue gates. Skipped while still fresh.
          let firmographicResult: Record<string, unknown> = { firmographics: 'fresh' };
          if (!freshFirmographics.has(companyKey)) {
            const companyReservation = await reserveMoltsetsSearch(supabase, moltsets.searchRequestsPerMinute);
            if (!companyReservation.granted) {
              firmographicResult = { firmographics: 'rate_wait' };
            } else {
              if (companyReservation.waitMs > 0) await sleep(companyReservation.waitMs);
              firmographicResult = await enrichCompanyFirmographics(
                supabase, moltsets.token, companyKey, domain, dryRun,
              );
            }
          }
          summary.push({ company: company.company, found: found.length, written, ...firmographicResult });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[enrich-signal-people] ${company.company} failed:`, message);
        summary.push({ company: company.company, error: message });
      }
    }

    return new Response(JSON.stringify({ ok: true, dryRun, count: companies.length, results: summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[enrich-signal-people] fatal:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
