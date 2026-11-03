/**
 * MoltSets Enrichment Adapter
 *
 * MoltSets is a LinkedIn identity-resolution API. We use its
 * reverse_linkedin_lookup endpoint — NOT linkedin_to_best_email.
 *
 * Both cost exactly ONE record (verified live 2026-08-10: consecutive calls
 * took the 5h balance 14980 -> 14979). But best_email returns four fields
 * (email, type, risk_score, last_validated_at) while reverse returns
 * twenty-six, including title, seniority, location, personal email, and the
 * company's real employee_count, revenue_range, industry and website.
 *
 * A/B on 184 identical profiles: reverse found 95 emails, best_email 89, and
 * all 87 overlaps were byte-identical. It is NOT quite a superset though —
 * best_email found 2 addresses reverse missed (1.1%). So reverse runs first
 * and best_email is a fallback on miss only. A miss is not charged, so the
 * fallback costs a record only when it actually succeeds: all 97 addresses,
 * for ~2 extra records per 184 profiles.
 *
 * That matters beyond this adapter. Company size and revenue are the scarcest
 * data in the platform (~75k records/week ceiling), and this is the highest-
 * volume MoltSets caller there is. Asking for an email only meant paying full
 * price and discarding the firmographics — which are exactly what the shared
 * lead pool needs. Every enrichment now also repairs the pool.
 *
 * API docs: https://context7.com/websites/developer_moltsets/llms.txt
 *
 * Confirmed live (this session, 200-profile test on personal /in/ URLs):
 * - 33% real match rate.
 * - Real throughput is plan-tiered, NOT the docs' claimed "100 req/s" — see
 *   MOLTSETS_PLAN_LIMITS below, measured via 429s and daily_results_remaining.
 * - /company/ URLs always 422 (invalid_input) — canHandle() rejects them.
 * - A miss is a genuine 404 (moltsets_status "not_found"), tokens_used: 0 —
 *   not charged, not the same as a rate limit (429), which is retryable.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type {
  EnrichmentAdapter,
  EnrichmentInput,
  EnrichmentResult,
  EnrichmentType,
  EnrichedData,
  EnrichmentErrorCode,
} from './index.ts';
import {
  refundRateLimitedProviderRequest,
  reserveEnrichmentProviderRequest,
} from './rate-limit.ts';

const MOLTSETS_API_BASE = 'https://api.moltsets.com/api/v1';

export type MoltsetsPlanTier = 'tier_27' | 'tier_97' | 'tier_997' | 'unlimited';

/** Source of truth for plan-derived pacing/caps — mirrors MAILTESTER_PLAN_LIMITS in _shared/list-verifier.ts.
 * dailyCap null = no daily cap.
 *
 * reqPerMin is only ever a SEED. Where recordsPerMin is set, the scheduler
 * measures the live find rate and derives the request rate itself
 * (see reserve_enrichment_provider_request), because these plans meter
 * RECORDS — a lookup that returns data — and a miss costs nothing. Any fixed
 * rpm silently encodes one assumed find rate: too low and most of the budget
 * sits idle, too high and it overshoots the moment the find rate rises. */
export const MOLTSETS_PLAN_LIMITS: Record<MoltsetsPlanTier, {
  reqPerMin: number;
  dailyCap: number | null;
  recordsPerMin?: number;
  maxReqPerMin?: number;
}> = {
  tier_27: { reqPerMin: 30, dailyCap: 1_000 },
  tier_97: { reqPerMin: 1_000, dailyCap: 15_000 },
  tier_997: { reqPerMin: 5_000, dailyCap: 100_000 },
  // "Unlimited tokens" plan, paced against the ENRICH fair-use windows (the
  // separate SEARCH quota is for people-search tools we don't call here):
  //   records  15,000 / rolling 5h -> 50/min  <- the real budget
  //   requests 75,000 / rolling 5h -> 250/min <- hard ceiling
  //   records  75,000 / rolling 7d -> weekly budget, bounds sustained burn
  // Holding <=50 records/min at every instant can never breach the rolling 5h
  // record cap, so the scheduler just converts that budget through the observed
  // find rate. 120 seeds it at roughly the ~40% find rate seen on LinkedIn
  // commenter lists, then it self-corrects.
  unlimited: { reqPerMin: 120, dailyCap: null, recordsPerMin: 50, maxReqPerMin: 250 },
};

interface MoltsetsLinkedInToEmailResponse {
  results?: {
    email?: string | null;
    type?: 'business' | 'personal' | null;
    last_validated_at?: string | null;
  };
  status?: string;
  error?: { code?: string; message?: string };
  metadata?: {
    tokens_used?: number;
    tokens_remaining?: number | 'unlimited';
    daily_results_remaining?: number;
  };
}

export class MoltsetsAdapter implements EnrichmentAdapter {
  readonly provider = 'moltsets' as const;
  readonly supportedTypes: EnrichmentType[] = ['email'];
  readonly creditsPerEnrichment = 1;

  canHandle(input: EnrichmentInput, types: EnrichmentType[]): boolean {
    if (!types.includes('email') && !types.includes('full')) return false;
    // MoltSets only resolves personal profiles — /company/ URLs 422.
    return !!input.linkedinUrl && input.linkedinUrl.includes('/in/');
  }

  async enrich(
    apiKey: string,
    input: EnrichmentInput,
    _types: EnrichmentType[]
  ): Promise<EnrichmentResult> {
    if (!input.linkedinUrl || !input.linkedinUrl.includes('/in/')) {
      return {
        success: false,
        provider: this.provider,
        creditsUsed: 0,
        data: {},
        error: { code: 'INVALID_INPUT', message: 'MoltSets requires a personal /in/ LinkedIn URL', retryable: false },
      };
    }

    try {
      const response = await fetch(`${MOLTSETS_API_BASE}/tools/reverse_linkedin_lookup`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ linkedin_url: input.linkedinUrl }),
      });

      const body: MoltsetsLinkedInToEmailResponse = await response.json().catch(() => ({}));

      if (response.status === 429) {
        return {
          success: false,
          provider: this.provider,
          creditsUsed: 0,
          data: {},
          error: { code: 'RATE_LIMITED', message: 'MoltSets rate limit hit', retryable: true },
        };
      }

      if (response.status === 422) {
        return {
          success: false,
          provider: this.provider,
          creditsUsed: 0,
          data: {},
          error: { code: 'INVALID_INPUT', message: body.error?.message || 'Invalid LinkedIn URL format', retryable: false },
        };
      }

      // reverse_linkedin_lookup nests the address as `business_email`; the old
      // endpoint called it `email`. Accept either so a rollback needs no code
      // change, and treat "profile found but no address" as NOT_FOUND exactly
      // as before — callers depend on that distinction.
      const rr = (body.results ?? {}) as Record<string, any>;
      const foundEmail: string | undefined = rr.business_email ?? rr.email ?? undefined;

      if (response.status === 404 || !foundEmail) {
        // Fallback: best_email occasionally resolves an address reverse does
        // not (2 of 184 measured). Only reached when reverse already came back
        // empty, and a miss is not billed, so this costs a record only when it
        // actually finds something. Firmographics are unavailable on this
        // path — an email is still better than nothing.
        const fb = await fetch(`${MOLTSETS_API_BASE}/tools/linkedin_to_best_email`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ linkedin_url: input.linkedinUrl }),
        }).catch(() => null);
        const fbBody = fb ? await fb.json().catch(() => ({})) : {};
        const fbEmail = (fbBody as any)?.results?.email as string | undefined;
        if (fbEmail) {
          return {
            success: true,
            provider: this.provider,
            creditsUsed: (fbBody as any)?.metadata?.tokens_used ?? 1,
            data: {
              email: fbEmail,
              emailType: (fbBody as any)?.results?.type ?? undefined,
              emailLastValidatedAt: (fbBody as any)?.results?.last_validated_at ?? null,
              emailRiskScore: (fbBody as any)?.results?.risk_score ?? undefined,
            } as EnrichedData,
          };
        }
        return {
          success: false,
          provider: this.provider,
          creditsUsed: body.metadata?.tokens_used || 0,
          data: {},
          error: { code: 'NOT_FOUND', message: 'No email found for this profile', retryable: false },
        };
      }

      if (!response.ok) {
        const code: EnrichmentErrorCode = response.status >= 500 ? 'PROVIDER_ERROR' : 'UNKNOWN';
        return {
          success: false,
          provider: this.provider,
          creditsUsed: 0,
          data: {},
          error: { code, message: body.error?.message || `MoltSets API ${response.status}`, retryable: code === 'PROVIDER_ERROR' },
        };
      }

      // The email contract to existing callers is unchanged — same field
      // names, same semantics — so nothing upstream has to know this switched
      // endpoints. What is new is everything else the same record already paid
      // for.
      //
      // risk_score IS a real deliverability grade (A-F), unlike the old
      // endpoint's bare `type`. It is passed through rather than mapped onto
      // emailVerified: F means "never validated" (every F-grade address
      // measured also had a null validated_at), and calling that "verified"
      // would be exactly the fabrication the old comment warned against.
      const co = (rr.company ?? {}) as Record<string, any>;
      const headcount = typeof co.employee_count === 'number' && co.employee_count > 0
        ? co.employee_count
        : undefined;
      const data: EnrichedData = {
        email: foundEmail,
        emailType: rr.type ?? undefined,
        emailLastValidatedAt: rr.business_email_validated_at ?? rr.last_validated_at ?? null,
        // Person-level truth. The pool files people under the employer they had
        // when it was captured; this is where they work NOW.
        title: rr.title ?? undefined,
        seniority: rr.seniority ?? undefined,
        city: rr.city ?? undefined,
        state: rr.state ?? undefined,
        country: rr.country ?? undefined,
        // Company firmographics — the scarce half, now captured for free on a
        // record we were already paying for.
        company: co.name
          ? {
              name: co.name,
              website: co.website_url ?? undefined,
              domain: co.website_url
                ? String(co.website_url)
                    .replace(/^https?:\/\//i, '')
                    .replace(/^www\./i, '')
                    .split('/')[0]
                    .toLowerCase()
                : undefined,
              industry: co.industry ?? undefined,
              size: co.employee_range ?? undefined,
              sizeRange: headcount ? { min: headcount, max: headcount } : undefined,
              revenue: co.revenue_range ?? undefined,
              linkedinUrl: co.linkedin_url ?? undefined,
            }
          : undefined,
        // Preserve the complete provider result so newly introduced MoltSets
        // fields are not discarded before ACA can persist them. Keep the
        // compatibility employee_count shadow used by the existing write-through.
        rawResponse: {
          ...rr,
          employee_count: headcount ?? rr.employee_count ?? null,
          _metadata: body.metadata ?? null,
        },
      };

      return {
        success: true,
        provider: this.provider,
        creditsUsed: body.metadata?.tokens_used ?? 1,
        data,
      };
    } catch (error) {
      return {
        success: false,
        provider: this.provider,
        creditsUsed: 0,
        data: {},
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          retryable: true,
        },
      };
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      // No lightweight account endpoint exists — probe a real lookup.
      // 401/403 = bad key; 404 still means the key authenticated.
      const response = await fetch(`${MOLTSETS_API_BASE}/tools/linkedin_to_best_email`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedin_url: 'https://www.linkedin.com/in/capejames' }),
      });
      return response.status !== 401 && response.status !== 403;
    } catch {
      return false;
    }
  }
}

export type MoltsetsRequestReservation = {
  status: 'granted' | 'daily_exhausted' | 'rate_wait';
  reservationId: string | null;
  waitMs: number;
  scheduledAt: string | null;
  dailyUsed: number;
  dailyCap: number | null;
  requestsPerMinute: number;
};

/**
 * Legacy daily-quota gate used by campaign-processor and
 * process-enrichment-queue. Kept alongside reserveMoltsetsRequest because
 * removing it broke those functions at BOOT (they import it by name).
 * A null dailyCap means the plan has no daily cap — always granted.
 */
export async function checkMoltsetsQuota(
  supabase: SupabaseClient<any>,
  organizationId: string,
  dailyCap: number | null,
): Promise<boolean> {
  if (dailyCap === null) return true;
  const { data, error } = await supabase.rpc('try_increment_enrichment_daily_usage', {
    p_organization_id: organizationId,
    p_provider: 'moltsets',
    p_daily_cap: dailyCap,
  });
  if (error) {
    console.error('checkMoltsetsQuota RPC error:', error);
    return false;
  }
  return data === true;
}

/**
 * Reserve one smoothly spaced start slot and one daily request atomically.
 * All callers sharing an org's MoltSets key use this scheduler, so fanout
 * fills the plan allowance without creating a 429-producing burst.
 */
export async function reserveMoltsetsRequest(
  supabase: SupabaseClient,
  organizationId: string,
  limits: {
    requestsPerMinute: number;
    dailyCap: number | null;
    recordsPerMinute?: number | null;
    maxRequestsPerMinute?: number | null;
  },
  maxWaitMs = 110_000,
): Promise<MoltsetsRequestReservation> {
  const reservation = await reserveEnrichmentProviderRequest(
    supabase,
    organizationId,
    'moltsets',
    {
      requestsPerMinute: limits.requestsPerMinute,
      dailyCap: limits.dailyCap,
      recordsPerMinute: limits.recordsPerMinute ?? null,
      maxRequestsPerMinute: limits.maxRequestsPerMinute ?? null,
    },
    maxWaitMs,
  );
  return {
    ...reservation,
    dailyCap: reservation.dailyCap ?? limits.dailyCap,
  };
}

/** Return an internally reserved daily unit when MoltSets itself answers 429. */
export async function refundRateLimitedMoltsetsRequest(
  supabase: SupabaseClient,
  reservationId: string | null,
): Promise<void> {
  await refundRateLimitedProviderRequest(supabase, reservationId);
}
