import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Pipeline stage definitions
const PIPELINE_STAGES: Record<string, Array<{ id: string; modelType: string }>> = {
  social_media_post: [
    { id: 'caption', modelType: 'text_llm' },
    { id: 'image_prompt', modelType: 'text_llm' },
    { id: 'image', modelType: 'image_generator' }
  ],
  rich_article: [
    { id: 'text', modelType: 'text_llm' },
    { id: 'image', modelType: 'image_generator' }
  ],
  video_script: [
    { id: 'text', modelType: 'text_llm' }
  ],
  instagram_carousel: [
    { id: 'caption', modelType: 'text_llm' },
    { id: 'carousel_content', modelType: 'text_llm' },
    { id: 'carousel_slides', modelType: 'template_renderer' },
  ],
  ugc_video: [
    { id: 'script', modelType: 'text_llm' },
    { id: 'voice', modelType: 'tts' },
    { id: 'video', modelType: 'face_swap' },
    { id: 'final', modelType: 'assembly' }
  ],
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  // No app or function calls this; it runs generation jobs in any org, so operators only (service-role key).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const { action = 'start' } = body;

    // ACTION: start - Create and dispatch a test job
    if (action === 'start') {
      const {
        pipeline = 'social_media_post',
        blueprint_id,
        test_prompt = 'Write a short engaging social media post about the benefits of morning routines. Include 3 hashtags.'
      } = body;

      // Find blueprint
      let blueprintId = blueprint_id;
      if (!blueprintId) {
        const { data: blueprints } = await supabase
          .from('blueprints')
          .select('id, name, pipeline, organization_id, created_by, model_config')
          .eq('pipeline', pipeline)
          .limit(1);

        if (!blueprints || blueprints.length === 0) {
          throw new Error(`No blueprint found for pipeline: ${pipeline}`);
        }
        blueprintId = blueprints[0].id;
      }

      const { data: blueprint } = await supabase
        .from('blueprints')
        .select('*')
        .eq('id', blueprintId)
        .single();

      if (!blueprint) {
        throw new Error('Blueprint not found');
      }

      // Create a real content_idea record (required for FK constraint)
      const { data: idea, error: ideaError } = await supabase
        .from('content_ideas')
        .insert({
          organization_id: blueprint.organization_id,
          title: `Pipeline Test - ${pipeline} - ${new Date().toISOString()}`,
          metadata: { test: true, pipeline }
        })
        .select()
        .single();

      if (ideaError) throw new Error(`Failed to create test idea: ${ideaError.message}`);

      // Create job
      const { data: job, error: jobError } = await supabase
        .from('content_generation_jobs')
        .insert({
          organization_id: blueprint.organization_id,
          user_id: blueprint.created_by,
          blueprint_id: blueprintId,
          pipeline,
          status: 'queued',
          items: [{
            idea_id: idea.id,
            idea_title: idea.title,
            slot_values: {
              idea: test_prompt,
              context: test_prompt,
              title: `Test ${pipeline}`
            },
            library_elements: {}
          }],
          configuration: {
            pipeline,
            blueprint_name: blueprint.name,
            model_config: blueprint.model_config || {}
          },
          progress: { total: 1, completed: 0, failed: 0 }
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Dispatch
      const { error: dispatchError } = await supabase.functions.invoke('dispatch-generation-job', {
        body: { job_id: job.id }
      });

      if (dispatchError) throw dispatchError;

      return new Response(JSON.stringify({
        action: 'started',
        job_id: job.id,
        pipeline,
        blueprint: blueprint.name,
        message: `Job created and dispatched. Use action='status' with job_id to check progress.`,
        stages: PIPELINE_STAGES[pipeline]?.map(s => s.id) || []
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ACTION: status - Check job/output status
    if (action === 'status') {
      const { job_id } = body;
      if (!job_id) throw new Error('job_id required for status action');

      const { data: job } = await supabase
        .from('content_generation_jobs')
        .select('*')
        .eq('id', job_id)
        .single();

      const { data: outputs } = await supabase
        .from('content_outputs')
        .select('id, status, current_stage, stage_data, created_at')
        .eq('job_id', job_id);

      const output = outputs?.[0];
      const stageDataSummary: Record<string, any> = {};

      if (output?.stage_data) {
        for (const [stageId, data] of Object.entries(output.stage_data as Record<string, any>)) {
          stageDataSummary[stageId] = {
            status: data.status,
            has_content: !!data.content,
            content_preview: data.content?.substring(0, 100),
            has_image: !!data.image_url,
            scenes_count: data.scenes?.length,
            clips_count: data.clips?.length
          };
        }
      }

      return new Response(JSON.stringify({
        job: {
          id: job?.id,
          status: job?.status,
          pipeline: job?.pipeline,
          progress: job?.progress,
          error: job?.error
        },
        output: output ? {
          id: output.id,
          status: output.status,
          current_stage: output.current_stage,
          stages: stageDataSummary
        } : null
      }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ACTION: approve - Auto-approve a stage
    if (action === 'approve') {
      const { output_id, stage_id } = body;
      if (!output_id || !stage_id) throw new Error('output_id and stage_id required');

      // Get output to determine pipeline
      const { data: output } = await supabase
        .from('content_outputs')
        .select('pipeline')
        .eq('id', output_id)
        .single();

      const approveAction = (output?.pipeline === 'social_media_post' && stage_id === 'image_prompt')
        ? 'approve_and_generate'
        : 'approve';

      const { data, error } = await supabase.functions.invoke('approve-stage', {
        body: { output_id, stage_id, action: approveAction, notes: 'Auto-approved by test-pipeline' }
      });

      if (error) throw error;

      return new Response(JSON.stringify({
        action: 'approved',
        output_id,
        stage_id,
        approve_action: approveAction,
        result: data
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ACTION: auto-run - Start job and auto-approve all stages (runs in background)
    if (action === 'auto-run') {
      const {
        pipeline = 'social_media_post',
        blueprint_id,
        test_prompt = 'Write a short engaging social media post about the benefits of morning routines. Include 3 hashtags.',
        skip_image = false
      } = body;

      // Find blueprint
      let blueprintId = blueprint_id;
      if (!blueprintId) {
        const { data: blueprints } = await supabase
          .from('blueprints')
          .select('*')
          .eq('pipeline', pipeline)
          .limit(1);

        if (!blueprints || blueprints.length === 0) {
          throw new Error(`No blueprint found for pipeline: ${pipeline}`);
        }
        blueprintId = blueprints[0].id;
      }

      const { data: blueprint } = await supabase
        .from('blueprints')
        .select('*')
        .eq('id', blueprintId)
        .single();

      if (!blueprint) throw new Error('Blueprint not found');

      // Create a real content_idea record (required for FK constraint)
      const { data: idea, error: ideaError } = await supabase
        .from('content_ideas')
        .insert({
          organization_id: blueprint.organization_id,
          title: `Auto-Test - ${pipeline} - ${new Date().toISOString()}`,
          metadata: { test: true, pipeline, auto_run: true }
        })
        .select()
        .single();

      if (ideaError) throw new Error(`Failed to create test idea: ${ideaError.message}`);

      // Create and dispatch job
      const { data: job, error: jobError } = await supabase
        .from('content_generation_jobs')
        .insert({
          organization_id: blueprint.organization_id,
          user_id: blueprint.created_by,
          blueprint_id: blueprintId,
          pipeline,
          status: 'queued',
          items: [{
            idea_id: idea.id,
            idea_title: idea.title,
            slot_values: { idea: test_prompt, context: test_prompt },
            library_elements: {}
          }],
          configuration: {
            pipeline,
            blueprint_name: blueprint.name,
            model_config: blueprint.model_config || {}
          },
          progress: { total: 1, completed: 0, failed: 0 }
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Dispatch
      await supabase.functions.invoke('dispatch-generation-job', {
        body: { job_id: job.id }
      });

      // Start background auto-approval loop
      const stages = PIPELINE_STAGES[pipeline] || [];
      const autoApprovePromise = runAutoApproval(supabase, job.id, stages, skip_image);

      // Use waitUntil if available
      if ((globalThis as any).EdgeRuntime?.waitUntil) {
        (globalThis as any).EdgeRuntime.waitUntil(autoApprovePromise);
      }

      return new Response(JSON.stringify({
        action: 'auto-run-started',
        job_id: job.id,
        pipeline,
        stages: stages.map(s => s.id),
        message: 'Job dispatched. Auto-approval running in background. Check status with action=status'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ACTION: start-direct - Create output directly and trigger first stage (bypasses dispatch-generation-job)
    if (action === 'start-direct') {
      const {
        pipeline = 'social_media_post',
        blueprint_id,
        test_prompt = 'Write a short engaging social media post about the benefits of morning routines. Include 3 hashtags.'
      } = body;

      // Find blueprint
      let blueprintId = blueprint_id;
      if (!blueprintId) {
        const { data: blueprints } = await supabase
          .from('blueprints')
          .select('*')
          .eq('pipeline', pipeline)
          .limit(1);

        if (!blueprints || blueprints.length === 0) {
          throw new Error(`No blueprint found for pipeline: ${pipeline}`);
        }
        blueprintId = blueprints[0].id;
      }

      const { data: blueprint } = await supabase
        .from('blueprints')
        .select('*')
        .eq('id', blueprintId)
        .single();

      if (!blueprint) throw new Error('Blueprint not found');

      // Create a real content_idea record (required for FK constraint)
      const { data: idea, error: ideaError } = await supabase
        .from('content_ideas')
        .insert({
          organization_id: blueprint.organization_id,
          title: `Direct Test - ${pipeline} - ${new Date().toISOString()}`,
          metadata: { test: true, pipeline, direct: true }
        })
        .select()
        .single();

      if (ideaError) throw new Error(`Failed to create test idea: ${ideaError.message}`);

      // Create job directly
      const { data: job, error: jobError } = await supabase
        .from('content_generation_jobs')
        .insert({
          organization_id: blueprint.organization_id,
          user_id: blueprint.created_by,
          blueprint_id: blueprintId,
          pipeline,
          status: 'processing',
          started_at: new Date().toISOString(),
          items: [{
            idea_id: idea.id,
            idea_title: idea.title,
            slot_values: { idea: test_prompt, context: test_prompt, title: `Test ${pipeline}` },
            library_elements: {}
          }],
          configuration: {
            pipeline,
            blueprint_name: blueprint.name,
            model_config: blueprint.model_config || {}
          },
          progress: { total: 1, completed: 0, failed: 0 }
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Create output directly
      const stages = PIPELINE_STAGES[pipeline] || [];
      const firstStageId = stages[0]?.id || 'caption';

      console.log('Creating output with:', {
        job_id: job.id,
        idea_id: idea.id,
        pipeline,
        organization_id: blueprint.organization_id
      });

      const { data: output, error: outputError } = await supabase
        .from('content_outputs')
        .insert({
          job_id: job.id,
          idea_id: idea.id,
          type: 'text',
          pipeline: pipeline,
          status: 'generating',
          current_stage: firstStageId,
          stage_data: {},
          data: {
            title: `Direct Test - ${pipeline}`,
            metadata: {}
          },
          generation_params: {
            prompt: test_prompt,
            model_config: blueprint.model_config || {},
            library_elements: {}
          },
          organization_id: blueprint.organization_id
        })
        .select()
        .single();

      if (outputError) {
        console.error('Output insert error:', outputError);
        throw new Error(`Failed to create output: ${outputError.message}`);
      }

      // Trigger first stage execution synchronously
      console.log(`Triggering first stage: ${firstStageId} for output ${output.id}`);
      const { data: stageResult, error: stageError } = await supabase.functions.invoke('execute-stage', {
        body: { output_id: output.id, stage_id: firstStageId }
      });

      if (stageError) {
        console.error('Stage execution error:', stageError);
      }

      return new Response(JSON.stringify({
        action: 'started-direct',
        job_id: job.id,
        output_id: output.id,
        pipeline,
        blueprint: blueprint.name,
        first_stage: firstStageId,
        stage_result: stageResult,
        message: `Output created and first stage triggered. Use action='status' with job_id to check progress.`,
        stages: stages.map(s => s.id)
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    throw new Error(`Unknown action: ${action}. Use 'start', 'start-direct', 'status', 'approve', or 'auto-run'`);

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Background auto-approval loop
 */
async function runAutoApproval(
  supabase: any,
  jobId: string,
  stages: Array<{ id: string; modelType: string }>,
  skipImage: boolean
) {
  const maxWaitMs = 5 * 60 * 1000; // 5 minutes total
  const pollIntervalMs = 3000;
  const startTime = Date.now();

  try {
    // Wait for output to be created
    let output: any = null;
    while (!output && Date.now() - startTime < maxWaitMs) {
      const { data: outputs } = await supabase
        .from('content_outputs')
        .select('*')
        .eq('job_id', jobId);

      if (outputs && outputs.length > 0) {
        output = outputs[0];
        console.log(`[AutoApproval] Output created: ${output.id}`);
        break;
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    if (!output) {
      console.error('[AutoApproval] Timeout waiting for output');
      return;
    }

    // Process each stage
    for (const stage of stages) {
      if (Date.now() - startTime > maxWaitMs) {
        console.log('[AutoApproval] Timeout reached');
        break;
      }

      // Skip image stages if configured
      if (skipImage && stage.modelType === 'image_generator') {
        console.log(`[AutoApproval] Skipping ${stage.id} (image)`);
        continue;
      }

      console.log(`[AutoApproval] Waiting for stage: ${stage.id}`);

      // Wait for stage to complete
      let stageComplete = false;
      while (!stageComplete && Date.now() - startTime < maxWaitMs) {
        const { data: currentOutput } = await supabase
          .from('content_outputs')
          .select('*')
          .eq('id', output.id)
          .single();

        const stageData = currentOutput?.stage_data?.[stage.id];
        if (stageData && (stageData.content || stageData.image_url || stageData.scenes?.length > 0)) {
          stageComplete = true;
          console.log(`[AutoApproval] Stage ${stage.id} complete, approving...`);

          // Approve
          const approveAction = (currentOutput.pipeline === 'social_media_post' && stage.id === 'image_prompt')
            ? 'approve_and_generate' : 'approve';

          await supabase.functions.invoke('approve-stage', {
            body: { output_id: output.id, stage_id: stage.id, action: approveAction }
          });
          console.log(`[AutoApproval] Stage ${stage.id} approved`);
        }

        if (!stageComplete) {
          await new Promise(r => setTimeout(r, pollIntervalMs));
        }
      }
    }

    console.log('[AutoApproval] Complete');
  } catch (error) {
    console.error('[AutoApproval] Error:', error);
  }
}
