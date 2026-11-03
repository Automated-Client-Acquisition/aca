/**
 * Shared types + helpers for the public B2B signals surface
 * (the /signals feed and the /signals/c/:slug company pages).
 */

import { supabase } from "@/integrations/supabase/client";

export type SignalType =
  | "funding"
  | "acquisition"
  | "hiring"
  | "hiring_demand"
  | "job_change"
  | "executive_hire"
  | "customer_win"
  | "award"
  | "growth";

export interface SignalPerson {
  name: string;
  title?: string;
  linkedin_url?: string;
  /** The exporter emits a boolean instead of the URL on the public feed. */
  has_linkedin?: boolean;
  /** Cached/proxied headshot (shown blurred on the public page). Absent → monogram. */
  photo_url?: string;
  /** The exporter's field name for the proxied headshot (alias of photo_url). */
  avatar_url?: string;
}

/** Whichever headshot field the feed carries (the exporter emits `avatar_url`). */
export function personPhoto(person: SignalPerson): string | undefined {
  return person.photo_url || person.avatar_url;
}

/** True when we have a LinkedIn profile for this person (URL or feed boolean). */
export function personHasLinkedin(person: SignalPerson): boolean {
  return !!(person.linkedin_url || person.has_linkedin);
}

/** Masked email teaser ("m••••@••••••") — implies a real verified address behind the gate. */
export function maskedEmail(name: string): string {
  const first = (name || "").trim().split(/\s+/)[0] || "x";
  const initial = (first[0] || "x").toLowerCase();
  return `${initial}••••@••••••`;
}

/** Teaser form of a name for the public page: first name + last initial ("Amit K."). */
export function redactName(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Someone";
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last[0].toUpperCase()}.`;
}

export interface PublicSignal {
  id: string;
  company_id?: string;
  type: SignalType;
  type_label: string;
  company: string;
  title: string;
  summary: string;
  amount: string;
  amount_usd: number;
  date: string;
  date_precision: "source" | "collected";
  source: string;
  source_key: string;
  source_url: string;
  confidence: number;
  quality_score: number;
  verified: boolean;
  person: string;
  location: string;
  /** Company HQ as an ISO-3166 alpha-2 code (e.g. "US", "GB"); "" / absent = unknown. */
  country?: string;
  why_it_matters: string;
  collected_at: string;
  // Aggregation (added by the exporter for the company-grouped feed)
  signal_count?: number;
  mention_count?: number;
  sources?: string[];
  event_types?: SignalType[];
  timeline?: PublicSignal[];
  // Enrichment (emitted by the exporter; may be absent until next export)
  domain?: string;
  company_linkedin_url?: string;
  logo_url?: string;
  people?: SignalPerson[];
}

export interface SignalsMeta {
  generated_at: string;
  source_file: string;
  total_source_rows: number;
  public_count: number;
  event_count?: number;
  companies_count?: number;
  multi_signal_companies?: number;
  verified_count: number;
  date_range: { start: string | null; end: string | null };
  type_counts: Record<string, number>;
  top_sources: Record<string, number>;
  schema_version: string;
}

export interface SignalsPayload {
  meta: SignalsMeta;
  signals: PublicSignal[];
}

export const SIGNALS_FEED_URL = "/signals/signals.json";
export const SIGNALS_SKOOL_URL = "https://www.skool.com/aca-xtreme";

export const TYPE_COPY: Record<string, string> = {
  all: "All signals",
  funding: "Funding",
  hiring: "GTM hiring",
  hiring_demand: "Hiring demand",
  acquisition: "Acquisitions",
  job_change: "Job changes",
  executive_hire: "Executive hires",
  growth: "Growth",
};

export const TYPE_CLASS: Record<string, string> = {
  funding: "sig-chip--funding",
  acquisition: "sig-chip--acquisition",
  hiring: "sig-chip--hiring",
  hiring_demand: "sig-chip--hiring",
  job_change: "sig-chip--job",
  executive_hire: "sig-chip--job",
  growth: "sig-chip--growth",
};

export function emptyMeta(): SignalsMeta {
  return {
    generated_at: new Date().toISOString(),
    source_file: "",
    total_source_rows: 0,
    public_count: 0,
    verified_count: 0,
    date_range: { start: null, end: null },
    type_counts: {},
    top_sources: {},
    schema_version: "fallback",
  };
}

/** Normalise the feed response (array OR {meta,signals}) into a payload. */
export function toPayload(data: unknown): SignalsPayload {
  if (Array.isArray(data)) {
    return { meta: { ...emptyMeta(), public_count: data.length }, signals: data as PublicSignal[] };
  }
  const payload = data as SignalsPayload;
  if (payload && Array.isArray(payload.signals)) return payload;
  return { meta: emptyMeta(), signals: [] };
}

export async function fetchSignals(signal?: AbortSignal): Promise<SignalsPayload> {
  const res = await fetch(SIGNALS_FEED_URL, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`Signals feed returned ${res.status}`);
  return toPayload(await res.json());
}

// ---- Database-driven feed (server-side pagination) --------------------------

export interface SignalsTodayStats {
  date: string | null;
  companies: number;
  signals: number;
  funded: number;
  hiring: number;
  verified: number;
}

export interface SignalsFeedPage {
  signals: PublicSignal[];
  total: number;
  limit: number;
  offset: number;
}

export interface SignalsFeedQuery {
  limit?: number;
  offset?: number;
  search?: string;
  type?: SignalType | "all";
  window?: "day" | "week" | "month" | "all";
  sort?: "latest" | "company" | "signals";
}

/** Fetch one page of the company-grouped feed from the database RPC. */
export async function fetchSignalsFeed(query: SignalsFeedQuery = {}): Promise<SignalsFeedPage> {
  const { data, error } = await supabase.rpc("get_public_signals_feed", {
    p_limit: query.limit ?? 50,
    p_offset: query.offset ?? 0,
    p_search: query.search?.trim() || null,
    p_type: query.type && query.type !== "all" ? query.type : null,
    p_window: query.window ?? "all",
    p_sort: query.sort ?? "latest",
  });
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as { signals?: PublicSignal[]; total_count?: number; limit?: number; offset?: number };
  return {
    signals: payload.signals ?? [],
    total: payload.total_count ?? 0,
    limit: payload.limit ?? (query.limit ?? 50),
    offset: payload.offset ?? (query.offset ?? 0),
  };
}

/**
 * Assemble the full company-grouped payload from the database, paging through the
 * feed RPC. Returns the same `{ meta, signals }` shape the static feed produced,
 * so existing consumers (client-side pagination, stats, export) keep working —
 * now DB-driven and controllable via the `published` flag.
 */
/**
 * Assemble the full feed by paging through the RPC. With 4k+ published signals
 * that's ~24 sequential round-trips (~5s), so we accept an optional
 * `onFirstPage` callback. The public feed is sorted newest-first, so the first
 * page already carries today's signals and can make the initial render useful
 * while the long tail loads. Later pages stay private until the complete
 * snapshot is ready; publishing each growing partial makes an existing table
 * look as though it is emptying and refilling during background refreshes.
 */
export async function fetchSignalsPayload(
  onFirstPage?: (payload: SignalsPayload) => void,
): Promise<SignalsPayload> {
  const [{ meta }, first] = await Promise.all([
    fetchSignalsMeta(),
    fetchSignalsFeed({ limit: 200, offset: 0, sort: "latest" }),
  ]);
  const signals = [...first.signals];
  // Paint immediately with the first page — don't block first render on the
  // remaining ~23 sequential pages.
  onFirstPage?.({ meta, signals: [...signals] });
  let offset = signals.length;
  while (signals.length < first.total && first.signals.length === 200) {
    const page = await fetchSignalsFeed({ limit: 200, offset, sort: "latest" });
    if (!page.signals.length) break;
    signals.push(...page.signals);
    offset += page.signals.length;
    if (page.signals.length < 200) break;
  }
  return { meta, signals };
}

/**
 * Resolve a single company for the /signals/c/:slug detail page from the
 * database — the same live source the list feed reads. The slug carries the
 * company hash-id as its trailing segment (see `companyIdFromSlug`); we pass it
 * to the RPC, which returns the company in feed-row shape (timeline + people)
 * or null when nothing matches. Returns null on any error so the caller can
 * fall back (e.g. to the static feed) rather than hard-fail.
 */
export async function fetchSignalCompany(companyId: string): Promise<PublicSignal | null> {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc("get_public_signal_company", {
    p_company_id: companyId,
  });
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as { company?: PublicSignal | null };
  return payload.company ?? null;
}

/** Fetch global aggregates (hero metrics, type/source counts, today snapshot). */
export async function fetchSignalsMeta(): Promise<{ meta: SignalsMeta; today: SignalsTodayStats }> {
  const { data, error } = await supabase.rpc("get_public_signals_meta");
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as { meta?: Partial<SignalsMeta>; today?: Partial<SignalsTodayStats> };
  return {
    meta: { ...emptyMeta(), ...(payload.meta ?? {}) } as SignalsMeta,
    today: {
      date: payload.today?.date ?? null,
      companies: payload.today?.companies ?? 0,
      signals: payload.today?.signals ?? 0,
      funded: payload.today?.funded ?? 0,
      hiring: payload.today?.hiring ?? 0,
      verified: payload.today?.verified ?? 0,
    },
  };
}

// ---- Company URL helpers ----------------------------------------------------

function slugifyName(company: string): string {
  return company
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "company";
}

/** Readable + unique: `acme-corp-1a2b3c4d`. The trailing 8 hex resolves it. */
export function companySlug(company: string, companyId?: string): string {
  const idPart = (companyId || "").slice(0, 8);
  const name = slugifyName(company);
  return idPart ? `${name}-${idPart}` : name;
}

export function companyHref(signal: Pick<PublicSignal, "company" | "company_id">): string {
  return `/signals/c/${companySlug(signal.company, signal.company_id)}`;
}

/** Pull the trailing id segment back out of a slug (or "" if none). */
export function companyIdFromSlug(slug: string): string {
  const m = slug.match(/-([0-9a-f]{6,8})$/i);
  return m ? m[1] : "";
}

/** Resolve a company in the feed from a slug, by id-suffix first then by name. */
export function findCompanyBySlug(signals: PublicSignal[], slug: string): PublicSignal | undefined {
  const id = companyIdFromSlug(slug);
  if (id) {
    const byId = signals.find((s) => (s.company_id || "").startsWith(id));
    if (byId) return byId;
  }
  const nameSlug = slug.replace(/-[0-9a-f]{6,8}$/i, "");
  return signals.find((s) => slugifyName(s.company) === nameSlug);
}

// ---- Avatar helpers ---------------------------------------------------------

/** Best-effort company logo from a domain; null when we have nothing to go on. */
export function logoUrlFor(signal: Pick<PublicSignal, "logo_url" | "domain">): string | null {
  if (signal.logo_url) return signal.logo_url;
  if (signal.domain) return `https://logo.clearbit.com/${signal.domain}`;
  return null;
}

export function monogram(company: string): string {
  const words = company.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const MONOGRAM_COLORS = [
  "#d4361a", "#1f6f4d", "#2f5fb0", "#a8521e", "#6d4aa8",
  "#1f7a8c", "#9a2d52", "#3f7d20", "#b5781f", "#444",
];

/** Deterministic background for the monogram so a company keeps its colour. */
export function monogramColor(company: string): string {
  let hash = 0;
  for (let i = 0; i < company.length; i += 1) hash = (hash * 31 + company.charCodeAt(i)) >>> 0;
  return MONOGRAM_COLORS[hash % MONOGRAM_COLORS.length];
}

export function formatSignalDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

/** Relative "found N ago" anchored to the signal's event date — NOT collected_at.
 *  collected_at is the DB insert time, which the daily feed regeneration re-stamps
 *  to "now" on every export, so it always reads ~"found minutes ago" regardless of
 *  how old the event is (an event dated days ago would falsely show "found 2h ago").
 *  The event date is the only stable, honest anchor and is what the card displays.
 *  collectedAt is kept only as a last-resort fallback when no date exists. */
/** The instant a date-only `signal_date` is anchored to, for every "how long ago"
 *  label in the product. `signal_date` is a DATE with no time, so something has to
 *  invent a time of day — and if two surfaces invent different ones they disagree
 *  by that difference forever. They did: the public feed used noon, the Signal
 *  Library used `new Date("2026-08-07")` (UTC midnight), so the same signal read
 *  "Found 3h ago" publicly and "15 hours ago" in the dashboard, a constant 12h gap
 *  on every same-day signal. Noon is the right anchor for a date-only value: it
 *  caps the error at ±12h instead of letting it run to a full day.
 *  Returns null when the input is not a usable date. */
export function signalDateAnchor(date?: string): Date | null {
  if (!date) return null;
  const t = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function freshness(collectedAt?: string, date?: string): { label: string; fresh: boolean } {
  const t = signalDateAnchor(date)?.getTime() ?? Date.parse(collectedAt || "");
  if (!Number.isFinite(t)) return { label: "", fresh: false };
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  const fresh = mins < 24 * 60;
  let rel: string;
  if (mins < 60) rel = `${Math.max(1, mins)}m ago`;
  else if (mins < 24 * 60) rel = `${Math.floor(mins / 60)}h ago`;
  else {
    const d = Math.floor(mins / (24 * 60));
    rel = d === 1 ? "yesterday" : `${d}d ago`;
  }
  return { label: `Found ${rel}`, fresh };
}

export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

// ---- Country helpers --------------------------------------------------------
// The feed stores company HQ as an ISO-3166 alpha-2 code in `country`. We map it
// to a display name + flag here so the column stays a clean filter key and the UI
// owns presentation. Covers the countries the B2B signal feed actually surfaces;
// anything unmapped falls back to the raw code.

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia",
  IE: "Ireland", DE: "Germany", FR: "France", NL: "Netherlands", ES: "Spain",
  IT: "Italy", SE: "Sweden", CH: "Switzerland", NO: "Norway", DK: "Denmark",
  FI: "Finland", BE: "Belgium", AT: "Austria", PT: "Portugal", PL: "Poland",
  IL: "Israel", IN: "India", SG: "Singapore", JP: "Japan", KR: "South Korea",
  CN: "China", HK: "Hong Kong", AE: "United Arab Emirates", SA: "Saudi Arabia",
  BR: "Brazil", MX: "Mexico", AR: "Argentina", ZA: "South Africa", NZ: "New Zealand",
  EE: "Estonia", LT: "Lithuania", LV: "Latvia", CZ: "Czechia", RO: "Romania",
  GR: "Greece", TR: "Turkey", NG: "Nigeria", KE: "Kenya", EG: "Egypt",
  BG: "Bulgaria", HU: "Hungary", LU: "Luxembourg", UA: "Ukraine", RU: "Russia",
  JO: "Jordan", KW: "Kuwait", PK: "Pakistan", PH: "Philippines", MO: "Macau",
  MA: "Morocco", GH: "Ghana", SN: "Senegal", BF: "Burkina Faso", GQ: "Equatorial Guinea",
  EU: "European Union",
};

/** Sorted {code, name} pairs for country pickers, from the same map the feed
 *  renders with — so a picked country always matches what's displayed. */
export const COUNTRY_OPTIONS: Array<{ code: string; name: string }> = Object.entries(COUNTRY_NAMES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Human-readable country name from an ISO2 code; falls back to the raw code. */
export function countryName(code?: string | null): string {
  const c = (code || "").trim().toUpperCase();
  if (!c) return "Unknown";
  return COUNTRY_NAMES[c] || c;
}

/** Regional-indicator flag emoji from an ISO2 code ("" when not a valid pair). */
export function countryFlag(code?: string | null): string {
  const c = (code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** True when a string looks like a bare ISO2 code (so we can name it for display). */
function isIso2(value?: string | null): boolean {
  return /^[A-Z]{2}$/.test((value || "").trim().toUpperCase());
}

/** The location/country fallback the feed RPC emits can be a bare ISO2 code
 *  (COALESCE(location, country)); render it as a readable country name. */
export function displayLocation(value?: string | null): string {
  const v = (value || "").trim();
  if (!v) return "";
  return isIso2(v) ? countryName(v) : v;
}

/** Collect distinct people for a company from its row + timeline (fallback when
 *  the exporter hasn't emitted a structured `people[]` yet). */
export function peopleForCompany(signal: PublicSignal): SignalPerson[] {
  if (signal.people?.length) return signal.people;
  const seen = new Set<string>();
  const out: SignalPerson[] = [];
  const push = (name?: string) => {
    const n = (name || "").trim();
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    out.push({ name: n });
  };
  push(signal.person);
  signal.timeline?.forEach((e) => push(e.person));
  return out;
}
