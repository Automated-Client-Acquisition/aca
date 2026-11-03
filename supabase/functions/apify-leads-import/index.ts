import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey, startApifyRun, type BatchInfo, type SearchConfig } from '../_shared/apify-leads-utils.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * apify-leads-import: Start-only edge function.
 *
 * Starts batch 0 of an Apify Leads Finder import and returns immediately.
 * An ad-hoc webhook on the Apify run calls apify-leads-webhook when
 * the run completes, which processes results and chains subsequent batches.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let jobId: string | undefined;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    if (!supabaseUrl || !supabaseKey || !encryptionKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    jobId = body.jobId;

    if (!jobId) {
      throw new Error('jobId is required');
    }

    console.log(`[Apify Leads Import] Starting job ${jobId}`);

    // Fetch job
    const { data: job, error: jobError } = await supabase
      .from('apify_leads_import_jobs')
      .select('*, target_list:lead_lists(*)')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobError?.message || 'Not found'}`);
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, job.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    if (job.status === 'cancelled') {
      console.log(`[Apify Leads Import] Job ${jobId} was cancelled`);
      return new Response(JSON.stringify({ success: false, reason: 'cancelled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get Apify API key
    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', job.organization_id)
      .eq('provider', 'apify')
      .eq('is_valid', true)
      .single();

    if (keyError || !apiKey) {
      throw new Error('Apify API key not found. Please add your Apify API key in Settings.');
    }

    const apifyToken = await decryptApiKey(apiKey.key_encrypted, encryptionKey);

    // Calculate batches
    const searchConfig = job.search_config as SearchConfig;
    const totalRequested = job.total_requested;
    const batchSize = job.batch_size || 2500;
    const totalBatches = Math.ceil(totalRequested / batchSize);
    const batchFetchCount = Math.min(batchSize, totalRequested);

    // Build webhook URL for Apify to call when the run completes
    const webhookUrl = `${supabaseUrl}/functions/v1/apify-leads-webhook?jobId=${jobId}&batchIndex=0`;

    // Start batch 0
    const { runId, datasetId } = await startApifyRun(apifyToken, searchConfig, batchFetchCount, webhookUrl);

    // Build initial batch info
    const batches: BatchInfo[] = Array.from({ length: totalBatches }, (_, i) => ({
      batch_index: i,
      apify_run_id: i === 0 ? runId : null,
      dataset_id: i === 0 ? datasetId : null,
      status: i === 0 ? 'running' as const : 'pending' as const,
      leads_found: 0,
      leads_imported: 0,
      leads_skipped: 0,
    }));

    // Mark job as running
    await supabase
      .from('apify_leads_import_jobs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        total_batches: totalBatches,
        current_batch: 0,
        estimated_cost_usd: (totalRequested / 1000) * 1.5,
        batches,
      })
      .eq('id', jobId);

    console.log(`[Apify Leads Import] Job ${jobId} started: batch 0 run=${runId}, ${totalBatches} total batches. Webhook will handle completion.`);

    return new Response(JSON.stringify({
      success: true,
      runId,
      totalBatches,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Apify Leads Import] Fatal error:', error);

    // Try to mark job as failed
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        if (jobId) {
          await supabase
            .from('apify_leads_import_jobs')
            .update({
              status: 'failed',
              error_message: error instanceof Error ? error.message : 'Unknown error',
              completed_at: new Date().toISOString(),
            })
            .eq('id', jobId);
        }
      }
    } catch {
      // Ignore
    }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
