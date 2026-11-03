import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess, isServiceRoleRequest } from "../_shared/org-access.ts";
import { authenticateRequest, unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { output_id, stage_ids, custom_prompts, user_id } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Starting parallel execution of ${stage_ids.length} stages for output ${output_id}`);

    // Get output to verify it exists
    const { data: output, error: outputError } = await supabase
      .from('content_outputs')
      .select('*')
      .eq('id', output_id)
      .single();

    if (outputError || !output) {
      throw new Error('Output not found');
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, output.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // Only internal service-role callers may act on behalf of a body-supplied user.
    let actingUserId = user_id;
    if (!isServiceRoleRequest(req)) {
      try { actingUserId = (await authenticateRequest(req, supabase)).user_id; } catch (authErr) { return unauthorized(authErr, corsHeaders); }
    }

    // Trigger all stages in parallel
    const executions = stage_ids.map(async (stageId: string) => {
      try {
        const customPrompt = custom_prompts?.[stageId];
        
        const { data, error } = await supabase.functions.invoke('execute-stage', {
          body: {
            output_id,
            stage_id: stageId,
            custom_prompt: customPrompt,
            user_id: actingUserId
          }
        });

        if (error) {
          console.error(`Stage ${stageId} execution failed:`, error);
          return { stageId, success: false, error: error.message };
        }

        return { stageId, success: true, data };
      } catch (error) {
        console.error(`Stage ${stageId} execution error:`, error);
        return { 
          stageId, 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Wait for all parallel executions
    const results = await Promise.all(executions);

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log(`Parallel execution complete: ${successCount} succeeded, ${failureCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        output_id,
        results,
        summary: {
          total: stage_ids.length,
          succeeded: successCount,
          failed: failureCount
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Parallel execution error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Parallel execution failed'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
