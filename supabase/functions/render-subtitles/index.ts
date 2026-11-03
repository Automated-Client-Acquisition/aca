import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { output_id, template_id } = await req.json();

    if (!output_id) {
      return new Response(
        JSON.stringify({ error: 'output_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the output
    const { data: output, error: fetchError } = await supabase
      .from('content_outputs')
      .select('id, organization_id, stage_data, generation_params')
      .eq('id', output_id)
      .single();

    if (fetchError || !output) {
      return new Response(
        JSON.stringify({ error: 'Output not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, output.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    const stageData = output.stage_data || {};

    // Validate transcription data exists
    if (!stageData.subtitle_transcription?.words || stageData.subtitle_transcription.words.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No subtitle transcription data found. Run transcription first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate video URL exists
    const videoUrl = stageData.final?.video_url;
    if (!videoUrl) {
      return new Response(
        JSON.stringify({ error: 'No video URL found in final stage' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve template ID: explicit param > blueprint config > default
    const resolvedTemplateId = template_id
      || output.generation_params?.subtitle_template
      || 'clean_white';

    console.log(`🎬 Rendering subtitles for output ${output_id} with template ${resolvedTemplateId}`);

    // Update status to generating
    await supabase.from('content_outputs').update({
      stage_data: {
        ...stageData,
        subtitle_render: {
          status: 'generating',
          template_id: resolvedTemplateId,
          started_at: new Date().toISOString(),
        },
      },
    }).eq('id', output_id);

    // Delegate to subtitle renderer worker
    const workerUrl = Deno.env.get('SUBTITLE_RENDERER_WORKER_URL');
    if (!workerUrl) {
      return new Response(
        JSON.stringify({ error: 'SUBTITLE_RENDERER_WORKER_URL not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if this is being called by the worker itself (prevent loops)
    const calledByWorker = req.headers.get('x-subtitle-worker') === 'true';
    if (calledByWorker) {
      return new Response(
        JSON.stringify({ error: 'Cannot delegate to worker from worker' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fire-and-forget to worker
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);

    try {
      await fetch(`${workerUrl}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-subtitle-worker': 'true',
        },
        body: JSON.stringify({ output_id, template_id: resolvedTemplateId }),
        signal: controller.signal,
      });
    } catch (e) {
      // Expected timeout/abort for fire-and-forget
      console.log(`📡 Delegated to worker (may have timed out, which is expected for fire-and-forget)`);
    }

    return new Response(
      JSON.stringify({ success: true, delegated: true, template_id: resolvedTemplateId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ Error in render-subtitles:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
