/**
 * Process Enrichment Queue Edge Function
 *
 * Background job that processes pending enrichment requests from the queue.
 * Designed to be called by a cron job or manually triggered.
 *
 * Features:
 * - Processes batch of pending enrichment jobs
 * - Respects rate limits per provider
 * - Tracks credits used per organization
 * - Updates contact data with enriched information
 *
 * Endpoint: POST /process-enrichment-queue
 * Body: {
 *   batchSize?: number (default 10),
 *   maxCreditsPerRun?: number (default 50),
 *   organizationId?: string (optional filter)
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

import {
  EnrichmentRouter,
  ApolloAdapter,
  HunterAdapter,
  ProspeoAdapter,
  MoltsetsAdapter,
  QuickenrichAdapter,
  type EnrichmentProvider,
  type EnrichmentType,
  type EnrichmentInput,
} from '../_shared/enrichment/index.ts';
import { applyEnrichmentResult } from '../_shared/enrichment/write-back.ts';
import { checkMoltsetsQuota, MOLTSETS_PLAN_LIMITS, type MoltsetsPlanTier } from '../_shared/enrichment/moltsets.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EnrichmentJob {
  id: string;
  organization_id: string;
  contact_id: string;
  enrichment_type: string;
  provider: string | null;
  priority: number;
  status: string;
  attempts: number;
}

interface ProcessingResult {
  jobId: string;
  contactId: string;
  success: boolean;
  provider?: string;
  creditsUsed: number;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const {
      batchSize = 10,
      maxCreditsPerRun = 50,
      organizationId,
    } = await req.json().catch(() => ({}));

    console.log(`Processing enrichment queue: batchSize=${batchSize}, maxCredits=${maxCreditsPerRun}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch pending jobs
    let query = supabase
      .from('enrichment_jobs')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (organizationId) {
      query = query.eq('organization_id', organizationId);
    }

    const { data: jobs, error: jobsError } = await query;

    if (jobsError) {
      console.error('Error fetching jobs:', jobsError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch jobs' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!jobs || jobs.length === 0) {
      console.log('No pending enrichment jobs');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No pending jobs',
          processed: 0,
          creditsUsed: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${jobs.length} pending jobs`);

    // Group jobs by organization for efficient processing
    const jobsByOrg = new Map<string, EnrichmentJob[]>();
    for (const job of jobs as EnrichmentJob[]) {
      const orgJobs = jobsByOrg.get(job.organization_id) || [];
      orgJobs.push(job);
      jobsByOrg.set(job.organization_id, orgJobs);
    }

    // Process jobs
    const results: ProcessingResult[] = [];
    let totalCreditsUsed = 0;

    for (const [orgId, orgJobs] of jobsByOrg) {
      // Stop if we've used too many credits
      if (totalCreditsUsed >= maxCreditsPerRun) {
        console.log(`Credits limit reached (${totalCreditsUsed}/${maxCreditsPerRun}), stopping`);
        break;
      }

      // Get organization settings for provider priority order
      const { data: orgData } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', orgId)
        .single();

      const orgSettings = orgData?.settings as Record<string, unknown> | null;
      const enrichmentSettings = orgSettings?.enrichment as { providerPriority?: string[] } | undefined;
      const providerPriority = enrichmentSettings?.providerPriority || ['apollo', 'prospeo'];

      console.log(`Organization ${orgId} provider priority: ${providerPriority.join(' -> ')}`);

      // Get API keys for this organization
      const { data: apiKeys } = await supabase
        .from('api_keys')
        .select('provider, key_encrypted, is_valid, metadata')
        .eq('organization_id', orgId)
        .in('provider', ['apollo', 'hunter', 'clearbit', 'rocketreach', 'prospeo', 'moltsets', 'quickenrich'])
        .eq('is_valid', true);

      if (!apiKeys || apiKeys.length === 0) {
        // Mark jobs as skipped - no providers configured
        for (const job of orgJobs) {
          await updateJobStatus(supabase, job.id, 'skipped', {
            error_message: 'No enrichment providers configured',
          });
          results.push({
            jobId: job.id,
            contactId: job.contact_id,
            success: false,
            creditsUsed: 0,
            error: 'No enrichment providers configured',
          });
        }
        continue;
      }

      // Initialize router for this organization
      const router = new EnrichmentRouter(encryptionKey);
      router.registerAdapter(new ApolloAdapter());
      router.registerAdapter(new HunterAdapter());
      router.registerAdapter(new ProspeoAdapter());
      router.registerAdapter(new MoltsetsAdapter());
      router.registerAdapter(new QuickenrichAdapter());

      // Configure providers with priority based on user's configured order.
      // MoltSets is quota-capped (BYOK plan tier) — reserve one unit of its
      // shared daily budget up front per org per run; if exhausted, skip
      // registering it so the router falls through to other providers.
      for (const key of apiKeys) {
        const provider = key.provider as EnrichmentProvider;

        if (provider === 'moltsets') {
          const planTier = (key.metadata as { plan?: MoltsetsPlanTier } | null)?.plan;
          const limits = planTier ? MOLTSETS_PLAN_LIMITS[planTier] : undefined;
          if (!limits) continue;
          const granted = await checkMoltsetsQuota(supabase, orgId, limits.dailyCap);
          if (!granted) continue;
        }

        // Priority = position in providerPriority array (lower = higher priority)
        // Providers not in the array get high priority number (tried last)
        const priorityIndex = providerPriority.indexOf(provider);
        const priority = priorityIndex >= 0 ? priorityIndex + 1 : 100;

        router.configureProvider(provider, {
          apiKeyEncrypted: key.key_encrypted,
          isEnabled: true,
          priority,
        });
      }

      // Process each job
      for (const job of orgJobs) {
        if (totalCreditsUsed >= maxCreditsPerRun) break;

        const result = await processJob(supabase, router, job);
        results.push(result);
        totalCreditsUsed += result.creditsUsed;
      }
    }

    // Calculate summary
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    console.log(`Processing complete: ${successCount} succeeded, ${failedCount} failed, ${totalCreditsUsed} credits used`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        succeeded: successCount,
        failed: failedCount,
        creditsUsed: totalCreditsUsed,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Queue processing error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Process a single enrichment job
 */
async function processJob(
  supabase: SupabaseClient<any>,
  router: EnrichmentRouter,
  job: EnrichmentJob
): Promise<ProcessingResult> {
  console.log(`Processing job ${job.id} for contact ${job.contact_id}`);

  try {
    // Mark job as processing
    await updateJobStatus(supabase, job.id, 'processing');

    // Get contact data
    const { data: contact, error: contactError } = await supabase
      .from('crm_contacts')
      .select(`
        id,
        organization_id,
        display_name,
        first_name,
        last_name,
        company,
        primary_email,
        primary_phone,
        primary_linkedin_url,
        crm_contact_identities (
          channel,
          platform_user_id
        )
      `)
      .eq('id', job.contact_id)
      .single();

    if (contactError || !contact) {
      await updateJobStatus(supabase, job.id, 'failed', {
        error_message: 'Contact not found',
      });
      return {
        jobId: job.id,
        contactId: job.contact_id,
        success: false,
        creditsUsed: 0,
        error: 'Contact not found',
      };
    }

    // Build enrichment input
    const input: EnrichmentInput = {
      fullName: contact.display_name || undefined,
      firstName: contact.first_name || undefined,
      lastName: contact.last_name || undefined,
      companyName: contact.company || undefined,
      email: contact.primary_email || undefined,
      phone: contact.primary_phone || undefined,
    };

    // Get LinkedIn identity
    const linkedinIdentity = contact.crm_contact_identities?.find(
      (i: { channel: string; platform_user_id: string }) => i.channel === 'linkedin'
    );
    if (linkedinIdentity) {
      input.linkedinUrl = linkedinIdentity.platform_user_id;
    } else if (contact.primary_linkedin_url) {
      input.linkedinUrl = contact.primary_linkedin_url;
    }

    // Parse enrichment types
    const enrichmentTypes = job.enrichment_type.split(',') as EnrichmentType[];

    // Execute enrichment
    const result = await router.enrich({
      contactId: job.contact_id,
      organizationId: job.organization_id,
      input,
      enrichmentTypes,
      preferredProviders: job.provider ? [job.provider as EnrichmentProvider] : undefined,
    });

    if (!result.success) {
      // Check if we should retry
      const shouldRetry = result.error?.retryable && job.attempts < 3;

      await updateJobStatus(supabase, job.id, shouldRetry ? 'pending' : 'failed', {
        attempts: job.attempts + 1,
        error_message: result.error?.message,
        result: result.data,
      });

      return {
        jobId: job.id,
        contactId: job.contact_id,
        success: false,
        provider: result.provider,
        creditsUsed: result.creditsUsed,
        error: result.error?.message,
      };
    }

    // Apply enriched data to contact, add identities, and log history
    await applyEnrichmentResult(supabase, {
      contactId: job.contact_id,
      organizationId: job.organization_id,
      existingContact: contact,
      provider: result.provider,
      enrichmentType: job.enrichment_type,
      data: result.data,
      creditsUsed: result.creditsUsed,
    });

    // Mark job as completed
    await updateJobStatus(supabase, job.id, 'completed', {
      result: result.data,
      credits_used: result.creditsUsed,
    });

    return {
      jobId: job.id,
      contactId: job.contact_id,
      success: true,
      provider: result.provider,
      creditsUsed: result.creditsUsed,
    };
  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);

    await updateJobStatus(supabase, job.id, 'failed', {
      attempts: job.attempts + 1,
      error_message: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      jobId: job.id,
      contactId: job.contact_id,
      success: false,
      creditsUsed: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Update job status in database
 */
async function updateJobStatus(
  supabase: SupabaseClient<any>,
  jobId: string,
  status: string,
  additionalFields?: Record<string, unknown>
): Promise<void> {
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
    ...additionalFields,
  };

  await supabase
    .from('enrichment_jobs')
    .update(updates)
    .eq('id', jobId);
}

