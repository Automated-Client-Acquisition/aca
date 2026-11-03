import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { output_id, stage_id, scene_number, action } = await req.json();

    if (!output_id || !stage_id || scene_number === undefined || !action) {
      throw new Error('output_id, stage_id, scene_number, and action are required');
    }

    if (!['approve', 'reject'].includes(action)) {
      throw new Error('action must be approve or reject');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth user
    const authHeader = req.headers.get('authorization');
    let userId = null;
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id;
    }

    console.log(`Processing ${action} for clip ${scene_number} in stage ${stage_id} on output ${output_id}`);

    // Fetch the output
    const { data: output, error: outputError } = await supabase
      .from('content_outputs')
      .select('*')
      .eq('id', output_id)
      .single();

    if (outputError || !output) {
      throw new Error(`Output not found: ${outputError?.message}`);
    }

    const stageData = output.stage_data || {};
    const currentStageData = stageData[stage_id] || {};
    // Clips are nested: stage_data.clips.clips (not stage_data.clips directly)
    const clips = currentStageData.clips || [];

    // Find and update the specific clip (clips use scene_number, not scene)
    const updatedClips = clips.map((clip: any) => {
      if (clip.scene_number === scene_number) {
        return {
          ...clip,
          status: action === 'approve' ? 'approved' : 'rejected',
          [`${action}d_at`]: new Date().toISOString(),
          [`${action}d_by`]: userId
        };
      }
      return clip;
    });

    // Update stage data with modified clips
    const updatedStageData = {
      ...stageData,
      [stage_id]: {
        ...currentStageData,
        clips: updatedClips
      }
    };

    await supabase
      .from('content_outputs')
      .update({ stage_data: updatedStageData })
      .eq('id', output_id);

    // Check if all clips are approved
    const allApproved = updatedClips.every((c: any) => c.status === 'approved');

    // Auto-trigger assembly when all clips approved
    if (allApproved) {
      console.log('✅ All clips approved, auto-triggering clips stage approval');
      try {
        await supabase.functions.invoke('approve-stage', {
          body: { 
            output_id, 
            stage_id: 'clips', 
            action: 'approve',
            user_id: userId
          }
        });
      } catch (error) {
        console.error('Failed to auto-trigger clips approval:', error);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Clip ${action}d`,
        all_approved: allApproved,
        approved_count: updatedClips.filter((c: any) => c.status === 'approved').length,
        total_count: updatedClips.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error approving clip:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
