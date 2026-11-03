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
    const { output_id, stage_id, version_id, reset_downstream, user_id: bodyUserId } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get current output
    const { data: output, error: outputError } = await supabase
      .from('content_outputs')
      .select('organization_id, stage_data, pipeline')
      .eq('id', output_id)
      .single();

    if (outputError || !output) {
      return new Response(
        JSON.stringify({ error: 'Output not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, output.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // The audit row's user_id comes from the caller's token, not the body, unless
    // this is an internal service-role call.
    let user_id = bodyUserId;
    if (!isServiceRoleRequest(req)) {
      try {
        user_id = (await authenticateRequest(req, supabase)).user_id;
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }
    }

    // Get the version data (must be a version of this output)
    const { data: versionData, error: versionError } = await supabase
      .from('stage_approvals')
      .select('*')
      .eq('id', version_id)
      .eq('output_id', output_id)
      .single();

    if (versionError || !versionData) {
      return new Response(
        JSON.stringify({ error: 'Version not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Restore stage data from version
    const stageData = output.stage_data || {};
    stageData[stage_id] = versionData.stage_snapshot;

    // If reset_downstream, clear subsequent stages
    if (reset_downstream) {
      // Get pipeline definition to determine stage order
      const { data: blueprint } = await supabase
        .from('blueprints')
        .select('structure')
        .eq('pipeline', output.pipeline)
        .single();

      if (blueprint?.structure?.stages) {
        const stages = blueprint.structure.stages;
        const stageIndex = stages.findIndex((s: any) => s.id === stage_id);
        
        // Clear all stages after the rolled-back stage
        for (let i = stageIndex + 1; i < stages.length; i++) {
          delete stageData[stages[i].id];
        }
      }
    }

    // Update output with rolled-back stage data
    const { error: updateError } = await supabase
      .from('content_outputs')
      .update({
        stage_data: stageData,
        updated_at: new Date().toISOString()
      })
      .eq('id', output_id);

    if (updateError) throw updateError;

    // Log the rollback
    await supabase
      .from('stage_approvals')
      .insert({
        output_id,
        stage_id,
        action: 'rollback',
        user_id,
        notes: `Rolled back to version ${versionData.version_number}`,
        version_number: versionData.version_number,
        stage_snapshot: versionData.stage_snapshot
      });

    return new Response(
      JSON.stringify({
        success: true,
        output_id,
        stage_id,
        version_rolled_back_to: versionData.version_number
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Rollback error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Rollback failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
