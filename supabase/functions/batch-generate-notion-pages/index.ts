/**
 * Batch Generate Notion Pages Edge Function — THIN TRIGGER
 *
 * Validates the job, marks it as running, then delegates to the
 * Fly.io notion-generator worker for actual processing.
 * The worker has no timeout limits and can handle jobs of any size.
 *
 * Endpoint: POST /batch-generate-notion-pages
 * Body: { jobId: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { flyWorkerAuthHeaders } from '../_shared/fly-worker-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const workerUrl = Deno.env.get('NOTION_GENERATOR_WORKER_URL'); // e.g. https://aca-notion-generator.fly.dev
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { jobId } = body;

    if (!jobId) {
      return new Response(
        JSON.stringify({ success: false, error: 'jobId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the job record
    const { data: job, error: jobError } = await supabase
      .from('email_sequence_jobs')
      .select('id, status, organization_id')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ success: false, error: 'Job not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, job.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    if (job.status !== 'pending') {
      return new Response(
        JSON.stringify({ success: false, error: `Job is not pending (status: ${job.status})` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark job as running
    await supabase
      .from('email_sequence_jobs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    console.log(`Job ${jobId}: marked as running, delegating to worker`);

    // Delegate to Fly.io worker
    if (workerUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);

        const workerResponse = await fetch(`${workerUrl}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await flyWorkerAuthHeaders()) },
          body: JSON.stringify({ jobId }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!workerResponse.ok) {
          const errorText = await workerResponse.text();
          console.error(`Worker returned ${workerResponse.status}: ${errorText}`);

          // Worker at capacity — revert to pending so it can be picked up later
          if (workerResponse.status === 503) {
            await supabase
              .from('email_sequence_jobs')
              .update({ status: 'pending', started_at: null })
              .eq('id', jobId);
            return new Response(
              JSON.stringify({ success: false, error: 'Worker is busy. Your job is queued and will start automatically.' }),
              { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          throw new Error(`Worker returned ${workerResponse.status}`);
        }

        // Read just the first SSE event to confirm acceptance, then disconnect
        const reader = workerResponse.body?.getReader();
        if (reader) {
          const { value } = await reader.read();
          const text = new TextDecoder().decode(value);
          console.log(`Job ${jobId}: worker responded: ${text.trim()}`);
          reader.cancel();
        }

        console.log(`Job ${jobId}: worker accepted`);
      } catch (workerError) {
        // AbortError means we disconnected after the worker started (expected)
        if (workerError instanceof DOMException && workerError.name === 'AbortError') {
          console.log(`Job ${jobId}: worker connection timed out (expected — worker is processing)`);
        } else {
          console.error(`Failed to reach worker for job ${jobId}:`, workerError);
          await supabase
            .from('email_sequence_jobs')
            .update({
              status: 'failed',
              error_message: `Failed to reach Notion generator worker: ${workerError instanceof Error ? workerError.message : 'Unknown error'}. Please try again.`,
              completed_at: new Date().toISOString(),
            })
            .eq('id', jobId);

          return new Response(
            JSON.stringify({ success: false, error: 'Failed to reach Notion generator worker' }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    } else {
      // No worker configured
      console.warn(`NOTION_GENERATOR_WORKER_URL not set, job ${jobId} will not be processed. Deploy the worker.`);
      await supabase
        .from('email_sequence_jobs')
        .update({
          status: 'failed',
          error_message: 'Notion generator worker not configured. Set NOTION_GENERATOR_WORKER_URL.',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      return new Response(
        JSON.stringify({ success: false, error: 'Worker not configured' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, jobId, delegated: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing job:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
