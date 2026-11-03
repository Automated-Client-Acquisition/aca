import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Complete Generation Job Edge Function
 * 
 * Called when all outputs in a job have completed all their stages.
 * Performs final validation, calculates final costs, and marks job as completed.
 * 
 * Input: { job_id: string }
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { job_id, organization_id } = await req.json();

    if (!job_id) {
      throw new Error('job_id is required');
    }

    console.log(`Completing generation job: ${job_id}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch job with all outputs
    const { data: job, error: jobError } = await supabase
      .from('content_generation_jobs')
      .select('*, content_outputs(*)')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobError?.message}`);
    }

    // verify_jwt=false: only internal callers or members of the job's org may complete it.
    try {
      await assertOrgAccess(req, supabase, job.organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // Validate org ownership if organization_id was provided (defense-in-depth)
    if (organization_id && job.organization_id !== organization_id) {
      throw new Error('Job does not belong to this organization');
    }

    const outputs = job.content_outputs || [];

    // Validate all outputs are in final state (review, approved, or rejected)
    const finalStates = ['review', 'approved', 'rejected'];
    const allComplete = outputs.every((output: any) => finalStates.includes(output.status));

    if (!allComplete) {
      throw new Error('Not all outputs are in final state. Cannot complete job.');
    }

    // Calculate final statistics
    const completedCount = outputs.filter((o: any) => o.status === 'review' || o.status === 'approved').length;
    const failedCount = outputs.filter((o: any) => o.status === 'rejected' || o.error_message).length;
    const approvedCount = outputs.filter((o: any) => o.status === 'approved').length;

    // Calculate total cost from all outputs
    const totalCost = outputs.reduce((sum: number, output: any) => {
      return sum + (output.generation_cost || 0);
    }, 0);

    // Calculate total generation time
    const totalGenerationTime = outputs.reduce((sum: number, output: any) => {
      return sum + (output.generation_duration_ms || 0);
    }, 0);

    // Determine final job status
    let finalStatus = 'completed';
    if (approvedCount === outputs.length) {
      finalStatus = 'completed'; // All approved
    } else if (completedCount > 0) {
      finalStatus = 'completed'; // At least some succeeded
    } else if (failedCount > 0 && completedCount === 0) {
      finalStatus = 'failed'; // All outputs rejected/errored with no successes
    }

    // Update job with final statistics
    const { error: updateError } = await supabase
      .from('content_generation_jobs')
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        // Clear any stale error message when job completes successfully
        error: finalStatus === 'completed' ? null : undefined,
        progress: {
          total: outputs.length,
          completed: completedCount,
          failed: failedCount,
          approved: approvedCount
        },
        cost: {
          estimated: job.cost?.estimated || 0,
          current: totalCost
        }
      })
      .eq('id', job_id);

    if (updateError) {
      throw new Error(`Failed to update job: ${updateError.message}`);
    }

    console.log(`Job ${job_id} completed successfully`);

    // Update autopilot pool entry if this job was triggered by an autopilot
    const configuration = job.configuration as Record<string, any> | null;
    const poolEntryId = configuration?.pool_entry_id;

    if (poolEntryId) {
      const firstOutputId = outputs.length > 0 ? outputs[0].id : null;

      // Check if hook rotation is active and hooks aren't exhausted yet
      // In that case, the pool entry was already set back to 'available' by createAutopilotJob
      const hookRotation = configuration?.hook_rotation;
      let skipProducedUpdate = false;

      if (hookRotation && finalStatus === 'completed') {
        const { data: poolEntry } = await supabase
          .from('autopilot_idea_pools')
          .select('metadata, status')
          .eq('id', poolEntryId)
          .single();

        if (poolEntry?.status === 'available' && !poolEntry?.metadata?.hooks_exhausted) {
          // More hooks remain — don't mark as produced, just record the output
          skipProducedUpdate = true;
          console.log(`🔄 [Hook Rotation] Pool entry ${poolEntryId} stays available (hooks remaining)`);
        }
      }

      if (!skipProducedUpdate) {
        const poolStatus = finalStatus === 'completed' ? 'produced' : 'failed';

        const { error: poolError } = await supabase
          .from('autopilot_idea_pools')
          .update({
            status: poolStatus,
            produced_at: poolStatus === 'produced' ? new Date().toISOString() : null,
            output_id: firstOutputId,
            error_message: poolStatus === 'failed' ? 'Job failed to complete' : null,
            updated_at: new Date().toISOString()
          })
          .eq('id', poolEntryId);

        if (poolError) {
          console.error(`Failed to update pool entry ${poolEntryId}:`, poolError.message);
          const { error: retryError } = await supabase
            .from('autopilot_idea_pools')
            .update({ status: poolStatus, updated_at: new Date().toISOString() })
            .eq('id', poolEntryId);
          if (retryError) {
            console.error(`Pool entry ${poolEntryId} retry also failed:`, retryError.message);
          }
        } else {
          console.log(`Pool entry ${poolEntryId} marked as ${poolStatus}`);
        }
      }
    }
    console.log(`Final stats: ${completedCount} completed, ${failedCount} failed, ${approvedCount} approved`);
    console.log(`Total cost: $${totalCost.toFixed(4)}, Time: ${(totalGenerationTime / 1000).toFixed(1)}s`);

    return new Response(
      JSON.stringify({
        success: true,
        job_id,
        status: finalStatus,
        stats: {
          total: outputs.length,
          completed: completedCount,
          failed: failedCount,
          approved: approvedCount,
          total_cost: totalCost,
          total_time_ms: totalGenerationTime
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Job completion error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during job completion',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
