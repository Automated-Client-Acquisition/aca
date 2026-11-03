import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { resolvePresenterStages } from '../_shared/stages/definitions/presenter_video.ts';
import { resolveRemixStages } from '../_shared/stages/definitions/video_remix.ts';
import { resolveVideoStages } from '../_shared/stages/definitions/video.ts';
import { queueForPublish } from '../_shared/autopilot-publish.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Unified item status helpers — single source of truth for all pipelines.
// Items (scenes, clips, slides) can have these statuses:
//   ready/approved/completed/undefined → usable in next stage
//   excluded/failed/rejected           → skipped
//   generating                         → still in progress
const isItemUsable = (s: any) =>
  s.status === 'ready' || s.status === 'approved' || s.status === 'completed' || !s.status;
const isItemExcluded = (s: any) =>
  s.status === 'excluded' || s.status === 'failed' || s.status === 'rejected';
const isItemGenerating = (s: any) =>
  s.status === 'generating' || s.status === 'regenerating';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { output_id, stage_id, action, notes, is_automated, autopilot_id } = await req.json();

    if (!output_id || !stage_id || !action) {
      throw new Error('output_id, stage_id, and action are required');
    }

    if (!['approve', 'regenerate'].includes(action)) {
      throw new Error('action must be approve or regenerate');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth header from request
    const authHeader = req.headers.get('authorization');
    let userId = null;
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id;
    }

    console.log(`Processing ${action} for stage ${stage_id} on output ${output_id}`);

    // Fetch the output
    const { data: output, error: outputError } = await supabase
      .from('content_outputs')
      .select('*, content_generation_jobs!inner(*, blueprints(*))')
      .eq('id', output_id)
      .single();

    if (outputError || !output) {
      throw new Error(`Output not found: ${outputError?.message}`);
    }

    const pipeline = output.pipeline;
    const stageData = output.stage_data || {};

    // Record approval in stage_approvals table
    // Map action names to DB constraint values: approve -> approved, regenerate -> regenerated
    const dbAction = action === 'approve' ? 'approved' : action === 'regenerate' ? 'regenerated' : action;
    await supabase.from('stage_approvals').insert({
      output_id,
      stage_id,
      action: dbAction,
      user_id: userId,
      notes
    });

    if (action === 'approve') {
      // Validate stage has data before allowing approval
      const existingStageData = stageData[stage_id] || {};
      
      // Validation: stage must have been executed and have content
      if (!existingStageData || Object.keys(existingStageData).length === 0) {
        throw new Error(`Cannot approve ${stage_id} stage: Stage has not been executed yet. Please wait for the stage to complete before approving.`);
      }
      
      // Specific validation for clips stage - must have clips array
      if (stage_id === 'clips') {
        const clips = existingStageData.clips || [];
        if (!Array.isArray(clips) || clips.length === 0) {
          throw new Error('Cannot approve clips stage: No clips have been generated yet. Please wait for clip generation to complete.');
        }
      }
      
      // Specific validation for storyboard stage - must have scenes array OR single image
      if (stage_id === 'storyboard') {
        const scenes = existingStageData.scenes || [];
        const hasScenesArray = Array.isArray(scenes) && scenes.length > 0;
        const hasSingleImage = existingStageData.image_url || existingStageData.url;

        if (!hasScenesArray && !hasSingleImage) {
          throw new Error('Cannot approve storyboard stage: No images have been generated yet. Please wait for image generation to complete.');
        }
      }
      
      // Specific validation for scene_prompts stage - must have scenes array
      if (stage_id === 'scene_prompts') {
        const scenes = existingStageData.scenes || [];
        if (!Array.isArray(scenes) || scenes.length === 0) {
          throw new Error('Cannot approve scene_prompts stage: No scene prompts have been generated yet. Please wait for prompt generation to complete.');
        }
      }
      
      // Preserve all existing stage data and just add approval metadata
      const updatedStageData = {
        ...stageData,
        [stage_id]: {
          ...existingStageData, // Preserve scenes/clips arrays and all other data
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: userId
        }
      };

      await supabase
        .from('content_outputs')
        .update({ stage_data: updatedStageData })
        .eq('id', output_id);

      // Determine next stage
      const presenterConfig = output.generation_params?.video_config || output.content_generation_jobs?.configuration?.video_config || output.generation_params?.presenter_config || output.content_generation_jobs?.configuration?.presenter_config || output.generation_params?.remix_config || output.content_generation_jobs?.configuration?.remix_config;
      const storedPipelineStages = output.generation_params?.pipeline_stages;
      const skipImageGeneration = output.content_generation_jobs?.configuration?.skip_image_generation
        ?? output.content_generation_jobs?.blueprints?.skip_image_generation;
      let stages = getStagesForPipeline(pipeline, presenterConfig, storedPipelineStages);
      if (skipImageGeneration && pipeline === 'social_media_post') {
        stages = stages.filter((s: any) => s.id !== 'image_prompt' && s.id !== 'image');
      }
      const currentIndex = stages.findIndex((s: any) => s.id === stage_id);
      const nextStage = stages[currentIndex + 1];

      if (nextStage) {
        console.log(`Triggering next stage: ${nextStage.id}`);
        
        // Pre-execution validation for clips stage
        if (nextStage.id === 'clips') {
          // For generative_video_oneshot: check scene_prompts
          if (pipeline === 'generative_video_oneshot') {
            console.log('Validating scene prompts before world simulator clips generation');
            const scenePromptsData = updatedStageData.scene_prompts || {};
            const scenes = scenePromptsData.scenes || [];

            if (!scenes.length) {
              throw new Error('Cannot generate clips: No scene prompts found');
            }

            // Count scenes by status
            const readyScenes = scenes.filter(isItemUsable);
            const excludedOrFailedScenes = scenes.filter(isItemExcluded);
            const generatingScenes = scenes.filter(isItemGenerating);

            console.log(`Scene prompts status: ${readyScenes.length} ready, ${excludedOrFailedScenes.length} excluded/failed, ${generatingScenes.length} generating`);

            // Must have at least one ready scene prompt
            if (readyScenes.length === 0) {
              throw new Error('Cannot generate clips: All scene prompts are excluded or failed');
            }

            // Block if still generating
            if (generatingScenes.length > 0) {
              throw new Error(`Cannot generate clips: ${generatingScenes.length} scene prompts still generating`);
            }

            console.log(`Proceeding to clips generation with ${readyScenes.length} prompts`);
          }
        }

        // Pre-execution validation for final assembly stage
        if (nextStage.id === 'final') {
          // storyboard_video_longform uses Remotion composition (no clips stage)
          // — validate storyboard images instead of clips
          if (pipeline === 'storyboard_video_longform') {
            console.log('Validating storyboard scenes before Remotion composition');
            const storyboardData = updatedStageData.storyboard || {};
            const scenes = storyboardData.scenes || [];

            if (!scenes.length) {
              throw new Error('Cannot compose video: No storyboard scenes found');
            }

            const readyScenes = scenes.filter(isItemUsable);
            console.log(`Storyboard scenes: ${readyScenes.length} ready out of ${scenes.length} total`);

            if (readyScenes.length === 0) {
              throw new Error('Cannot compose video: All storyboard scenes are excluded or failed');
            }

            console.log(`Proceeding to Remotion composition with ${readyScenes.length} scenes`);
          } else {
            // Other pipelines (generative_video_oneshot, etc.) validate clips
            console.log('Validating clips before final assembly');

            const clipsData = updatedStageData.clips || {};
            const clips = clipsData.clips || [];

            if (!clips.length) {
              throw new Error('Cannot assemble video: No clips found');
            }

            const readyClips = clips.filter(isItemUsable);
            const excludedOrFailedClips = clips.filter(isItemExcluded);
            const generatingClips = clips.filter(isItemGenerating);

            console.log(`Clips status: ${readyClips.length} ready, ${excludedOrFailedClips.length} excluded/failed, ${generatingClips.length} generating`);

            if (readyClips.length === 0) {
              throw new Error('Cannot assemble video: All clips are excluded or failed');
            }

            if (generatingClips.length > 0) {
              throw new Error(`Cannot assemble video: ${generatingClips.length} clips still generating`);
            }

            console.log(`Proceeding to final assembly with ${readyClips.length} clips`);
          }
        }

        // Trigger next stage execution (always auto-generate) with error handling
        const { error: stageError } = await supabase.functions.invoke('execute-stage', {
          body: { output_id, stage_id: nextStage.id }
        });

        // 504 = the gateway gave up waiting, not that the stage failed: the
        // worker keeps running and writes its own result. Marking the output
        // failed here left a false "Failed to start stage" on runs that then
        // finished. A stage that really dies stays 'generating' and the
        // stuck-generation cron fails it after 30 minutes.
        const gatewayTimeout = (stageError as any)?.context?.status === 504;
        if (stageError && gatewayTimeout) {
          console.warn(`[approve-stage] execute-stage ${nextStage.id} for ${output_id} outlived the gateway timeout; leaving it running`);
        } else if (stageError) {
          // Read the actual error from execute-stage's response body
          let detailedError = stageError.message || 'Unknown error';
          try {
            if (stageError.context?.json) {
              const body = await stageError.context.json();
              detailedError = body?.error || detailedError;
            }
          } catch { /* response body may already be consumed */ }

          console.error(`[approve-stage] Failed to trigger next stage ${nextStage.id}: ${detailedError}`);

          // execute-stage already saves the real error to the DB before returning 500.
          // Check if it wrote a detailed error — if so, preserve it instead of overwriting.
          const { data: updatedOutput } = await supabase.from('content_outputs')
            .select('status, error_message')
            .eq('id', output_id)
            .single();

          const alreadyHasDetailedError = updatedOutput?.status === 'failed' && updatedOutput?.error_message;

          if (!alreadyHasDetailedError) {
            // execute-stage didn't save an error (e.g. crashed before DB write) — set a fallback
            await supabase.from('content_outputs')
              .update({
                status: 'failed',
                error_message: `Failed to start stage ${nextStage.id}: ${detailedError}`
              })
              .eq('id', output_id);
          }
          throw new Error(`Stage execution failed: ${updatedOutput?.error_message || detailedError}`);
        }
      } else {
        console.log('All stages complete - marking output as ready for review');

        // All stages complete
        await supabase
          .from('content_outputs')
          .update({
            status: 'review',
            current_stage: 'complete'
          })
          .eq('id', output_id);

        // Update job progress - sync from actual outputs to mark job as completed if all outputs are done
        const jobId = output.content_generation_jobs?.id;
        if (jobId) {
          console.log(`Syncing job progress for job ${jobId}`);
          const { error: syncError } = await supabase.rpc('sync_job_progress', { p_job_id: jobId });
          if (syncError) {
            console.error('Failed to sync job progress:', syncError);
          }
        }

        // Queue for publishing if this is an autopilot job
        const effectiveAutopilotId = autopilot_id || output.autopilot_id;
        const jobConfig = output.content_generation_jobs?.configuration as Record<string, any> | null;

        if (effectiveAutopilotId) {
          // Check if this is an evergreen regenerate job - queue to specific destination
          if (jobConfig?.is_evergreen_regenerate) {
            console.log(`🔄 [Evergreen Regenerate] Pipeline complete - queueing regenerated content: ${output_id}`);
            await queueEvergreenRegenerate(
              supabase,
              effectiveAutopilotId,
              output_id,
              jobId,
              jobConfig.target_account_id,
              jobConfig.target_platform,
              jobConfig.scheduled_for,
              jobConfig.source_publication_id
            );
          } else {
            console.log(`🤖 [Autopilot] Pipeline complete - queueing for publish: ${output_id}`);
            await queueForPublish(supabase, effectiveAutopilotId, output_id, jobId, jobConfig);
          }
        }

        // Update autopilot pool entry if this output was generated from the pool
        const poolEntryId = jobConfig?.pool_entry_id;
        if (poolEntryId) {
          // Check if hook rotation is active and hooks aren't exhausted
          const hookRotation = jobConfig?.hook_rotation;
          let skipProducedUpdate = false;

          if (hookRotation) {
            const { data: poolEntry } = await supabase
              .from('autopilot_idea_pools')
              .select('metadata, status')
              .eq('id', poolEntryId)
              .single();

            if (poolEntry?.status === 'available' && !poolEntry?.metadata?.hooks_exhausted) {
              skipProducedUpdate = true;
              console.log(`🔄 [Hook Rotation] Pool entry ${poolEntryId} stays available (hooks remaining)`);
            }
          }

          if (!skipProducedUpdate) {
            console.log(`📋 [Pool] Marking pool entry ${poolEntryId} as produced`);
            const { error: poolError } = await supabase
              .from('autopilot_idea_pools')
              .update({
                status: 'produced',
                produced_at: new Date().toISOString(),
                output_id: output_id,
                updated_at: new Date().toISOString()
              })
              .eq('id', poolEntryId);

            if (poolError) {
              console.error(`❌ [Pool] Failed to update pool entry:`, poolError.message);
            }
          }
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Stage approved',
          next_stage: nextStage?.id || null
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (action === 'regenerate') {
      // Clear previous stage data and re-execute
      const updatedStageData = {
        ...stageData,
        [stage_id]: {
          status: 'regenerating',
          regenerated_at: new Date().toISOString()
        }
      };

      await supabase
        .from('content_outputs')
        .update({ stage_data: updatedStageData })
        .eq('id', output_id);

      // Re-execute the same stage with error handling
      const { error: regenError } = await supabase.functions.invoke('execute-stage', {
        body: { output_id, stage_id }
      });

      if (regenError) {
        // Read the actual error from execute-stage's response body
        let regenDetailedError = regenError.message || 'Unknown error';
        try {
          if (regenError.context?.json) {
            const body = await regenError.context.json();
            regenDetailedError = body?.error || regenDetailedError;
          }
        } catch { /* response body may already be consumed */ }

        console.error(`[approve-stage] Failed to regenerate stage ${stage_id}: ${regenDetailedError}`);

        // Check if execute-stage already saved a detailed error
        const { data: regenOutput } = await supabase.from('content_outputs')
          .select('status, error_message')
          .eq('id', output_id)
          .single();

        const regenHasDetailedError = regenOutput?.status === 'failed' && regenOutput?.error_message;

        if (!regenHasDetailedError) {
          await supabase.from('content_outputs')
            .update({
              status: 'failed',
              error_message: `Stage regeneration failed: ${regenDetailedError}`
            })
            .eq('id', output_id);
        }
        const detailedMsg = regenOutput?.error_message || regenDetailedError;
        return new Response(
          JSON.stringify({
            success: false,
            message: `Regeneration failed: ${detailedMsg}`
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Stage regeneration started'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default fallback (shouldn't reach here)
    throw new Error('Invalid action');

  } catch (error) {
    console.error('Error approving stage:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Pipeline stage configurations — MUST match dispatch-generation-job/index.ts
const PIPELINE_STAGES: Record<string, any[]> = {
  ugc_video: [
    { id: 'script', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'voice', modelType: 'tts', inputFrom: ['script'] },
    { id: 'video', modelType: 'face_swap', inputFrom: ['script', 'voice'] },
    { id: 'final', modelType: 'assembly', inputFrom: ['video', 'voice'] }
  ],
  generative_video_oneshot: [
    { id: 'scene_prompts', modelType: 'text_llm', outputFormat: 'text_array' },
    { id: 'clips', modelType: 'world_simulator', inputFrom: ['scene_prompts'] },
    { id: 'final', modelType: 'assembly', inputFrom: ['clips'] }
  ],
  storyboard_video_longform: [
    { id: 'outline', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'full_voiceover', modelType: 'tts', inputFrom: ['outline'] },
    { id: 'scenes', modelType: 'text_llm', outputFormat: 'scene_array', inputFrom: ['outline', 'full_voiceover'] },
    { id: 'storyboard', modelType: 'image_generator', inputFrom: ['scenes'] },
    { id: 'final', modelType: 'assembly', inputFrom: ['storyboard', 'full_voiceover', 'scenes'] }
  ],
  instagram_carousel: [
    { id: 'caption', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'carousel_content', modelType: 'text_llm', outputFormat: 'text_array', inputFrom: ['caption'] },
    { id: 'carousel_slides', modelType: 'template_renderer', inputFrom: ['carousel_content'] },
  ],
  instagram_carousel_ai: [
    { id: 'caption', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'carousel_content', modelType: 'text_llm', outputFormat: 'text_array', inputFrom: ['caption'] },
    { id: 'carousel_slides', modelType: 'image_generator', inputFrom: ['carousel_content'] },
  ],
  social_media_post: [
    { id: 'caption', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'image_prompt', modelType: 'text_llm', outputFormat: 'text', inputFrom: ['caption'] },
    { id: 'image', modelType: 'image_generator', inputFrom: ['image_prompt'] }
  ],
  image_only: [
    { id: 'image', modelType: 'image_generator', outputFormat: 'url' }
  ],
  ugc_heygen: [
    { id: 'script', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'video', modelType: 'heygen_video', inputFrom: ['script'] }
  ],
  ugc_heygen_template: [
    { id: 'variables', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'video', modelType: 'heygen_template', inputFrom: ['variables'] }
  ],
  presenter_video: [
    { id: 'web_capture', modelType: 'assembly', outputFormat: 'urls' },
    { id: 'director', modelType: 'text_llm', outputFormat: 'text', inputFrom: ['web_capture'] },
    { id: 'voice_avatar', modelType: 'tts', inputFrom: ['director'] },
    { id: 'composition', modelType: 'assembly', inputFrom: ['web_capture', 'director', 'voice_avatar'] },
  ],
  video_remix: [
    { id: 'video_ingest', modelType: 'assembly', outputFormat: 'urls' },
    { id: 'transcribe', modelType: 'tts', inputFrom: ['video_ingest'] },
    { id: 'rewrite', modelType: 'text_llm', outputFormat: 'text', inputFrom: ['transcribe'] },
    { id: 'director', modelType: 'text_llm', outputFormat: 'text', inputFrom: ['video_ingest', 'rewrite', 'transcribe'] },
    { id: 'voice_avatar', modelType: 'tts', inputFrom: ['rewrite'] },
    { id: 'composition', modelType: 'assembly', inputFrom: ['video_ingest', 'director', 'voice_avatar'] },
  ],
  video: [
    // Default stages — dynamically resolved at runtime via resolveVideoStages()
    { id: 'outline', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'voiceover', modelType: 'tts', inputFrom: ['outline'] },
    { id: 'director', modelType: 'text_llm', outputFormat: 'text', inputFrom: ['outline', 'voiceover'] },
    { id: 'images', modelType: 'image_generator', inputFrom: ['director'] },
    { id: 'composition', modelType: 'assembly', inputFrom: ['director', 'voiceover', 'images'] },
  ],
  video_script: [
    { id: 'text', modelType: 'text_llm', outputFormat: 'text' },
  ],
  twitter_thread: [
    { id: 'thread_tweets', modelType: 'text_llm', outputFormat: 'thread_array' },
  ],
};

function getStagesForPipeline(pipeline: string, presenterConfig?: any, storedPipelineStages?: string[]): any[] {
  // Fast path: use stored pipeline_stages from dispatch (avoids re-resolution)
  if (storedPipelineStages?.length) {
    return storedPipelineStages.map((id, i) => ({
      id,
      modelType: id === 'director' ? 'text_llm' : 'assembly',
      ...(i > 0 ? { inputFrom: [storedPipelineStages[i - 1]] } : {}),
    }));
  }
  // For presenter_video, dynamically resolve stages from config
  if (pipeline === 'presenter_video' && presenterConfig) {
    const resolvedIds = resolvePresenterStages(presenterConfig);
    return resolvedIds.map((id, i) => ({
      id,
      modelType: id === 'director' ? 'text_llm' : 'assembly',
      ...(i > 0 ? { inputFrom: [resolvedIds[i - 1]] } : {}),
    }));
  }
  // For video_remix, dynamically resolve stages from remix config
  if (pipeline === 'video_remix' && presenterConfig) {
    const resolvedIds = resolveRemixStages(presenterConfig);
    return resolvedIds.map((id, i) => ({
      id,
      modelType: id === 'director' ? 'text_llm' : 'assembly',
      ...(i > 0 ? { inputFrom: [resolvedIds[i - 1]] } : {}),
    }));
  }
  // For unified video pipeline, dynamically resolve stages from video config
  if (pipeline === 'video' && presenterConfig) {
    const resolvedIds = resolveVideoStages(presenterConfig);
    return resolvedIds.map((id, i) => ({
      id,
      modelType: id === 'director' ? 'text_llm' : 'assembly',
      ...(i > 0 ? { inputFrom: [resolvedIds[i - 1]] } : {}),
    }));
  }
  return PIPELINE_STAGES[pipeline] || [];
}

// ============================================================================
// Autopilot Publishing Logic
// ============================================================================

/**
 * Queue regenerated evergreen content to a specific destination
 */
async function queueEvergreenRegenerate(
  supabase: any,
  autopilotId: string,
  outputId: string,
  jobId: string | null,
  accountId: string,
  platform: string,
  scheduledFor: string,
  sourcePublicationId: string
): Promise<void> {
  try {
    const { error: queueError } = await supabase.from('publish_queue').insert({
      autopilot_id: autopilotId,
      output_id: outputId,
      account_id: accountId,
      platform: platform || 'ghl',
      scheduled_for: scheduledFor,
      status: 'pending',
      is_repost: true,
      source_publication_id: sourcePublicationId,
      variation_mode: 'regenerate'
    });

    if (queueError) {
      console.error(`❌ [Evergreen Regenerate] Failed to queue:`, queueError);
      await logAutomation(supabase, autopilotId, outputId, jobId, 'evergreen_regenerate_queue_failed', null, {
        account_id: accountId,
        error: queueError.message
      });
    } else {
      console.log(`✅ [Evergreen Regenerate] Queued for ${accountId} at ${scheduledFor}`);
      await logAutomation(supabase, autopilotId, outputId, jobId, 'evergreen_regenerate_queued', null, {
        account_id: accountId,
        scheduled_for: scheduledFor,
        source_publication_id: sourcePublicationId
      });
    }
  } catch (error) {
    console.error(`❌ [Evergreen Regenerate] Queue error:`, error);
  }
}

/**
 * Log an automation event
 */
async function logAutomation(
  supabase: any,
  autopilotId: string,
  outputId: string | null,
  jobId: string | null,
  eventType: string,
  stageId: string | null,
  details: any
): Promise<void> {
  try {
    await supabase.from('automation_logs').insert({
      autopilot_id: autopilotId,
      output_id: outputId,
      job_id: jobId,
      event_type: eventType,
      stage_id: stageId,
      details
    });
  } catch (error) {
    console.error('Failed to log automation event:', error);
  }
}
