/**
 * List verifier — checks email addresses for deliverability before they're
 * enrolled in a sequence. Single biggest lever for keeping bounce rate < 2%.
 *
 * Architecture:
 *   1. Static heuristics first (free, instant) — disposable / role / bad MX
 *   2. Cache lookup in email_address_verifications (30-day TTL)
 *   3. External provider (Million Verifier by default, NeverBounce fallback)
 *
 * The provider is selected from organizations.settings.email_verifier:
 *   {
 *     provider: 'million_verifier',
 *     api_key_encrypted: '...',     // AES-256-GCM via _shared/encryption.ts
 *     allow_risky: false,            // skip 'risky' addresses by default
 *     enabled: true
 *   }
 *
 * If no provider key is configured we fall back to heuristics-only — catches
 * disposable + role + obvious malformed addresses but lets unknowns through
 * (which is the same behavior we had before this phase, so it's safe).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isDisposableEmail } from './disposable-domains.ts';
import { isRoleLocalPart } from './role-prefixes.ts';
import { decryptValue } from './encryption.ts';
import { decryptApiKey } from './apify-leads-utils.ts';
import { resolveMx } from './dns-utils.ts';
import {
  mapMailtesterNinjaResponse,
  type MailtesterNinjaResponse,
} from './mailtester-ninja.ts';

// Was ReturnType<typeof createClient>, which supplies no Database generic, so
// every .from(...) through this alias resolved to `never` — and because the
// alias is exported, callers passing a real client failed to assign to it too.
export type SupabaseServiceClient = SupabaseClient<any>;

export type VerificationStatus =
  | 'valid'
  | 'invalid'
  | 'risky'
  | 'catch_all'
  | 'disposable'
  | 'role'
  | 'unknown';

export type VerificationProvider =
  | 'million_verifier'
  | 'apify_million_verifier'
  | 'mailtester_ninja'
  | 'neverbounce'
  | 'zerobounce'
  | 'kickbox'
  | 'webbula'
  | 'smtp_probe'
  | 'heuristic'
  | 'manual';

export type MailtesterNinjaPlan = 'starter' | 'pro' | 'ultimate';

// Plan limits per Mailtester Ninja docs (https://mailtester.ninja/api/).
// rps is the documented per-10s rate divided by 10; we pace one request at a
// time. perDay is the daily cap that resets at 00:00 UTC.
export const MAILTESTER_PLAN_LIMITS: Record<MailtesterNinjaPlan, { rps: number; perDay: number }> = {
  starter: { rps: 1, perDay: 50_000 },     // 50k/day; per-second rate undocumented, conservative 1 RPS
  pro: { rps: 1.1, perDay: 100_000 },      // 11 / 10s = 1.1 RPS, 100k/day
  ultimate: { rps: 5.7, perDay: 500_000 }, // 57 / 10s = 5.7 RPS, 500k/day
};

export interface VerificationRecord {
  email: string;
  email_lower: string;
  domain: string;
  local_part: string;
  status: VerificationStatus;
  provider: VerificationProvider;
  smtp_response_code: number | null;
  is_disposable: boolean;
  is_role: boolean;
  is_catch_all: boolean;
  is_spamtrap: boolean;
  raw_response: unknown;
}

export interface OrgVerifierConfig {
  provider: VerificationProvider | null;
  api_key_encrypted: string | null;
  allow_risky: boolean;
  block_catchall: boolean;
  allow_role: boolean;
  enabled: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalize(email: string): { ok: boolean; lower: string; local: string; domain: string } {
  const trimmed = (email ?? '').trim();
  if (!EMAIL_RE.test(trimmed)) {
    return { ok: false, lower: trimmed.toLowerCase(), local: '', domain: '' };
  }
  const lower = trimmed.toLowerCase();
  const at = lower.lastIndexOf('@');
  return {
    ok: true,
    lower,
    local: lower.slice(0, at),
    domain: lower.slice(at + 1),
  };
}

/**
 * Read per-org verifier config. Returns sensible defaults so callers don't
 * have to defensive-check every time.
 */
export async function getOrgVerifierConfig(
  supabase: SupabaseServiceClient,
  organizationId: string,
): Promise<OrgVerifierConfig> {
  const defaults: OrgVerifierConfig = {
    provider: null,
    api_key_encrypted: null,
    allow_risky: false,
    block_catchall: true,
    allow_role: false,
    enabled: true,
  };
  try {
    const { data } = await supabase
      .from('organizations')
      .select('settings')
      .eq('id', organizationId)
      .maybeSingle();
    const settings = (data?.settings as Record<string, unknown> | null | undefined) ?? {};
    const cfg = (settings.email_verifier as Record<string, unknown> | null | undefined) ?? {};
    return {
      provider: (cfg.provider as VerificationProvider | undefined) ?? null,
      api_key_encrypted: (cfg.api_key_encrypted as string | undefined) ?? null,
      allow_risky: (cfg.allow_risky as boolean | undefined) ?? defaults.allow_risky,
      block_catchall: (cfg.block_catchall as boolean | undefined) ?? defaults.block_catchall,
      allow_role: (cfg.allow_role as boolean | undefined) ?? defaults.allow_role,
      enabled: (cfg.enabled as boolean | undefined) ?? defaults.enabled,
    };
  } catch {
    return defaults;
  }
}

/**
 * Resolve an inline-verifier API key from the shared `api_keys` store — the
 * same place the bulk Mailtester pipeline (mailtester-verify-worker) reads from.
 *
 * This is the fallback used when `organizations.settings.email_verifier` is not
 * configured. Without it, the inline verifyEmail node silently degrades to
 * heuristics-only (every deliverable-looking address → 'unknown') even though
 * the org has a working verifier key on file. Keys here are encrypted with
 * ENCRYPTION_KEY (decryptApiKey), NOT SMTP_ENCRYPTION_KEY (decryptValue).
 */
async function resolveVerifierFromApiKeys(
  supabase: SupabaseServiceClient,
  organizationId: string,
): Promise<{ provider: VerificationProvider; apiKey: string } | null> {
  const encKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encKey) return null;

  // Providers the single-email inline path knows how to call, in preference order.
  const supportedInline: VerificationProvider[] = ['mailtester_ninja', 'million_verifier', 'neverbounce'];

  type ApiKeyRow = { provider: string; key_encrypted: string | null; is_valid: boolean | null };
  let rows: ApiKeyRow[] | null = null;
  try {
    const { data } = await supabase
      .from('api_keys')
      .select('provider, key_encrypted, is_valid')
      .eq('organization_id', organizationId)
      .in('provider', supportedInline);
    // Was `data as typeof rows`, which resolves against the NARROWED type of
    // rows at this point — `null` — so every later use of rows was `never`.
    rows = (data ?? null) as ApiKeyRow[] | null;
  } catch {
    return null;
  }
  if (!rows || rows.length === 0) return null;

  for (const provider of supportedInline) {
    const row = rows.find((r) => r.provider === provider && r.key_encrypted && r.is_valid !== false);
    if (!row || !row.key_encrypted) continue;
    try {
      const apiKey = await decryptApiKey(row.key_encrypted, encKey);
      return { provider, apiKey };
    } catch (e) {
      console.warn(`[list-verifier] Failed to decrypt ${provider} key from api_keys: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Million Verifier provider
//
// API: POST https://api.millionverifier.com/api/v3/?api=KEY&email=...
// Response: { result: 'ok'|'catch_all'|'unknown'|'invalid'|'disposable'|'role',
//             subresult, quality, ... }
// Quotas are per-account; we send one request at a time and rely on cache.
// ────────────────────────────────────────────────────────────────────────────

interface MillionVerifierResponse {
  email?: string;
  quality?: string;
  result?: string;
  resultcode?: number;
  subresult?: string;
  free?: boolean;
  role?: boolean;
  didyoumean?: string;
  credits?: number;
  executiontime?: number;
  error?: string;
  livemode?: boolean;
}

function mapMillionVerifier(resp: MillionVerifierResponse): VerificationStatus {
  switch (resp.result) {
    case 'ok':
    case 'valid':
    case 'good':
      return 'valid';
    case 'invalid':
    case 'bad':
    case 'reject_email':
      return 'invalid';
    case 'catch_all':
    case 'accept_all':
      return 'catch_all';
    case 'disposable':
      return 'disposable';
    case 'role':
      return 'role';
    case 'unknown':
    case 'error':
    default:
      return 'unknown';
  }
}

async function checkMillionVerifier(
  apiKey: string,
  email: string,
  timeoutMs = 8000,
): Promise<{ status: VerificationStatus; raw: MillionVerifierResponse; smtpCode?: number }> {
  const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&timeout=10`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Million Verifier returned ${res.status}`);
  }
  const json = (await res.json()) as MillionVerifierResponse;
  if (json.error) throw new Error(`Million Verifier error: ${json.error}`);
  return { status: mapMillionVerifier(json), raw: json, smtpCode: json.resultcode };
}

// ────────────────────────────────────────────────────────────────────────────
// Apify Million Verifier — bulk path
//
// Actor: account56/email-verifier (https://apify.com/account56/email-verifier)
// Wrapper around Million Verifier; charges $0.001/email + $0.0001 actor start.
// Input: { emails: string[] }
// We POST to run-sync-get-dataset-items so the call blocks until the dataset
// is ready (no webhook needed). Apify caps sync runs at 5 minutes — keep
// batches small (≤200 emails) so each batch finishes well inside that.
// ────────────────────────────────────────────────────────────────────────────

const APIFY_VERIFIER_ACTOR = 'account56~email-verifier';

interface ApifyVerifierItem {
  email?: string;
  result?: string;       // 'ok' | 'invalid' | 'catch_all' | 'disposable' | 'unknown' | 'role' | …
  quality?: string;      // 'good' | 'risky' | 'bad'
  resultcode?: number;
  subresult?: string;
  free?: boolean;
  role?: boolean;
  disposable?: boolean;
  didyoumean?: string;
  error?: string;
}

function mapApifyVerifierItem(item: ApifyVerifierItem): VerificationStatus {
  // result is the canonical field; quality is an aggregate hint.
  if (item.result) {
    const m = mapMillionVerifier({ result: item.result });
    if (m !== 'unknown') return m;
  }
  switch (item.quality) {
    case 'good': return 'valid';
    case 'bad': return 'invalid';
    case 'risky': return 'risky';
    default: return 'unknown';
  }
}

async function runApifyVerifierBatch(
  apifyToken: string,
  emails: string[],
  timeoutMs = 4 * 60 * 1000,
): Promise<ApifyVerifierItem[]> {
  if (emails.length === 0) return [];
  const url = `https://api.apify.com/v2/acts/${APIFY_VERIFIER_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(apifyToken)}&format=json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ emails }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Apify verifier returned ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as ApifyVerifierItem[] | { items?: ApifyVerifierItem[] };
  // run-sync-get-dataset-items returns the array directly with format=json,
  // but defend against the wrapped-shape variant just in case.
  return Array.isArray(json) ? json : (json.items ?? []);
}

// ────────────────────────────────────────────────────────────────────────────
// Mailtester Ninja provider
//
// API: GET https://happy.mailtester.ninja/ninja?email=...&key=API_KEY
// Auth: query string only (no headers, no Bearer).
// Response: { email, user, domain, mx, code: 'ok'|'ko'|'mb', message: ... }
//   - code: 'ok' → valid mailbox accepted
//   - code: 'ko' → rejected at SMTP layer
//   - code: 'mb' → mailbox unverifiable (catch-all, timeout, SPAM block, etc.)
// No batch endpoint, no quota endpoint. Rate caps are plan-tier dependent —
// see MAILTESTER_PLAN_LIMITS above. Caller paces requests.
// ────────────────────────────────────────────────────────────────────────────

async function checkMailtesterNinja(
  apiKey: string,
  email: string,
  timeoutMs = 8000,
): Promise<{ status: VerificationStatus; raw: MailtesterNinjaResponse }> {
  const url = `https://happy.mailtester.ninja/ninja?email=${encodeURIComponent(email)}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Mailtester Ninja auth failed (${res.status}) — check the API key`);
  }
  if (!res.ok) {
    throw new Error(`Mailtester Ninja returned ${res.status}`);
  }
  const json = (await res.json()) as MailtesterNinjaResponse;
  return { status: mapMailtesterNinjaResponse(json), raw: json };
}

// ────────────────────────────────────────────────────────────────────────────
// NeverBounce / ZeroBounce — minimal stubs implementing the same contract.
// Add a concrete provider here if/when the user signs up; the provider
// abstraction means callers don't change.
// ────────────────────────────────────────────────────────────────────────────

async function checkNeverBounce(
  apiKey: string,
  email: string,
  timeoutMs = 8000,
): Promise<{ status: VerificationStatus; raw: unknown; smtpCode?: number }> {
  const url = `https://api.neverbounce.com/v4/single/check?key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`NeverBounce returned ${res.status}`);
  const json = await res.json() as { result?: string; flags?: string[]; status?: string };
  let mapped: VerificationStatus = 'unknown';
  switch (json.result) {
    case 'valid': mapped = 'valid'; break;
    case 'invalid': mapped = 'invalid'; break;
    case 'disposable': mapped = 'disposable'; break;
    case 'catchall': mapped = 'catch_all'; break;
    case 'unknown': mapped = 'unknown'; break;
  }
  return { status: mapped, raw: json };
}

// ────────────────────────────────────────────────────────────────────────────
// Heuristic-only verification (free, no API key required).
// Catches disposable + bad MX. Fallback when no provider configured.
// ────────────────────────────────────────────────────────────────────────────

async function checkHeuristic(
  email: string,
): Promise<{ status: VerificationStatus; raw: Record<string, unknown> }> {
  const norm = normalize(email);
  if (!norm.ok) return { status: 'invalid', raw: { reason: 'malformed' } };
  if (isDisposableEmail(email)) return { status: 'disposable', raw: { reason: 'disposable_domain' } };
  // MX lookup — no MX = undeliverable. Cheap.
  try {
    const mx = await resolveMx(norm.domain);
    if (!mx || mx.length === 0) {
      return { status: 'invalid', raw: { reason: 'no_mx' } };
    }
  } catch {
    // DoH failure shouldn't block; treat as unknown.
    return { status: 'unknown', raw: { reason: 'mx_lookup_failed' } };
  }
  return { status: 'unknown', raw: { reason: 'heuristic_only' } };
}

// ────────────────────────────────────────────────────────────────────────────
// Core verification — runs heuristics → cache → provider in that order
// ────────────────────────────────────────────────────────────────────────────

export interface VerifyOptions {
  /** Skip the cache lookup and force a fresh provider call. */
  forceRefresh?: boolean;
  /** Override the org's configured provider. Useful for tests. */
  providerOverride?: { provider: VerificationProvider; api_key: string };
}

export interface VerifyResult extends VerificationRecord {
  cached: boolean;
}

/**
 * Verify a single email address. Caches the result.
 *
 * Returns a VerifyResult with the canonical status. Callers decide whether
 * the status is acceptable for enrollment based on org config.
 */
export async function verifyEmailAddress(
  supabase: SupabaseServiceClient,
  organizationId: string,
  email: string,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const norm = normalize(email);

  // Static heuristic short-circuits — these never go to the provider.
  // Disposable domains will never be deliverable; cheap to block forever.
  if (!norm.ok) {
    return persist(supabase, organizationId, {
      email,
      email_lower: norm.lower,
      domain: norm.domain,
      local_part: norm.local,
      status: 'invalid',
      provider: 'heuristic',
      smtp_response_code: null,
      is_disposable: false,
      is_role: false,
      is_catch_all: false,
      is_spamtrap: false,
      raw_response: { reason: 'malformed' },
    });
  }
  if (isDisposableEmail(email)) {
    return persist(supabase, organizationId, {
      email,
      email_lower: norm.lower,
      domain: norm.domain,
      local_part: norm.local,
      status: 'disposable',
      provider: 'heuristic',
      smtp_response_code: null,
      is_disposable: true,
      is_role: false,
      is_catch_all: false,
      is_spamtrap: false,
      raw_response: { reason: 'disposable_domain' },
    });
  }
  // Role addresses (info@, office@...) are verified like any other mailbox:
  // a valid info@ goes out, an invalid one is blocked. Role is recorded as a
  // flag (is_role), never as the verdict.

  // Cache lookup
  if (!opts.forceRefresh) {
    const { data: cached } = await supabase
      .from('email_address_verifications')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('email_lower', norm.lower)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    // Rows from the old role short-circuit never reached a provider: re-verify.
    if (cached && !isStaleRoleVerdict(cached as unknown as VerificationRecord)) {
      return { ...(cached as unknown as VerificationRecord), cached: true };
    }
  }

  // Provider
  const config = opts.providerOverride
    ? { provider: opts.providerOverride.provider, api_key_encrypted: null, allow_risky: false, block_catchall: true, allow_role: false, enabled: true }
    : await getOrgVerifierConfig(supabase, organizationId);

  let providerStatus: VerificationStatus = 'unknown';
  let providerRaw: unknown = null;
  let smtpCode: number | undefined;
  let providerUsed: VerificationProvider = 'heuristic';

  try {
    // Resolve provider + key. Preference: explicit override → org settings →
    // shared api_keys store (same key the bulk Mailtester pipeline uses).
    let provider: VerificationProvider | null = opts.providerOverride?.provider ?? config.provider;
    let apiKey: string | null = opts.providerOverride?.api_key
      ?? (config.api_key_encrypted ? await decryptValue(config.api_key_encrypted) : null);

    if (config.enabled && !opts.providerOverride && (!apiKey || !provider)) {
      const fallback = await resolveVerifierFromApiKeys(supabase, organizationId);
      if (fallback) {
        provider = fallback.provider;
        apiKey = fallback.apiKey;
      }
    }

    if (config.enabled && apiKey && provider) {
      if (provider === 'million_verifier') {
        const r = await checkMillionVerifier(apiKey, email);
        providerStatus = r.status; providerRaw = r.raw; smtpCode = r.smtpCode;
        providerUsed = 'million_verifier';
      } else if (provider === 'neverbounce') {
        const r = await checkNeverBounce(apiKey, email);
        providerStatus = r.status; providerRaw = r.raw; smtpCode = r.smtpCode;
        providerUsed = 'neverbounce';
      } else if (provider === 'mailtester_ninja') {
        const r = await checkMailtesterNinja(apiKey, email);
        providerStatus = r.status; providerRaw = r.raw;
        providerUsed = 'mailtester_ninja';
      } else {
        const h = await checkHeuristic(email);
        providerStatus = h.status; providerRaw = h.raw; providerUsed = 'heuristic';
      }
    } else {
      const h = await checkHeuristic(email);
      providerStatus = h.status; providerRaw = h.raw; providerUsed = 'heuristic';
    }
  } catch (e) {
    console.warn(`[list-verifier] Provider call failed for ${email}: ${e instanceof Error ? e.message : 'unknown'}; falling back to heuristic.`);
    const h = await checkHeuristic(email);
    providerStatus = h.status; providerRaw = h.raw; providerUsed = 'heuristic';
  }

  return persist(supabase, organizationId, {
    email,
    email_lower: norm.lower,
    domain: norm.domain,
    local_part: norm.local,
    status: providerStatus,
    provider: providerUsed,
    smtp_response_code: smtpCode ?? null,
    is_disposable: providerStatus === 'disposable',
    is_role: providerStatus === 'role' || isRoleLocalPart(norm.local),
    is_catch_all: providerStatus === 'catch_all',
    is_spamtrap: false,
    raw_response: providerRaw,
  });
}

/**
 * True for a cached `role` verdict written by the heuristic short-circuit
 * (before role became a flag). Those never asked the provider whether the
 * mailbox exists, so callers must re-verify instead of trusting them.
 */
export function isStaleRoleVerdict(row: Pick<VerificationRecord, 'status' | 'provider'>): boolean {
  return row.status === 'role' && row.provider === 'heuristic';
}

async function persist(
  supabase: SupabaseServiceClient,
  organizationId: string,
  rec: VerificationRecord,
): Promise<VerifyResult> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('email_address_verifications')
    .upsert(
      {
        organization_id: organizationId,
        ...rec,
        verified_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: 'organization_id,email_lower' },
    );
  if (error) {
    console.warn(`[list-verifier] Persist failed for ${rec.email}: ${error.message}`);
  }
  return { ...rec, cached: false };
}

// ────────────────────────────────────────────────────────────────────────────
// Bulk verification — used during list import / enrollment creation
// ────────────────────────────────────────────────────────────────────────────

export interface BulkVerifyOptions extends VerifyOptions {
  concurrency?: number;
}

export interface BulkVerifyResult {
  total: number;
  results: VerifyResult[];
  counts: Record<VerificationStatus, number>;
}

export async function verifyEmailAddressesBulk(
  supabase: SupabaseServiceClient,
  organizationId: string,
  emails: string[],
  opts: BulkVerifyOptions = {},
): Promise<BulkVerifyResult> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 20));
  const dedup = Array.from(new Set(emails.map((e) => e?.trim().toLowerCase()).filter(Boolean)));
  const results: VerifyResult[] = [];
  for (let i = 0; i < dedup.length; i += concurrency) {
    const batch = dedup.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((e) => verifyEmailAddress(supabase, organizationId, e, opts)));
    results.push(...batchResults);
  }
  const counts: Record<VerificationStatus, number> = {
    valid: 0, invalid: 0, risky: 0, catch_all: 0, disposable: 0, role: 0, unknown: 0,
  };
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { total: dedup.length, results, counts };
}

/**
 * Bulk verification via the Apify Million Verifier actor — "Full" mode.
 *
 * Heuristic short-circuits run first (free + instant); anything that survives
 * is sent to Apify in one batch. Cache is consulted before the actor call so
 * we don't pay $0.001 to re-verify an address we've seen in the last 30 days.
 *
 * Returns the same BulkVerifyResult shape as verifyEmailAddressesBulk so the
 * caller can stay agnostic of the path that ran.
 */
export async function verifyEmailAddressesBulkViaApify(
  supabase: SupabaseServiceClient,
  organizationId: string,
  emails: string[],
  apifyToken: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<BulkVerifyResult> {
  const dedup = Array.from(new Set(emails.map((e) => e?.trim().toLowerCase()).filter(Boolean)));
  const results: VerifyResult[] = [];
  const remaining: string[] = [];

  // 1. Heuristic short-circuits — disposable / malformed never need a paid call.
  //    Role addresses go to the provider like any other mailbox.
  for (const email of dedup) {
    const norm = normalize(email);
    if (!norm.ok) {
      results.push(await persist(supabase, organizationId, {
        email, email_lower: norm.lower, domain: norm.domain, local_part: norm.local,
        status: 'invalid', provider: 'heuristic', smtp_response_code: null,
        is_disposable: false, is_role: false, is_catch_all: false, is_spamtrap: false,
        raw_response: { reason: 'malformed' },
      }));
      continue;
    }
    if (isDisposableEmail(email)) {
      results.push(await persist(supabase, organizationId, {
        email, email_lower: norm.lower, domain: norm.domain, local_part: norm.local,
        status: 'disposable', provider: 'heuristic', smtp_response_code: null,
        is_disposable: true, is_role: false, is_catch_all: false, is_spamtrap: false,
        raw_response: { reason: 'disposable_domain' },
      }));
      continue;
    }
    remaining.push(email);
  }

  // 2. Cache lookup for everything that survives heuristics
  const toApify: string[] = [];
  if (!opts.forceRefresh && remaining.length > 0) {
    const { data: cached } = await supabase
      .from('email_address_verifications')
      .select('*')
      .eq('organization_id', organizationId)
      .in('email_lower', remaining)
      .gt('expires_at', new Date().toISOString());
    const cachedMap = new Map<string, VerificationRecord>();
    for (const row of (cached ?? []) as unknown as VerificationRecord[]) {
      cachedMap.set(row.email_lower, row);
    }
    for (const email of remaining) {
      const hit = cachedMap.get(email.toLowerCase());
      if (hit && !isStaleRoleVerdict(hit)) {
        results.push({ ...hit, cached: true });
      } else {
        toApify.push(email);
      }
    }
  } else {
    toApify.push(...remaining);
  }

  // 3. Send the rest to Apify in chunks (sync run cap is 5 min; keep ≤200/batch)
  const APIFY_BATCH = 200;
  for (let i = 0; i < toApify.length; i += APIFY_BATCH) {
    const slice = toApify.slice(i, i + APIFY_BATCH);
    let items: ApifyVerifierItem[] = [];
    try {
      items = await runApifyVerifierBatch(apifyToken, slice);
    } catch (e) {
      console.warn(`[list-verifier] Apify batch failed: ${e instanceof Error ? e.message : 'unknown'}; degrading to heuristic for this batch.`);
      // Degrade gracefully — heuristic-only for the failed batch
      for (const email of slice) {
        const norm = normalize(email);
        const h = await checkHeuristic(email);
        results.push(await persist(supabase, organizationId, {
          email, email_lower: norm.lower, domain: norm.domain, local_part: norm.local,
          status: h.status, provider: 'heuristic', smtp_response_code: null,
          is_disposable: h.status === 'disposable', is_role: isRoleLocalPart(norm.local),
          is_catch_all: false, is_spamtrap: false, raw_response: h.raw,
        }));
      }
      continue;
    }

    // Index actor output by email_lower for stable lookup
    const byEmail = new Map<string, ApifyVerifierItem>();
    for (const it of items) {
      const e = (it.email ?? '').trim().toLowerCase();
      if (e) byEmail.set(e, it);
    }

    for (const email of slice) {
      const norm = normalize(email);
      const item = byEmail.get(norm.lower);
      if (!item) {
        // Actor returned nothing for this address — record as unknown so we
        // don't silently drop it.
        results.push(await persist(supabase, organizationId, {
          email, email_lower: norm.lower, domain: norm.domain, local_part: norm.local,
          status: 'unknown', provider: 'apify_million_verifier', smtp_response_code: null,
          is_disposable: false, is_role: isRoleLocalPart(norm.local), is_catch_all: false, is_spamtrap: false,
          raw_response: { reason: 'no_actor_output' },
        }));
        continue;
      }
      const status = mapApifyVerifierItem(item);
      results.push(await persist(supabase, organizationId, {
        email, email_lower: norm.lower, domain: norm.domain, local_part: norm.local,
        status, provider: 'apify_million_verifier',
        smtp_response_code: typeof item.resultcode === 'number' ? item.resultcode : null,
        is_disposable: !!item.disposable,
        is_role: !!item.role || isRoleLocalPart(norm.local),
        is_catch_all: status === 'catch_all',
        is_spamtrap: false,
        raw_response: item,
      }));
    }
  }

  const counts: Record<VerificationStatus, number> = {
    valid: 0, invalid: 0, risky: 0, catch_all: 0, disposable: 0, role: 0, unknown: 0,
  };
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { total: dedup.length, results, counts };
}

// Bulk Mailtester Ninja verification lives in the dedicated async pipeline:
//   - mailtester-verify-kickoff (heuristic + cache pre-pass, enqueue)
//   - mailtester-verify-worker  (cron-driven, paced drain inside daily cap)
// The single-email path above (verifyEmailAddress + checkMailtesterNinja) is
// still used for sequence-time on-demand verification.

// ────────────────────────────────────────────────────────────────────────────
// Enrollment-time decision: should we allow this address?
// Centralizes the policy so the sequence processor stays terse.
// ────────────────────────────────────────────────────────────────────────────

export interface AllowDecision {
  allow: boolean;
  reason: string;
  status: VerificationStatus;
}

export function decideAllow(
  result: VerifyResult,
  config: OrgVerifierConfig,
  sequenceAllowsRisky: boolean,
): AllowDecision {
  switch (result.status) {
    case 'valid':
      return { allow: true, reason: 'valid', status: result.status };
    case 'invalid':
      return { allow: false, reason: 'invalid_address', status: result.status };
    case 'disposable':
      return { allow: false, reason: 'disposable_domain', status: result.status };
    case 'role':
      return {
        allow: config.allow_role,
        reason: config.allow_role ? 'role_address_allowed_by_org' : 'role_address',
        status: result.status,
      };
    case 'catch_all':
      return {
        allow: !config.block_catchall,
        reason: config.block_catchall ? 'catchall_domain' : 'catchall_allowed_by_org',
        status: result.status,
      };
    case 'risky':
    case 'unknown':
      return {
        allow: sequenceAllowsRisky || config.allow_risky,
        reason: sequenceAllowsRisky || config.allow_risky ? 'risky_allowed' : 'risky_or_unknown',
        status: result.status,
      };
    default:
      return { allow: true, reason: 'default_allow', status: result.status };
  }
}
