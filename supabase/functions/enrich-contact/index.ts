/**
 * Enrich Contact Edge Function
 *
 * Enriches a single contact using configured enrichment providers.
 *
 * Endpoint: POST /enrich-contact
 * Body: {
 *   contactId: string,
 *   enrichmentTypes: ('email' | 'phone' | 'company' | 'social' | 'full')[],
 *   preferredProvider?: 'apollo' | 'hunter' | 'clearbit' | 'rocketreach' | 'prospeo' | 'moltsets',
 *   preferredProviders?: EnrichmentProvider[], // ordered provider chain
 *   strictPreferredProviders?: boolean,         // do not fall through outside the chain
 *   applyToContact?: boolean (default true)
 * }
 *
 * Response: {
 *   success: boolean,
 *   provider: string,
 *   creditsUsed: number,
 *   data: EnrichedData,
 *   appliedToContact?: boolean,
 *   error?: { code: string, message: string }
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

import {
  EnrichmentRouter,
  ApolloAdapter,
  HunterAdapter,
  ProspeoAdapter,
  MoltsetsAdapter,
  QuickenrichAdapter,
  type EnrichmentProvider,
  type EnrichmentResult,
  type EnrichmentType,
  type EnrichmentInput,
} from '../_shared/enrichment/index.ts';
import { applyEnrichmentResult } from '../_shared/enrichment/write-back.ts';
import { type MoltsetsPlanTier } from '../_shared/enrichment/moltsets.ts';
import { resolveMoltsetsPacing } from '../_shared/enrichment/moltsets-budget.ts';
import { QUICKENRICH_PLAN_LIMITS, type QuickenrichPlanTier } from '../_shared/enrichment/quickenrich.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import {
  refundRateLimitedProviderRequest,
  reportEnrichmentProviderRecord,
  reserveEnrichmentProviderRequest,
  type ProviderRateLimits,
} from '../_shared/enrichment/rate-limit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function providerFailure(
  provider: EnrichmentProvider,
  code: 'INVALID_INPUT' | 'QUOTA_EXCEEDED' | 'AUTHENTICATION_FAILED' | 'PROVIDER_ERROR',
  message: string,
) {
  return new Response(
    JSON.stringify({
      success: false,
      provider,
      creditsUsed: 0,
      data: {},
      appliedToContact: false,
      error: { code, message, retryable: false },
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

function configuredProviderLimits(
  provider: EnrichmentProvider,
  metadata: Record<string, unknown> | null,
): ProviderRateLimits | null {
  if (provider === 'hunter') return { requestsPerMinute: 500 };
  if (provider === 'prospeo') {
    switch (metadata?.plan) {
      case 'starter': return { requestsPerMinute: 300, dailyCap: 2_000 };
      case 'growth': return { requestsPerMinute: 300, dailyCap: 5_000 };
      case 'pro': return { requestsPerMinute: 1_800, dailyCap: 500_000 };
      default: return { requestsPerMinute: 20, dailyCap: 50 };
    }
  }
  if (provider === 'quickenrich') {
    const tier = (metadata?.plan as QuickenrichPlanTier | undefined) ?? 'standard';
    const limits = QUICKENRICH_PLAN_LIMITS[tier] ?? QUICKENRICH_PLAN_LIMITS.standard;
    return { requestsPerMinute: limits.reqPerMin, dailyCap: limits.dailyCap };
  }
  if (provider === 'apollo') {
    const requestsPerMinute = Number(metadata?.requests_per_minute);
    return Number.isFinite(requestsPerMinute) && requestsPerMinute > 0
      ? { requestsPerMinute }
      : null;
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Parse request
    const {
      contactId,
      enrichmentTypes = ['email', 'phone'],
      preferredProvider,
      preferredProviders,
      strictPreferredProviders = false,
      applyToContact = true,
      leadListId,
      maxProviderWaitMs,
    } = await req.json();

    if (!contactId) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'contactId is required' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const providerWaitMs = Number.isFinite(Number(maxProviderWaitMs))
      ? Math.max(0, Math.min(Number(maxProviderWaitMs), 110_000))
      : 110_000;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get contact with their identities
    const { data: contact, error: contactError } = await supabase
      .from('crm_contacts')
      .select(`
        id,
        organization_id,
        display_name,
        first_name,
        last_name,
        company,
        company_website,
        job_title,
        primary_email,
        primary_phone,
        primary_linkedin_url,
        crm_contact_identities (
          channel,
          platform_user_id,
          platform_username
        )
      `)
      .eq('id', contactId)
      .single();

    if (contactError || !contact) {
      console.error('Contact not found:', contactError);
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Contact not found' } }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, contact.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // Build enrichment input from contact data
    const input: EnrichmentInput = {
      fullName: contact.display_name || undefined,
      firstName: contact.first_name || undefined,
      lastName: contact.last_name || undefined,
      companyName: contact.company || undefined,
      companyDomain: contact.company_website || undefined,
      email: contact.primary_email || undefined,
      phone: contact.primary_phone || undefined,
      linkedinUrl: contact.primary_linkedin_url || undefined,
    };

    // Also check LinkedIn identity if primary_linkedin_url is not set
    if (!input.linkedinUrl) {
      const linkedinIdentity = contact.crm_contact_identities?.find(
        (i: { channel: string; platform_user_id: string }) => i.channel === 'linkedin'
      );
      if (linkedinIdentity) {
        input.linkedinUrl = linkedinIdentity.platform_user_id;
      }
    }

    // Get configured enrichment providers for this organization
    const { data: apiKeys, error: apiKeysError } = await supabase
      .from('api_keys')
      .select('provider, key_encrypted, is_valid, metadata')
      .eq('organization_id', contact.organization_id)
      .in('provider', ['apollo', 'hunter', 'clearbit', 'rocketreach', 'prospeo', 'moltsets', 'quickenrich']);

    if (apiKeysError) {
      console.error('Error fetching API keys:', apiKeysError);
      return new Response(
        JSON.stringify({ success: false, error: { code: 'PROVIDER_ERROR', message: 'Failed to fetch provider configuration' } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const requestedProvider = strictPreferredProviders && preferredProviders?.length === 1
      ? preferredProviders[0] as EnrichmentProvider
      : null;
    const requestedKey = requestedProvider
      ? apiKeys?.find((key) => key.provider === requestedProvider)
      : null;

    if (requestedProvider && !requestedKey) {
      return providerFailure(
        requestedProvider,
        'PROVIDER_ERROR',
        `${requestedProvider} is not connected for this organization`,
      );
    }
    if (requestedProvider && requestedKey && !requestedKey.is_valid) {
      return providerFailure(
        requestedProvider,
        'AUTHENTICATION_FAILED',
        `${requestedProvider} API key is invalid`,
      );
    }

    const validApiKeys = apiKeys?.filter((key) => key.is_valid) ?? [];
    if (validApiKeys.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'PROVIDER_ERROR', message: 'No enrichment providers configured. Add Apollo.io or Hunter.io API keys in Settings.' }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize enrichment router
    const router = new EnrichmentRouter(encryptionKey);

    // Register adapters
    router.registerAdapter(new ApolloAdapter());
    router.registerAdapter(new HunterAdapter());
    router.registerAdapter(new ProspeoAdapter());
    const moltsetsAdapter = new MoltsetsAdapter();
    router.registerAdapter(moltsetsAdapter);
    const quickenrichAdapter = new QuickenrichAdapter();
    router.registerAdapter(quickenrichAdapter);

    const requestedTypes = enrichmentTypes as EnrichmentType[];
    if (
      requestedProvider === 'moltsets'
      && !moltsetsAdapter.canHandle(input, requestedTypes)
    ) {
      return providerFailure(
        'moltsets',
        'INVALID_INPUT',
        'MoltSets requires a personal LinkedIn profile URL',
      );
    }
    if (
      requestedProvider === 'quickenrich'
      && !quickenrichAdapter.canHandle(input, requestedTypes)
    ) {
      return providerFailure(
        'quickenrich',
        'INVALID_INPUT',
        'QuickEnrich requires linkedin_url OR (company_url + first_name + last_name)',
      );
    }

    // Configure providers from API keys. MoltSets receives request hooks so
    // capacity is reserved only if the router actually reaches that provider.
    console.log('Configuring providers:', validApiKeys.map(k => k.provider));
    for (const key of validApiKeys) {
      let beforeEnrich: (() => Promise<EnrichmentResult | null>) | undefined;
      let afterEnrich: ((result: EnrichmentResult) => Promise<void>) | undefined;
      let rateLimits = configuredProviderLimits(
        key.provider as EnrichmentProvider,
        key.metadata as Record<string, unknown> | null,
      );
      if (key.provider === 'moltsets') {
        const metadataTier = (key.metadata as { plan?: MoltsetsPlanTier } | null)?.plan ?? null;
        // Ask MoltSets what it will still let us spend rather than trusting a
        // hardcoded budget: the static table only ever modelled the 5h window,
        // so the rolling 1w one went unenforced. Cached on a TTL inside.
        const pacing = await resolveMoltsetsPacing(
          supabase,
          contact.organization_id,
          await decryptApiKey(key.key_encrypted, encryptionKey),
          metadataTier,
        );
        if (!pacing) {
          console.warn('MoltSets key has no plan tier configured, skipping');
          if (requestedProvider === 'moltsets') {
            return providerFailure('moltsets', 'PROVIDER_ERROR', 'MoltSets plan tier is not configured');
          }
          continue;
        }
        if (pacing.exhausted) {
          console.warn(`MoltSets fair-use budget spent, resets ${pacing.exhaustedResetAt ?? 'unknown'}`);
          if (requestedProvider === 'moltsets') {
            return providerFailure(
              'moltsets',
              'QUOTA_EXCEEDED',
              `MoltSets fair-use record budget is spent until ${pacing.exhaustedResetAt ?? 'the next window'}`,
            );
          }
          continue;
        }
        rateLimits = {
          requestsPerMinute: pacing.requestsPerMinute,
          dailyCap: pacing.dailyCap,
          recordsPerMinute: pacing.recordsPerMinute,
          maxRequestsPerMinute: pacing.maxRequestsPerMinute,
        };
      }

      if (rateLimits) {
        const provider = key.provider as EnrichmentProvider;
        const activeRateLimits = rateLimits;
        let reservationId: string | null = null;
        beforeEnrich = async () => {
          try {
            const reservation = await reserveEnrichmentProviderRequest(
              supabase,
              contact.organization_id,
              provider,
              activeRateLimits,
              providerWaitMs,
              typeof leadListId === 'string' ? leadListId : undefined,
            );
            if (reservation.status === 'daily_exhausted') {
              return {
                success: false,
                provider,
                creditsUsed: 0,
                data: {},
                error: {
                  code: 'QUOTA_EXCEEDED',
                  message: `${provider} daily request limit reached`,
                  retryable: false,
                },
              };
            }
            if (reservation.status === 'rate_wait') {
              return {
                success: false,
                provider,
                creditsUsed: 0,
                data: {},
                error: {
                  code: 'RATE_LIMITED',
                  message: `${provider} request capacity is fully scheduled`,
                  retryable: true,
                  details: {
                    retryAfterMs: reservation.waitMs,
                    nextAvailableAt: reservation.scheduledAt,
                  },
                },
              };
            }
            reservationId = reservation.reservationId;
            return null;
          } catch (error) {
            return {
              success: false,
              provider,
              creditsUsed: 0,
              data: {},
              error: {
                code: 'PROVIDER_ERROR',
                message: error instanceof Error ? error.message : `${provider} request scheduler failed`,
                retryable: true,
              },
            };
          }
        };
        afterEnrich = async (result) => {
          if (result.error?.code === 'RATE_LIMITED') {
            await refundRateLimitedProviderRequest(supabase, reservationId);
          }
          // The scheduler counted a request when it granted the slot; tell it
          // whether that request actually spent a record, so it can keep
          // deriving the request rate from a live find rate. A miss (or a 429)
          // costs no record and is reported as such — no-op, no round trip.
          await reportEnrichmentProviderRecord(
            supabase,
            contact.organization_id,
            provider,
            !!result.data?.email,
          );
          // A MoltSets miss writes nothing to the contact, leaving "attempted,
          // no email" indistinguishable from "never attempted" — and leaves the
          // contact eligible for a duplicate lookup via any path that filters on
          // moltsets_attempted_at IS NULL (claim_contacts_for_moltsets). Stamp
          // every resolution the API actually answered (hit or 404 miss).
          // Transient outcomes (429/5xx/network) stay unstamped and retryable.
          if (
            provider === 'moltsets'
            && (result.success || result.error?.code === 'NOT_FOUND')
          ) {
            const { error: stampError } = await supabase
              .from('crm_contacts')
              .update({ moltsets_attempted_at: new Date().toISOString() })
              .eq('id', contactId)
              .eq('organization_id', contact.organization_id);
            if (stampError) console.warn('Could not stamp moltsets_attempted_at:', stampError);
          }
          if (
            provider === 'quickenrich'
            && (result.success || result.error?.code === 'NOT_FOUND')
          ) {
            const { error: stampError } = await supabase
              .from('crm_contacts')
              .update({ quickenrich_attempted_at: new Date().toISOString() })
              .eq('id', contactId)
              .eq('organization_id', contact.organization_id);
            if (stampError) console.warn('Could not stamp quickenrich_attempted_at:', stampError);
          }
        };
      }
      router.configureProvider(key.provider as EnrichmentProvider, {
        apiKeyEncrypted: key.key_encrypted,
        isEnabled: true,
        priority: key.provider === preferredProvider ? 0 : 1,
        beforeEnrich,
        afterEnrich,
      });
    }

    // Log input for debugging
    console.log('Enrichment input:', JSON.stringify({
      input,
      enrichmentTypes,
      preferredProvider,
    }));

    // Execute enrichment
    const result = await router.enrich({
      contactId,
      organizationId: contact.organization_id,
      input,
      enrichmentTypes: requestedTypes,
      preferredProviders: preferredProviders || (preferredProvider ? [preferredProvider] : undefined),
      strictPreferredProviders,
    });

    console.log(`Enrichment result for contact ${contactId}:`, JSON.stringify(result, null, 2));

    // Apply enriched data to contact if successful
    let appliedToContact = false;
    if (result.success && applyToContact) {
      const applied = await applyEnrichmentResult(supabase, {
        contactId,
        organizationId: contact.organization_id,
        existingContact: contact,
        provider: result.provider,
        enrichmentType: enrichmentTypes.join(','),
        data: result.data,
        creditsUsed: result.creditsUsed,
      });
      appliedToContact = applied.appliedToContact;
    }

    return new Response(
      JSON.stringify({
        success: result.success,
        provider: result.provider,
        creditsUsed: result.creditsUsed,
        data: result.data,
        appliedToContact,
        error: result.error,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Enrichment error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
