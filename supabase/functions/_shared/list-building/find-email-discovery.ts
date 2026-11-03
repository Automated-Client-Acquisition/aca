/**
 * ACA Discovery Layer — find-email entry point.
 *
 * Wires the existing pattern cache + permutation generator + SMTP verifier
 * into a single helper that the campaign-processor's findEmail step calls
 * before falling through to legacy enrichment providers (apollo/hunter/prospeo).
 *
 * Spec: ACA Discovery Layer Implementation Brief v1.2, §6 + §9.
 */

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { PatternCache } from './pattern-cache.ts';
import { generatePermutations } from './permutation-generator.ts';
import { verifyEmail } from './smtp-verifier.ts';
import { parseFromPair } from './name-parser.ts';
import { ProxyManager } from './proxy-manager.ts';
import { normalizeDomain } from '../enrichment/index.ts';
import { resolveMx } from '../dns-utils.ts';
import type { Permutation, VerificationResult } from './types.ts';

export interface DiscoveryFindEmailInput {
  contactId: string;
  organizationId: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  companyWebsite?: string | null;
  /** Existing email column on contact, if known (used purely as a domain hint). */
  existingEmail?: string | null;
  /** Headcount hint for §9.3 bias (companySize). */
  companySize?: number | null;
  /** Industry hint for §9.3 bias. */
  industry?: string | null;
  /** Optional country-code TLD hint (lowercase, e.g. 'de', 'fr'). */
  tldHint?: string | null;
}

export interface DiscoveryFindEmailResult {
  email: string | null;
  pattern: string | null;
  confidence: number;          // 0-100
  catchAll: boolean;
  reason:
    | 'pattern_hit'
    | 'pattern_inferred'
    | 'multi_pattern_hit'
    | 'catch_all_inherited'
    | 'no_domain'
    | 'mx_invalid'
    | 'discovery_exhausted'
    | 'no_pattern'
    | 'all_candidates_rejected'
    | 'cache_negative'
    | 'pattern_miss_discovery_queued';
}

const MX_PROVIDER_RULES: Array<{ pattern: RegExp; provider: 'google' | 'microsoft' }> = [
  { pattern: /(google|gmail|googlemail|aspmx\.l\.google\.com)/i, provider: 'google' },
  { pattern: /(outlook|microsoft|hotmail|office365|protection\.outlook\.com)/i, provider: 'microsoft' },
];

function classifyMxProvider(mxHosts: string[]): 'google' | 'microsoft' | 'other' {
  for (const host of mxHosts) {
    for (const rule of MX_PROVIDER_RULES) {
      if (rule.pattern.test(host)) return rule.provider;
    }
  }
  return 'other';
}

function deriveDomain(input: DiscoveryFindEmailInput): string | null {
  if (input.existingEmail && input.existingEmail.includes('@')) {
    return input.existingEmail.split('@')[1].toLowerCase();
  }
  if (input.companyWebsite) {
    const d = normalizeDomain(input.companyWebsite);
    if (d) return d;
  }
  return null;
}

function deriveTld(domain: string): string {
  const parts = domain.split('.');
  return parts[parts.length - 1] || '';
}

interface VerifyOnce {
  email: string;
  pattern: string;
  result: VerificationResult;
}

async function verifyCandidates(
  candidates: Permutation[],
  mxHosts: string[],
  proxyManager: ProxyManager,
  domain: string,
): Promise<VerifyOnce[]> {
  const out: VerifyOnce[] = [];
  for (const c of candidates) {
    const proxy = proxyManager.pickForDomain(domain);
    const result = await verifyEmail(c.email, {
      mxHosts,
      proxyId: proxy?.id,
      proxy: proxy
        ? {
            type: proxy.type,
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            password: proxy.password,
          }
        : undefined,
    });
    out.push({ email: c.email, pattern: c.pattern, result });
    if (result.status === 'verified') return out; // short-circuit
  }
  return out;
}

/**
 * Try to resolve a contact's email using ACA's own engine. Returns null email
 * (with a reason code) when the engine cannot resolve, so the caller can fall
 * through to legacy providers.
 */
export async function findEmailViaDiscovery(
  supabase: SupabaseClient,
  input: DiscoveryFindEmailInput,
): Promise<DiscoveryFindEmailResult> {
  const domain = deriveDomain(input);
  if (!domain) {
    return {
      email: null,
      pattern: null,
      confidence: 0,
      catchAll: false,
      reason: 'no_domain',
    };
  }

  const cache = new PatternCache(supabase, input.organizationId);

  // §9.7 alias-aware lookup
  const { record, resolved_domain } = await cache.getWithAliases(domain);

  // Fast-fail: discovery already exhausted at this domain
  if (record?.discovery_exhausted && record.negative_result && record.confidence === 0) {
    return {
      email: null,
      pattern: null,
      confidence: 0,
      catchAll: !!record.catch_all,
      reason: 'discovery_exhausted',
    };
  }

  // Resolve MX once (also used to classify the ESP for §9.3 bias)
  const mxHosts = await resolveMx(resolved_domain);
  if (mxHosts.length === 0) {
    return {
      email: null,
      pattern: null,
      confidence: 0,
      catchAll: false,
      reason: 'mx_invalid',
    };
  }

  const mxProvider = classifyMxProvider(mxHosts);
  if (!record?.mx_provider || record.mx_provider !== mxProvider) {
    cache.setMxProvider(resolved_domain, mxProvider).catch(() => {/* non-blocking */});
  }

  const proxyManager = new ProxyManager(supabase, input.organizationId);
  try {
    await proxyManager.loadActivePool();
  } catch (err) {
    console.error('[discovery] proxy pool load failed', err);
  }

  const parsedName = parseFromPair(input.firstName ?? '', input.lastName ?? '');
  if (!parsedName.first) {
    return {
      email: null,
      pattern: null,
      confidence: 0,
      catchAll: false,
      reason: 'no_pattern',
    };
  }

  // ---------- 1. Pattern hit: cached single pattern, high confidence -----------
  if (record?.pattern && !record.negative_result && record.confidence >= 75 && !record.multi_pattern) {
    const perms = generatePermutations(parsedName, resolved_domain, {
      forcePattern: record.pattern,
    });
    if (perms.length > 0) {
      const verified = await verifyCandidates(perms, mxHosts, proxyManager, resolved_domain);
      const hit = verified.find((v) => v.result.status === 'verified');
      if (hit) {
        return {
          email: hit.email,
          pattern: hit.pattern,
          confidence: record.confidence,
          catchAll: false,
          reason: 'pattern_hit',
        };
      }
      const catchHit = verified.find((v) => v.result.status === 'catch_all');
      if (catchHit) {
        return {
          email: catchHit.email,
          pattern: catchHit.pattern,
          confidence: Math.min(record.confidence, 75),
          catchAll: true,
          reason: 'catch_all_inherited',
        };
      }
    }
  }

  // ---------- 2. Multi-pattern domain: try all known patterns ------------------
  if (record?.multi_pattern && record.known_patterns && record.known_patterns.length > 0) {
    const allPerms: Permutation[] = [];
    for (const pat of record.known_patterns) {
      const perms = generatePermutations(parsedName, resolved_domain, { forcePattern: pat });
      allPerms.push(...perms);
    }
    if (allPerms.length > 0) {
      const verified = await verifyCandidates(allPerms, mxHosts, proxyManager, resolved_domain);
      const hit = verified.find((v) => v.result.status === 'verified');
      if (hit) {
        return {
          email: hit.email,
          pattern: hit.pattern,
          confidence: 90,
          catchAll: false,
          reason: 'multi_pattern_hit',
        };
      }
    }
  }

  // ---------- 3. No usable pattern: queue discovery agent (non-blocking) -------
  const agentLastRun = record?.last_discovery_at ? new Date(record.last_discovery_at).getTime() : 0;
  const agentCooldownMs = 60 * 60 * 1000; // 1 hour
  const shouldQueueAgent =
    !record?.discovery_exhausted &&
    Date.now() - agentLastRun > agentCooldownMs;

  if (shouldQueueAgent) {
    supabase.functions
      .invoke('list-building-discover-pattern', {
        body: {
          organization_id: input.organizationId,
          domain: resolved_domain,
          contact_id: input.contactId,
        },
      })
      .then(() => {/* fire & forget */}, (err: unknown) =>
        console.error('[discovery] discover-pattern dispatch failed', err)
      );
    return {
      email: null,
      pattern: null,
      confidence: 0,
      catchAll: !!record?.catch_all,
      reason: 'pattern_miss_discovery_queued',
    };
  }

  return {
    email: null,
    pattern: null,
    confidence: 0,
    catchAll: !!record?.catch_all,
    reason: 'cache_negative',
  };
}
