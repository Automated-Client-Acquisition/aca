/**
 * Process Company Analysis Job Edge Function — THIN TRIGGER
 *
 * Validates the job, marks it as running, then delegates to the
 * Fly.io company-analyzer worker for actual processing.
 * The worker has no timeout limits and can handle jobs of any size.
 *
 * Endpoint: POST /process-company-analysis-job
 * Body: { jobId: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { flyWorkerAuthHeaders } from '../_shared/fly-worker-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const workerUrl = Deno.env.get('COMPANY_ANALYZER_URL'); // e.g. https://aca-company-analyzer.fly.dev
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
      .from('company_analysis_jobs')
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
      .from('company_analysis_jobs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    console.log(`Job ${jobId}: marked as running, delegating to worker`);

    // Delegate to Fly.io worker
    // The worker keeps the connection open for the entire job (SSE stream).
    // We only need to confirm it accepted — abort after 30s to avoid hitting
    // Supabase's 150s edge function timeout.
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
              .from('company_analysis_jobs')
              .update({ status: 'pending', started_at: null })
              .eq('id', jobId);
            return new Response(
              JSON.stringify({ success: false, error: 'Analysis worker is busy. Your job is queued and will start automatically.' }),
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
          // Mark job as failed so it can be retried
          await supabase
            .from('company_analysis_jobs')
            .update({
              status: 'failed',
              error_message: `Failed to reach analysis worker: ${workerError instanceof Error ? workerError.message : 'Unknown error'}. Please try again.`,
              completed_at: new Date().toISOString(),
            })
            .eq('id', jobId);

          return new Response(
            JSON.stringify({ success: false, error: 'Failed to reach analysis worker' }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    } else {
      // No worker configured — fall back to self-processing (legacy, for development)
      console.warn(`COMPANY_ANALYZER_URL not set, job ${jobId} will not be processed. Deploy the worker.`);
      await supabase
        .from('company_analysis_jobs')
        .update({
          status: 'failed',
          error_message: 'Company analyzer worker not configured. Set COMPANY_ANALYZER_URL.',
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
