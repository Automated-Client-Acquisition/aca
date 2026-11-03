import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { output_id, stage_id, custom_prompt, instructions, organization_id, scene_number, regenerate_scene } = await req.json();

    if (!output_id) {
      throw new Error('output_id is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Regenerating content for output ${output_id}${stage_id ? ` stage ${stage_id}` : ''}${scene_number ? ` scene ${scene_number}` : ''}`);
    if (instructions) {
      console.log(`Instructions provided: ${instructions.substring(0, 100)}...`);
    }

    // Fetch the output to get original generation params
    const { data: output, error: fetchError } = await supabase
      .from('content_outputs')
      .select('*, content_generation_jobs(organization_id, pipeline, configuration)')
      .eq('id', output_id)
      .single();

    if (fetchError) throw fetchError;
    if (!output) throw new Error('Output not found');

    // The service-role client writes the output and calls execute-stage with the
    // service key, so the caller must be able to access the output's org (taken
    // from its job, not the body; a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, (output.content_generation_jobs as any)?.organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    const outputData = output.data as any;
    const generationParams = output.generation_params as any;
    const job = output.content_generation_jobs as any;
    const pipeline = job?.pipeline;

    // Get the original prompt or use custom prompt
    let prompt = custom_prompt;
    
    if (!prompt) {
      // Reconstruct original prompt from generation params
      const ideaContext = generationParams?.idea || outputData?.context || '';
      const blueprintPrompt = generationParams?.prompt || '';
      prompt = `${ideaContext}\n\n${blueprintPrompt}`;
    }

    console.log(`Pipeline: ${pipeline}, Prompt length: ${prompt.length} chars`);

    // For now, we'll update the output status to indicate regeneration in progress
    // In a real implementation, this would call the appropriate generation function
    // based on the pipeline type and stage_id

    if (stage_id) {
      // Regenerating specific stage - call execute-stage
      console.log(`Calling execute-stage for stage ${stage_id} with instructions`);

      // Build the final prompt that includes instructions
      let finalPrompt = custom_prompt;
      if (instructions && instructions.trim()) {
        // If we have instructions, combine them with the existing prompt context
        const existingContent = output.stage_data?.[stage_id]?.content || '';
        finalPrompt = `Regenerate the following content with these modifications:

CURRENT CONTENT:
${existingContent}

INSTRUCTIONS FOR CHANGES:
${instructions}

Please regenerate the content following the instructions above while maintaining the overall context and purpose.`;
      }

      // Call execute-stage to actually regenerate
      // Pass scene_number/regenerate_scene for single item regeneration (carousel slides, scenes, etc.)
      const { data: executeResult, error: executeError } = await supabase.functions.invoke('execute-stage', {
        body: {
          output_id,
          stage_id,
          custom_prompt: finalPrompt,
          instructions: instructions,
          // For carousel/scene regeneration - pass the specific scene/slide number
          regenerate_scene: scene_number || regenerate_scene,
        }
      });

      if (executeError) {
        console.error('execute-stage error:', executeError);
        throw executeError;
      }

      console.log(`✓ Stage ${stage_id} regeneration triggered via execute-stage`);

      return new Response(
        JSON.stringify({
          success: true,
          output_id,
          stage_id,
          message: 'Stage regeneration initiated',
          result: executeResult
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Regenerating entire output
      const { error: updateError } = await supabase
        .from('content_outputs')
        .update({ 
          status: 'generating',
          error_message: null,
          data: { 
            ...outputData, 
            regenerated_at: new Date().toISOString() 
          }
        })
        .eq('id', output_id);

      if (updateError) throw updateError;

      // TODO: Queue actual regeneration job for entire output
      console.log(`✓ Output ${output_id} marked for regeneration`);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        output_id,
        stage_id,
        message: 'Content regeneration initiated'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Regeneration error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
