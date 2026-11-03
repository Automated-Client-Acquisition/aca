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

    if (!['exclude', 'include'].includes(action)) {
      throw new Error('action must be exclude or include');
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

    console.log(`Processing ${action} for item ${scene_number} in stage ${stage_id} on output ${output_id}`);

    // Fetch current output to determine data structure (scenes vs slides)
    const { data: currentOutput, error: fetchError } = await supabase
      .from('content_outputs')
      .select('stage_data, pipeline')
      .eq('id', output_id)
      .single();

    if (fetchError || !currentOutput) {
      throw new Error(`Output not found: ${fetchError?.message}`);
    }

    const stageData = currentOutput.stage_data || {};
    const currentStageData = stageData[stage_id] || {};

    // Determine if this is scenes (video) or slides (carousel)
    const isSlides = currentStageData.slides !== undefined;
    const arrayKey = isSlides ? 'slides' : 'scenes';
    const itemNumberKey = isSlides ? 'slide_number' : 'scene_number';
    const items = currentStageData[arrayKey] || [];

    console.log(`Using ${arrayKey} array with ${itemNumberKey} key, found ${items.length} items`);

    const updatedItems = items.map((item: any) => {
      const itemNum = item[itemNumberKey];
      if (itemNum === scene_number) {
        // exclude sets status to 'excluded', include sets it back to 'ready'
        const newStatus = action === 'exclude' ? 'excluded' : 'ready';
        return {
          ...item,
          status: newStatus,
          [`${action}d_at`]: new Date().toISOString(),
          [`${action}d_by`]: userId
        };
      }
      return item;
    });

    const updatedStageData = {
      ...stageData,
      [stage_id]: {
        ...currentStageData,
        [arrayKey]: updatedItems
      }
    };

    const { error: updateError } = await supabase
      .from('content_outputs')
      .update({ stage_data: updatedStageData })
      .eq('id', output_id);

    if (updateError) {
      throw new Error(`Failed to update: ${updateError.message}`);
    }

    const itemLabel = isSlides ? 'Slide' : 'Scene';
    const readyCount = updatedItems.filter((s: any) => s.status === 'ready' || !s.status).length;
    const excludedCount = updatedItems.filter((s: any) => s.status === 'excluded').length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `${itemLabel} ${action}d`,
        ready_count: readyCount,
        excluded_count: excludedCount,
        total_count: updatedItems.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error approving scene:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
