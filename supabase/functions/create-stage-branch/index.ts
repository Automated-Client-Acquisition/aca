import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { output_id, stage_id, branch_name, custom_prompt, model_overrides, user_id } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get source output
    const { data: sourceOutput, error: sourceError } = await supabase
      .from('content_outputs')
      .select('*')
      .eq('id', output_id)
      .single();

    if (sourceError || !sourceOutput) {
      throw new Error('Source output not found');
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, sourceOutput.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // Create new output as branch
    const branchData = {
      ...sourceOutput,
      id: undefined, // Let DB generate new ID
      stage_data: {
        [stage_id]: sourceOutput.stage_data?.[stage_id]
      },
      status: 'generating',
      current_stage: stage_id,
      generation_params: {
        ...sourceOutput.generation_params,
        branch_from: output_id,
        branch_name: branch_name || `Branch from ${stage_id}`,
        custom_prompt,
        model_overrides
      },
      created_at: new Date().toISOString()
    };

    const { data: branchOutput, error: branchError } = await supabase
      .from('content_outputs')
      .insert(branchData)
      .select()
      .single();

    if (branchError) throw branchError;

    // Trigger stage execution for the branch with error handling
    const { error: stageError } = await supabase.functions.invoke('execute-stage', {
      body: {
        output_id: branchOutput.id,
        stage_id,
        custom_prompt,
        model_overrides
      }
    });

    if (stageError) {
      console.error(`[create-stage-branch] Failed to execute stage ${stage_id} for branch:`, stageError);
      // Update branch output with error
      await supabase.from('content_outputs')
        .update({
          status: 'review',
          error_message: `Branch stage execution failed: ${stageError.message || 'Unknown error'}`
        })
        .eq('id', branchOutput.id);
      return new Response(
        JSON.stringify({
          success: false,
          branch_output_id: branchOutput.id,
          error: `Stage execution failed: ${stageError.message || 'Unknown error'}`
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        branch_output_id: branchOutput.id,
        branch_name: branch_name || `Branch from ${stage_id}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Branch creation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Branch creation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
