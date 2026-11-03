import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Text-based stages that can be auto-retried (fast, stateless LLM calls)
const RETRYABLE_TEXT_STAGES = ['text', 'caption', 'outline', 'script', 'article'];
// Image stages that can be auto-retried for automated jobs (autopilot/auto_approve_all)
// These are stateless - just need the prompt from the previous approved stage
const RETRYABLE_IMAGE_STAGES = ['image', 'image_prompt'];
const MAX_AUTO_RETRIES = 2;

// Async stages that use Replicate webhooks and can be polled
const ASYNC_REPLICATE_STAGES = ['image', 'storyboard', 'carousel_slides', 'image_to_video', 'assembly'];

// Hard timeout for Replicate predictions - after this, mark as failed regardless
const HARD_TIMEOUT_MINUTES = 30;

async function decryptApiKey(encryptedKey: string): Promise<string> {
  const encryptionKeyHex = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKeyHex) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  const keyBytes = new Uint8Array(
    encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );

  const encryptedData = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));
  const iv = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Poll Replicate for a prediction's status and forward completed results
 * to the existing webhook handler, reusing all its completion logic.
 */
async function pollAndRecoverPrediction(
  supabaseUrl: string,
  supabaseKey: string,
  supabase: any,
  output: any,
  predictionInfo: any
): Promise<'recovered' | 'still_running' | 'failed' | 'error'> {
  const { prediction_id } = predictionInfo;
  if (!prediction_id) return 'error';

  try {
    // Get the Replicate API key for this org
    const { data: apiKeys } = await supabase
      .from('api_keys')
      .select('key_encrypted, provider')
      .eq('organization_id', output.organization_id)
      .eq('provider', 'replicate')
      .limit(1);

    if (!apiKeys || apiKeys.length === 0) {
      console.log(`[poll-replicate] No Replicate API key for org ${output.organization_id}`);
      return 'error';
    }

    const decryptedKey = await decryptApiKey(apiKeys[0].key_encrypted);

    // Poll Replicate API
    const response = await fetch(`https://api.replicate.com/v1/predictions/${prediction_id}`, {
      headers: { 'Authorization': `Bearer ${decryptedKey}` }
    });

    if (!response.ok) {
      console.error(`[poll-replicate] API error ${response.status} for prediction ${prediction_id}`);
      return 'error';
    }

    const prediction = await response.json();
    console.log(`[poll-replicate] Prediction ${prediction_id}: status=${prediction.status}`);

    if (prediction.status === 'succeeded') {
      // Forward to webhook handler - it has all the completion logic
      console.log(`[poll-replicate] Prediction ${prediction_id} succeeded! Forwarding to webhook handler`);

      const webhookPayload = {
        id: prediction_id,
        output: prediction.output,
        status: 'succeeded',
        error: null,
        metrics: prediction.metrics
      };

      const webhookResponse = await fetch(`${supabaseUrl}/functions/v1/generation-completion-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(webhookPayload),
      });

      if (webhookResponse.ok) {
        console.log(`[poll-replicate] Successfully recovered prediction ${prediction_id} via webhook`);
        return 'recovered';
      } else {
        const errorText = await webhookResponse.text();
        console.error(`[poll-replicate] Webhook handler failed for ${prediction_id}: ${errorText}`);
        return 'error';
      }
    } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
      console.log(`[poll-replicate] Prediction ${prediction_id} ${prediction.status}: ${prediction.error}`);
      // Forward failure to webhook handler too
      const webhookPayload = {
        id: prediction_id,
        output: null,
        status: prediction.status,
        error: prediction.error || `Prediction ${prediction.status}`,
        metrics: prediction.metrics
      };

      await fetch(`${supabaseUrl}/functions/v1/generation-completion-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(webhookPayload),
      }).catch(err => {
        console.error(`[poll-replicate] Failed to forward failure for ${prediction_id}:`, err);
      });

      return 'failed';
    } else {
      // Still processing/starting
      console.log(`[poll-replicate] Prediction ${prediction_id} still ${prediction.status}`);
      return 'still_running';
    }
  } catch (error) {
    console.error(`[poll-replicate] Error polling prediction ${prediction_id}:`, error);
    return 'error';
  }
}

/**
 * Reset Stuck Outputs
 *
 * Finds content_outputs stuck in 'generating' status for more than 10 minutes
 * and either:
 * 1. Polls Replicate to recover completed predictions (webhook fallback)
 * 2. Auto-retries text-based stages for automated jobs
 * 3. Resets to 'review' with error for manual retry
 *
 * Scheduled via pg_cron every 5 minutes.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  try {
    console.log('[reset-stuck-outputs] Starting stuck output check');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // Find all stuck outputs (generating for > 10 minutes)
    // Include generation_params, autopilot_id, and organization_id for polling + retry decisions
    const { data: stuckOutputs, error: fetchError } = await supabase
      .from('content_outputs')
      .select('id, job_id, current_stage, stage_data, pipeline, autopilot_id, generation_params, organization_id, error_message')
      .eq('status', 'generating')
      .lt('updated_at', tenMinutesAgo);

    if (fetchError) {
      console.error('[reset-stuck-outputs] Error fetching stuck outputs:', fetchError);
      throw fetchError;
    }

    if (!stuckOutputs || stuckOutputs.length === 0) {
      console.log('[reset-stuck-outputs] No stuck outputs found');
      return new Response(
        JSON.stringify({ success: true, reset_count: 0, retried_count: 0, recovered_count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[reset-stuck-outputs] Found ${stuckOutputs.length} stuck outputs`);

    const affectedJobIds = new Set<string>();
    let resetCount = 0;
    let retriedCount = 0;
    let recoveredCount = 0;
    let stillRunningCount = 0;

    for (const output of stuckOutputs) {
      const stageId = output.current_stage;
      const currentStageData = output.stage_data || {};
      const stageInfo = stageId ? currentStageData[stageId] : null;
      // Read retry count from generation_params — execute-stage overwrites stage_data
      // wholesale on each run, so a counter stored under stage_data[stageId] gets reset
      // to 0 every retry and MAX_AUTO_RETRIES never fires.
      const retryCount = output.generation_params?.image_retry_count ?? 0;

      // Check if this is an async Replicate stage with pending predictions
      const pendingPredictions = output.generation_params?.pending_predictions || [];
      const isAsyncStage = stageId && ASYNC_REPLICATE_STAGES.includes(stageId);
      const hasPendingPredictions = pendingPredictions.length > 0;

      if (isAsyncStage && hasPendingPredictions) {
        // Poll Replicate to check if predictions completed (webhook may have been lost)
        console.log(`[reset-stuck-outputs] Polling Replicate for output ${output.id} (${pendingPredictions.length} pending predictions)`);

        let allRecovered = true;
        let anyStillRunning = false;

        for (const pred of pendingPredictions) {
          const result = await pollAndRecoverPrediction(supabaseUrl, supabaseKey, supabase, output, pred);

          if (result === 'recovered') {
            console.log(`[reset-stuck-outputs] Recovered prediction ${pred.prediction_id} for output ${output.id}`);
          } else if (result === 'still_running') {
            anyStillRunning = true;
            allRecovered = false;
          } else {
            // failed or error - this prediction won't recover
            allRecovered = false;
          }
        }

        if (allRecovered) {
          recoveredCount++;
          console.log(`[reset-stuck-outputs] All predictions recovered for output ${output.id}`);
          continue; // Webhook handler took care of everything
        }

        if (anyStillRunning) {
          // Check hard timeout
          const createdAt = new Date(output.generation_params?.pending_predictions?.[0]?.started_at || 0).getTime();
          const hardTimeoutMs = HARD_TIMEOUT_MINUTES * 60 * 1000;
          const isHardTimeout = Date.now() - createdAt > hardTimeoutMs;

          if (!isHardTimeout) {
            stillRunningCount++;
            console.log(`[reset-stuck-outputs] Predictions still running for output ${output.id}, giving more time`);
            // Touch updated_at to prevent re-checking too soon
            await supabase
              .from('content_outputs')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', output.id);
            continue;
          }
          console.log(`[reset-stuck-outputs] Hard timeout (${HARD_TIMEOUT_MINUTES}min) reached for output ${output.id}`);
        }

        // Fall through to reset logic if predictions failed or hard timeout
      }

      // Determine if this output should be auto-retried
      // Text stages: always retryable for automated jobs
      // Image stages: retryable for automated jobs (autopilot or auto_approve_all)
      const isRetryableTextStage = stageId && RETRYABLE_TEXT_STAGES.includes(stageId);
      const isRetryableImageStage = stageId && RETRYABLE_IMAGE_STAGES.includes(stageId);
      const isAutomated = output.autopilot_id || output.generation_params?.auto_approve_all;
      const canRetry = (isRetryableTextStage || isRetryableImageStage) && isAutomated && retryCount < MAX_AUTO_RETRIES;

      if (canRetry) {
        // Auto-retry: bump retry count in generation_params (which execute-stage
        // preserves) and re-invoke execute-stage.
        const { error: updateError } = await supabase
          .from('content_outputs')
          .update({
            generation_params: {
              ...output.generation_params,
              image_retry_count: retryCount + 1,
              last_image_retry_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', output.id);

        if (updateError) {
          console.error(`[reset-stuck-outputs] Failed to update output ${output.id} for retry:`, updateError);
          continue;
        }

        // Fire-and-forget: re-invoke execute-stage
        fetch(`${supabaseUrl}/functions/v1/execute-stage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            output_id: output.id,
            stage_id: stageId,
          }),
        }).catch(err => {
          console.error(`[reset-stuck-outputs] Failed to invoke execute-stage for ${output.id}:`, err);
        });

        retriedCount++;
        console.log(`[reset-stuck-outputs] Auto-retry #${retryCount + 1} for output ${output.id} (${output.pipeline}/${stageId})`);
      } else {
        // No retry: reset to review with error message.
        //
        // Preserve any real error already on the row (e.g. an OpenRouter 402
        // that execute-stage's catch wrote before we got here). Without this
        // guard, we used to clobber "OpenRouter: insufficient credits" with
        // a generic "Auto-reset: Stage timed out" and the user lost the
        // actionable signal.
        const existingStageError = stageInfo?.error;
        const existingErrorMessage = output.error_message;
        const fallbackStageError = retryCount >= MAX_AUTO_RETRIES
          ? `Stage timed out after ${MAX_AUTO_RETRIES} auto-retries`
          : 'Stage timed out after 10 minutes';
        const fallbackErrorMessage = retryCount >= MAX_AUTO_RETRIES
          ? `Auto-reset: Stage timed out after ${MAX_AUTO_RETRIES} auto-retries. You can retry manually.`
          : 'Auto-reset: Stage timed out after 10 minutes. You can retry individual stages.';

        const updatedStageData = {
          ...currentStageData,
          ...(stageId ? {
            [stageId]: {
              ...stageInfo,
              status: 'failed',
              error: existingStageError || fallbackStageError,
              failed_at: new Date().toISOString(),
            }
          } : {}),
        };

        const { error: updateError } = await supabase
          .from('content_outputs')
          .update({
            status: 'review',
            error_message: existingErrorMessage && existingErrorMessage.trim().length > 0
              ? existingErrorMessage
              : fallbackErrorMessage,
            stage_data: updatedStageData,
            updated_at: new Date().toISOString(),
          })
          .eq('id', output.id);

        if (updateError) {
          console.error(`[reset-stuck-outputs] Failed to reset output ${output.id}:`, updateError);
          continue;
        }

        resetCount++;
        console.log(`[reset-stuck-outputs] Reset output ${output.id} (${output.pipeline}/${stageId})`);

        if (output.job_id) {
          affectedJobIds.add(output.job_id);
        }
      }
    }

    // Complete parent jobs where all outputs are now in a final state
    // (only for reset outputs - retried outputs stay in 'generating')
    let completedJobCount = 0;
    for (const jobId of affectedJobIds) {
      const { data: pendingOutputs } = await supabase
        .from('content_outputs')
        .select('id')
        .eq('job_id', jobId)
        .in('status', ['generating', 'pending'])
        .limit(1);

      if (pendingOutputs && pendingOutputs.length > 0) {
        continue;
      }

      const { error: jobUpdateError } = await supabase
        .from('content_generation_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('status', 'processing');

      if (jobUpdateError) {
        console.error(`[reset-stuck-outputs] Failed to complete job ${jobId}:`, jobUpdateError);
      } else {
        completedJobCount++;
        console.log(`[reset-stuck-outputs] Completed job ${jobId}`);
      }
    }

    console.log(`[reset-stuck-outputs] Done. Reset ${resetCount}, retried ${retriedCount}, recovered ${recoveredCount}, still running ${stillRunningCount}, completed ${completedJobCount} jobs`);

    return new Response(
      JSON.stringify({
        success: true,
        reset_count: resetCount,
        retried_count: retriedCount,
        recovered_count: recoveredCount,
        still_running_count: stillRunningCount,
        completed_jobs: completedJobCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[reset-stuck-outputs] Error:', message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
