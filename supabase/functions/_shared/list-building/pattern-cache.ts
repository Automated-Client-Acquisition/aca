/**
 * ACA List Building Engine — Domain Pattern Cache
 *
 * Two-layer cache (per-request Map + Postgres `domain_pattern_cache`) that
 * short-circuits expensive permutation+SMTP sweeps once a domain's email
 * pattern is known. This is the engine's primary compounding moat — every
 * verified send should feed it.
 *
 * Spec: ACA_List_Building_Engine_Spec v1.0, section 5.5.
 */

import type { DomainAlias, PatternCacheRecord, PermutationTier } from './types.ts';

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function confidenceForSamples(sampleSize: number): number {
  if (sampleSize >= 3) return 97;
  if (sampleSize === 2) return 85;
  return 70;
}

function rowToRecord(data: Record<string, unknown>): PatternCacheRecord {
  return {
    domain: data.domain as string,
    pattern: (data.pattern as string | null) ?? null,
    tier: (data.tier as PermutationTier | null) ?? null,
    confidence: (data.confidence as number) ?? 0,
    sample_size: (data.sample_size as number) ?? 0,
    catch_all: !!data.catch_all,
    mx_valid: !!data.mx_valid,
    negative_result: !!data.negative_result,
    last_verified_at: (data.last_verified_at as string | null) ?? null,
    expires_at: (data.expires_at as string | null) ?? null,
    mx_provider: (data.mx_provider as string | null) ?? null,
    multi_pattern: !!data.multi_pattern,
    known_patterns: Array.isArray(data.known_patterns) ? (data.known_patterns as string[]) : [],
    bounce_count: (data.bounce_count as number) ?? 0,
    hard_bounce_window_30d: (data.hard_bounce_window_30d as number) ?? 0,
    last_discovery_at: (data.last_discovery_at as string | null) ?? null,
    discovery_exhausted: !!data.discovery_exhausted,
  };
}

export class PatternCache {
  private session = new Map<string, PatternCacheRecord>();

  constructor(
    private supabase: SupabaseLike,
    private orgId: string
  ) {}

  // ------------------------------------------------------------- session

  getFromSession(domain: string): PatternCacheRecord | null {
    return this.session.get(domain.toLowerCase()) ?? null;
  }

  // ------------------------------------------------------------- DB read

  async get(domain: string): Promise<PatternCacheRecord | null> {
    const d = domain.toLowerCase();
    const mem = this.session.get(d);
    if (mem) return mem;

    const { data, error } = await this.supabase
      .from('domain_pattern_cache')
      .select('*')
      .eq('organization_id', this.orgId)
      .eq('domain', d)
      .maybeSingle();

    if (error || !data) return null;

    // Honor expires_at
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      return null;
    }

    const record = rowToRecord(data);
    this.session.set(d, record);
    return record;
  }

  /**
   * §9.7 — Resolve sub-domain / acquisition aliases. If the domain is registered
   * as an alias of some primary domain, return that primary's cache record.
   * Falls through to the alias domain itself when no mapping exists.
   */
  async getWithAliases(domain: string): Promise<{ record: PatternCacheRecord | null; resolved_domain: string }> {
    const d = domain.toLowerCase();
    const direct = await this.get(d);
    if (direct && !direct.negative_result && direct.confidence >= 70) {
      return { record: direct, resolved_domain: d };
    }

    const { data: alias } = await this.supabase
      .from('domain_aliases')
      .select('primary_domain')
      .eq('organization_id', this.orgId)
      .eq('alias_domain', d)
      .maybeSingle();

    if (alias?.primary_domain) {
      const primary = await this.get(alias.primary_domain);
      if (primary) {
        return { record: primary, resolved_domain: alias.primary_domain };
      }
    }

    return { record: direct, resolved_domain: d };
  }

  async listAliases(primaryDomain: string): Promise<DomainAlias[]> {
    const { data, error } = await this.supabase
      .from('domain_aliases')
      .select('primary_domain, alias_domain, relationship, discovered_via')
      .eq('organization_id', this.orgId)
      .eq('primary_domain', primaryDomain.toLowerCase());
    if (error || !data) return [];
    return data as DomainAlias[];
  }

  async upsertAlias(alias: DomainAlias): Promise<void> {
    await this.supabase
      .from('domain_aliases')
      .upsert(
        {
          organization_id: this.orgId,
          primary_domain: alias.primary_domain.toLowerCase(),
          alias_domain: alias.alias_domain.toLowerCase(),
          relationship: alias.relationship,
          discovered_via: alias.discovered_via,
        },
        { onConflict: 'organization_id,alias_domain' },
      );
  }

  // --------------------------------------------------------- positive hit

  async recordHit(
    domain: string,
    pattern: string,
    tier: PermutationTier,
    catchAll: boolean,
    mxValid: boolean
  ): Promise<PatternCacheRecord> {
    const d = domain.toLowerCase();
    const existing = await this.get(d);
    const newSamples = (existing?.sample_size ?? 0) + 1;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);

    const record: PatternCacheRecord = {
      domain: d,
      pattern,
      tier,
      confidence: confidenceForSamples(newSamples),
      sample_size: newSamples,
      catch_all: catchAll,
      mx_valid: mxValid,
      negative_result: false,
      last_verified_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    await this.supabase
      .from('domain_pattern_cache')
      .upsert(
        {
          organization_id: this.orgId,
          domain: d,
          pattern,
          tier,
          confidence: record.confidence,
          sample_size: newSamples,
          catch_all: catchAll,
          mx_valid: mxValid,
          negative_result: false,
          last_verified_at: record.last_verified_at,
          expires_at: record.expires_at,
        },
        { onConflict: 'organization_id,domain' }
      );

    this.session.set(d, record);
    return record;
  }

  // --------------------------------------------------------- negative hit

  async recordNegative(domain: string, mxValid: boolean): Promise<PatternCacheRecord> {
    const d = domain.toLowerCase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);

    const record: PatternCacheRecord = {
      domain: d,
      pattern: null,
      tier: null,
      confidence: 0,
      sample_size: 0,
      catch_all: false,
      mx_valid: mxValid,
      negative_result: true,
      last_verified_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    await this.supabase
      .from('domain_pattern_cache')
      .upsert(
        {
          organization_id: this.orgId,
          domain: d,
          pattern: null,
          tier: null,
          confidence: 0,
          sample_size: 0,
          catch_all: false,
          mx_valid: mxValid,
          negative_result: true,
          last_verified_at: record.last_verified_at,
          expires_at: record.expires_at,
        },
        { onConflict: 'organization_id,domain' }
      );

    this.session.set(d, record);
    return record;
  }

  /**
   * Spec §5.5.3 — skip domains we've already proven unusable within TTL:
   *  - MX invalid
   *  - Negative result (burned through all permutations without a hit)
   *  - Catch-all (verification signal is meaningless, defer to enrichment)
   */
  shouldSkipDomain(record: PatternCacheRecord | null): boolean {
    if (!record) return false;
    if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) {
      return false;
    }
    if (!record.mx_valid) return true;
    if (record.negative_result) return true;
    if (record.catch_all) return true;
    return false;
  }

  // ----------------------------------------------------------- §9.6 multi-pattern

  /**
   * Mark a domain as serving multiple email patterns simultaneously (e.g. M&A
   * post-merge, divisional differences, name-collision disambiguation).
   * Future contacts at this domain need every observed pattern tested in parallel.
   */
  async markMultiPattern(domain: string, knownPatterns: string[]): Promise<void> {
    const d = domain.toLowerCase();
    const unique = Array.from(new Set(knownPatterns.filter(Boolean)));
    await this.supabase
      .from('domain_pattern_cache')
      .upsert(
        {
          organization_id: this.orgId,
          domain: d,
          multi_pattern: true,
          known_patterns: unique,
        },
        { onConflict: 'organization_id,domain' },
      );
    const session = this.session.get(d);
    if (session) {
      session.multi_pattern = true;
      session.known_patterns = unique;
    }
  }

  // ----------------------------------------------------------- §9.3 MX provider

  async setMxProvider(domain: string, provider: 'google' | 'microsoft' | 'other'): Promise<void> {
    const d = domain.toLowerCase();
    await this.supabase
      .from('domain_pattern_cache')
      .upsert(
        {
          organization_id: this.orgId,
          domain: d,
          mx_provider: provider,
        },
        { onConflict: 'organization_id,domain' },
      );
    const session = this.session.get(d);
    if (session) session.mx_provider = provider;
  }

  // ----------------------------------------------------------- §9.4 discovery agent state

  async markDiscoveryAttempted(domain: string, exhausted: boolean): Promise<void> {
    const d = domain.toLowerCase();
    await this.supabase
      .from('domain_pattern_cache')
      .upsert(
        {
          organization_id: this.orgId,
          domain: d,
          last_discovery_at: new Date().toISOString(),
          discovery_exhausted: exhausted,
        },
        { onConflict: 'organization_id,domain' },
      );
    const session = this.session.get(d);
    if (session) {
      session.last_discovery_at = new Date().toISOString();
      session.discovery_exhausted = exhausted;
    }
  }

  // ----------------------------------------------------------- §9.10 bounce-driven invalidation

  /**
   * Increment hard-bounce counters; the SQL helper `dpc_record_hard_bounce`
   * handles threshold-based invalidation atomically.
   */
  async recordHardBounce(domain: string): Promise<void> {
    const d = domain.toLowerCase();
    await this.supabase.rpc('dpc_record_hard_bounce', {
      p_org_id: this.orgId,
      p_domain: d,
    });
    // Bust session cache so next read pulls the (possibly invalidated) row.
    this.session.delete(d);
  }
}
