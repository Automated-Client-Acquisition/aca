import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey, type BatchInfo } from '../_shared/apify-leads-utils.ts';
import { ingestBatchDataset, failBatch, handleBatchComplete } from '../_shared/apify-leads-ingest.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * apify-leads-webhook: Called by Apify ad-hoc webhook when a batch run completes.
 *
 * Receives the Apify webhook payload, fetches dataset results, processes leads,
 * and chains the next batch if needed.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Parse job context from query params BEFORE try block so catch can use them for recovery
  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId');
  const batchIndexStr = url.searchParams.get('batchIndex');
  const batchIndex = batchIndexStr !== null ? parseInt(batchIndexStr, 10) : -1;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    if (!supabaseUrl || !supabaseKey || !encryptionKey) {
      throw new Error('Missing required environment variables');
    }

    if (!jobId || batchIndexStr === null) {
      throw new Error('Missing jobId or batchIndex query parameters');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse Apify webhook payload
    const payload = await req.json();
    const runId = payload.eventData?.actorRunId;
    const datasetId = payload.eventData?.datasetId || payload.resource?.defaultDatasetId;
    const status = payload.resource?.status;

    console.log(`[Apify Leads Webhook] Job ${jobId}, batch ${batchIndex}: run=${runId}, status=${status}`);

    if (!runId) {
      throw new Error('Missing actorRunId in webhook payload');
    }

    // Fetch the job
    const { data: job, error: jobError } = await supabase
      .from('apify_leads_import_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobError?.message || 'Not found'}`);
    }

    // If job was cancelled while Apify was running, just bail
    if (job.status === 'cancelled') {
      console.log(`[Apify Leads Webhook] Job ${jobId} was cancelled, ignoring webhook`);
      return new Response(JSON.stringify({ success: false, reason: 'cancelled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Idempotency: if job is already in a terminal state, ack and bail so Apify
    // stops retrying. Same for an individual batch that's already succeeded —
    // re-processing the dataset would just churn duplicates.
    if (job.status === 'completed' || job.status === 'failed') {
      console.log(`[Apify Leads Webhook] Job ${jobId} already ${job.status}, ignoring retry`);
      return new Response(JSON.stringify({ success: true, reason: 'already_terminal' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const batches: BatchInfo[] = job.batches || [];
    const batch = batches[batchIndex];

    if (!batch) {
      throw new Error(`Batch ${batchIndex} not found in job`);
    }

    if (batch.status === 'succeeded' || batch.status === 'failed') {
      console.log(`[Apify Leads Webhook] Batch ${batchIndex} already ${batch.status}, ignoring retry`);
      return new Response(JSON.stringify({ success: true, reason: 'batch_already_terminal' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update batch with dataset_id from webhook if not already set
    if (datasetId) {
      batch.dataset_id = datasetId;
    }

    if (status === 'FAILED') {
      // Handle failed run
      const errorMessage = payload.resource?.statusMessage
        || payload.resource?.errorMessage
        || 'Apify actor run failed';

      // Mark the batch failed and continue (chain next batch or finalize).
      await failBatch(supabase, {
        job,
        batches,
        batchIndex,
        errorMessage,
        apifyToken: null,
        supabaseUrl,
        encryptionKey,
      });

      return new Response(JSON.stringify({ success: true, status: 'batch_failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (status !== 'SUCCEEDED') {
      console.log(`[Apify Leads Webhook] Ignoring non-terminal status: ${status}`);
      return new Response(JSON.stringify({ success: true, status: 'ignored' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- SUCCEEDED: fetch and process leads ---

    // Get Apify API key for dataset access
    const { data: apiKey } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', job.organization_id)
      .eq('provider', 'apify')
      .eq('is_valid', true)
      .single();

    if (!apiKey) {
      throw new Error('Apify API key not found');
    }

    const apifyToken = await decryptApiKey(apiKey.key_encrypted, encryptionKey);

    // Fetch dataset, process leads, mark batch succeeded, and chain the next
    // batch — all via the shared module so the poller fallback runs identically.
    const { imported, skipped, found } = await ingestBatchDataset(supabase, {
      job,
      batches,
      batchIndex,
      datasetId,
      apifyToken,
      supabaseUrl,
      encryptionKey,
    });

    return new Response(JSON.stringify({
      success: true,
      batchImported: imported,
      batchSkipped: skipped,
      leadsFound: found,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Apify Leads Webhook] Error:', error);

    // Attempt to mark the batch as failed so the job doesn't stay stuck
    if (jobId && batchIndex >= 0) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey);
          const { data: job } = await supabase
            .from('apify_leads_import_jobs')
            .select('*')
            .eq('id', jobId)
            .single();

          if (job && job.status === 'running') {
            const batches: BatchInfo[] = job.batches || [];
            if (batches[batchIndex]) {
              batches[batchIndex].status = 'failed';
              batches[batchIndex].error = error instanceof Error ? error.message : 'Webhook handler crashed';
              await handleBatchComplete(supabase, job, batches, batchIndex, null, supabaseUrl!, null);
            }
          }
        }
      } catch (recoveryErr) {
        console.error('[Apify Leads Webhook] Recovery also failed:', recoveryErr);
      }
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
