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

    const { output_id } = await req.json();

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
    const genParams = output.generation_params || {};

    // Find audio URL — check full_voiceover first, then voice stage, then video (for HeyGen/oneshot)
    let audioUrl: string | null = null;
    if (stageData.full_voiceover?.audio_url) {
      audioUrl = stageData.full_voiceover.audio_url;
    } else if (stageData.voice?.audio_url) {
      audioUrl = stageData.voice.audio_url;
    } else if (stageData.voice?.url) {
      audioUrl = stageData.voice.url;
    } else if (stageData.video?.video_url || stageData.video?.url) {
      // For HeyGen / generative_video_oneshot — Whisper can extract audio from video
      audioUrl = stageData.video.video_url || stageData.video.url;
    } else if (stageData.final?.video_url || stageData.final?.url) {
      // Fallback: use the final video itself as audio source
      audioUrl = stageData.final.video_url || stageData.final.url;
    }

    if (!audioUrl) {
      return new Response(
        JSON.stringify({ error: 'No audio URL found in output stage data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🎤 Starting Whisper transcription for output ${output_id}`);
    console.log(`   Audio URL: ${audioUrl}`);

    // Get Replicate API key from organization
    const { data: apiKeys } = await supabase
      .from('api_keys')
      .select('key_encrypted, provider')
      .eq('organization_id', output.organization_id)
      .eq('provider', 'replicate');

    if (!apiKeys || apiKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No Replicate API key found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt the API key
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const { decryptApiKey } = await import('../_shared/unipile-client.ts');
    const replicateApiKey = await decryptApiKey(apiKeys[0].key_encrypted, encryptionKey);

    const webhookUrl = `${supabaseUrl}/functions/v1/generation-completion-webhook`;

    // Launch Whisper prediction on Replicate
    // Using incredibly-fast-whisper for reliable word-level timestamps
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${replicateApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: 'vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c',
        input: {
          audio: audioUrl,
          task: 'transcribe',
          timestamp: 'word',
          batch_size: 64,
        },
        webhook: webhookUrl,
        webhook_events_filter: ['completed'],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Replicate prediction failed:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to launch Whisper transcription', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prediction = await response.json();
    console.log(`✅ Whisper prediction launched: ${prediction.id}`);

    // Track the prediction in pending_predictions
    const pendingPredictions = genParams.pending_predictions || [];
    pendingPredictions.push({
      prediction_id: prediction.id,
      item_type: 'whisper_transcription',
      stage_id: 'subtitle_transcription',
    });

    // Update output with pending prediction and set subtitle_transcription status
    await supabase.from('content_outputs').update({
      stage_data: {
        ...stageData,
        subtitle_transcription: {
          status: 'generating',
          source_audio_url: audioUrl,
        },
      },
      generation_params: {
        ...genParams,
        pending_predictions: pendingPredictions,
      },
    }).eq('id', output_id);

    return new Response(
      JSON.stringify({ success: true, prediction_id: prediction.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ Error in transcribe-audio:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
