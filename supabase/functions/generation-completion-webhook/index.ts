import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { decryptApiKey } from '../_shared/llm-client.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { uploadToStorage as uploadToByokStorage } from '../_shared/byok-storage.ts';
import { SELF_HOSTED } from '../_shared/site-config.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper functions for AWS Signature V4
async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function hmacSha256Hex(key: ArrayBuffer, data: string): Promise<string> {
  const signatureBuffer = await hmacSha256(key, data);
  return Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function fetchReplicatePrediction(
  supabase: any,
  organizationId: string,
  predictionId: string,
): Promise<{ output: unknown; status: string; error: unknown; metrics: unknown } | null> {
  if (!predictionId || !/^[a-z0-9]+$/i.test(predictionId)) return null;
  const { data: keyRow } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', organizationId)
    .eq('provider', 'replicate')
    .limit(1)
    .maybeSingle();
  const token = keyRow?.key_encrypted
    ? await decryptApiKey(keyRow.key_encrypted)
    : Deno.env.get('REPLICATE_API_TOKEN');
  if (!token) return null;
  const res = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const p = await res.json();
  return { output: p.output, status: p.status, error: p.error, metrics: p.metrics };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log('🎬 Webhook received:', payload.id, payload.status);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const predictionId = payload.id;
    let { output, status, error: predictionError, metrics } = payload;

    // Find content_output containing this prediction_id in pending_predictions.
    // Use a JSONB sub-path containment filter so the GIN index on
    // (generation_params -> 'pending_predictions') is hit. A plain
    // .in('status', ['generating', 'review']) returns up to 1000 rows by default,
    // and with thousands of historical 'review' rows the generating row was
    // being silently dropped — every webhook lookup 404'd.
    const { data: outputs } = await supabase
      .from('content_outputs')
      .select('*')
      .in('status', ['generating', 'review'])
      .filter('generation_params->pending_predictions', 'cs', JSON.stringify([{ prediction_id: predictionId }]))
      .limit(2);

    const outputRecord = outputs?.[0];

    if (!outputRecord) {
      console.error('❌ No output found for prediction:', predictionId);
      return new Response(
        JSON.stringify({ error: 'Output not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const pendingPredictions = outputRecord.generation_params?.pending_predictions || [];
    const prediction = pendingPredictions.find((p: any) => p.prediction_id === predictionId);

    if (!prediction) {
      console.error('❌ Prediction not in pending list:', predictionId);
      return new Response(
        JSON.stringify({ error: 'Prediction not tracked' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // verify_jwt=false and Replicate webhooks are unsigned here: never trust the body.
    // Internal callers (reset-stuck-outputs) send the service key; for everyone else,
    // re-fetch the prediction from Replicate with the org's key and use that result.
    if (!isServiceRoleRequest(req)) {
      const verified = await fetchReplicatePrediction(supabase, outputRecord.organization_id, predictionId);
      if (!verified) {
        return new Response(
          JSON.stringify({ error: 'Prediction could not be verified' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      ({ output, status, error: predictionError, metrics } = verified);
    }

    const { stage_id, item_type, scene_number, extra_data } = prediction;
    const stageData = outputRecord.stage_data || {};

    if (status === 'succeeded') {
      console.log(`✅ Success: ${item_type} for stage ${stage_id}, scene ${scene_number || 'N/A'}`);
      
      // Handle based on item_type
      switch (item_type) {
        case 'image':
        case 'scene_image': // Scene images from storyboard video pipeline
          await handleImageCompletion(supabase, outputRecord, stageData, stage_id, prediction, output, metrics);
          break;
        case 'carousel_slide':
          await handleCarouselSlideCompletion(supabase, outputRecord, stageData, stage_id, prediction, output, metrics);
          break;
        case 'clip':
          await handleClipCompletion(supabase, outputRecord, stageData, stage_id, prediction, output, metrics);
          break;
        case 'video':
          await handleSingleVideoCompletion(supabase, outputRecord, stageData, stage_id, prediction, output, metrics);
          break;
        case 'audio_merge':
          await handleAudioMergeCompletion(supabase, outputRecord, prediction, output, metrics);
          break;
        case 'concatenation':
          // Phase 1 of single voiceover flow - trigger Phase 2 (audio overlay)
          await handleConcatenationCompletion(supabase, outputRecord, prediction, output, metrics);
          break;
        case 'audio_overlay':
          // Phase 2 of single voiceover flow - final result
          await handleAudioOverlayCompletion(supabase, outputRecord, stageData, stage_id, prediction, output, metrics);
          break;
        case 'assembly':
          await handleAssemblyCompletion(supabase, outputRecord, stageData, stage_id, prediction, output, metrics);
          break;
        case 'whisper_transcription':
          await handleWhisperTranscriptionCompletion(supabase, outputRecord, stageData, stage_id, prediction, output, metrics);
          break;
        default:
          console.warn(`⚠️ Unknown item_type: ${item_type}, attempting generic image handling`);
          await handleImageCompletion(supabase, outputRecord, stageData, stage_id, prediction, output, metrics);
      }
    } else if (status === 'failed') {
      console.error(`❌ Failed: ${item_type} for stage ${stage_id}:`, predictionError);
      await handleFailure(supabase, outputRecord, stageData, stage_id, prediction, predictionError);
    }

    // Remove from pending predictions
    // IMPORTANT: Re-fetch fresh generation_params to avoid overwriting updates made by handlers
    // (e.g., handleAudioMergeCompletion updates merged_clips and completed_audio_merges)
    const { data: freshOutputForPending } = await supabase
      .from('content_outputs')
      .select('generation_params')
      .eq('id', outputRecord.id)
      .single();

    const freshGenParams = freshOutputForPending?.generation_params || {};
    const freshPendingPredictions = freshGenParams.pending_predictions || [];
    const remainingPredictions = freshPendingPredictions.filter((p: any) => p.prediction_id !== predictionId);

    await supabase.from('content_outputs').update({
      generation_params: {
        ...freshGenParams,
        pending_predictions: remainingPredictions
      }
    }).eq('id', outputRecord.id);

    // Check if all predictions for this stage are complete
    // Skip markStageComplete for subtitle_transcription — it's not a pipeline stage,
    // it's metadata managed by handleWhisperTranscriptionCompletion + maybeAutoTriggerSubtitleRendering
    const stagePredictions = remainingPredictions.filter((p: any) => p.stage_id === stage_id);
    if (stagePredictions.length === 0 && stage_id !== 'subtitle_transcription') {
      console.log(`🎉 All items complete for stage ${stage_id}`);
      await markStageComplete(supabase, outputRecord.id, stage_id);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Webhook error:', error);
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

async function handleImageCompletion(
  supabase: any,
  output: any,
  _stageData: any, // Not used directly - we re-fetch to avoid race conditions
  stageId: string,
  prediction: any,
  result: any,
  metrics: any
) {
  const imageUrl = Array.isArray(result) ? result[0] : result;

  // Upload to user's storage
  let permanentUrl = imageUrl;
  try {
    permanentUrl = await uploadToStorage(supabase, output.organization_id, imageUrl, 'image', output.id);
    console.log(`✅ Image uploaded to storage: ${permanentUrl}`);
  } catch (error) {
    console.error('⚠️ Storage upload failed, using temporary URL:', error);
  }

  // Re-fetch latest stage_data to avoid race conditions with concurrent webhook calls
  const { data: freshOutput } = await supabase
    .from('content_outputs')
    .select('stage_data, data')
    .eq('id', output.id)
    .single();

  const stageData = freshOutput?.stage_data || {};

  // Check if this is a manual image generation (from ArticleLayout Featured Image tab)
  // In this case, we need to update the data.image_url field directly
  if (stageId === 'manual_image') {
    const currentData = freshOutput?.data || {};
    await supabase.from('content_outputs').update({
      status: 'review',
      data: {
        ...currentData,
        image_url: permanentUrl,
        image_status: null, // Clear generating status
      },
      stage_data: {
        ...stageData,
        [stageId]: {
          ...stageData[stageId],
          url: permanentUrl,
          status: 'completed',
          completed_at: new Date().toISOString(),
          metrics
        }
      }
    }).eq('id', output.id);

    console.log(`✅ Manual image completed: ${permanentUrl}`);
    return;
  }

  // Check if this is a scene-based image (storyboard), carousel slides, or single image
  const currentScenes = stageData[stageId]?.scenes || [];
  const currentSlides = stageData[stageId]?.slides || [];
  // Consider it scene-based if:
  // 1. We have existing scenes AND a scene_number, OR
  // 2. We have a scene_number but no scenes yet (race condition - execute-stage save hasn't committed yet)
  //    This ensures we create the scene even if the initial save was delayed
  const hasSceneNumber = prediction.scene_number !== undefined;
  const hasScenes = (currentScenes.length > 0 && hasSceneNumber) || (hasSceneNumber && stageId === 'storyboard');
  const hasSlides = currentSlides.length > 0 && prediction.scene_number !== undefined;

  if (hasScenes) {
    // Scene-based image (storyboard) - update specific scene using atomic SQL update
    // This avoids race conditions when multiple webhooks complete simultaneously
    const sceneNumber = prediction.scene_number;
    const predictionId = prediction.prediction_id;

    console.log(`🔄 Updating scene ${sceneNumber} (prediction: ${predictionId}) with image: ${permanentUrl}`);

    // Use raw SQL to atomically update only the specific scene in the array
    // This prevents concurrent webhooks from overwriting each other's updates
    const { error: updateError } = await supabase.rpc('update_scene_image', {
      p_output_id: output.id,
      p_stage_id: stageId,
      p_scene_number: sceneNumber,
      p_image_url: permanentUrl,
      p_status: 'ready',
      p_completed_at: new Date().toISOString(),
      p_metrics: metrics || {}
    });

    if (updateError) {
      console.error(`❌ Failed to update scene ${sceneNumber}:`, updateError);
      // Fallback to regular update if RPC doesn't exist
      // Check if scene exists in array
      const existingSceneIndex = currentScenes.findIndex(
        (scene: any) => scene.scene_number === sceneNumber || scene.prediction_id === predictionId
      );

      let updatedScenes;
      if (existingSceneIndex >= 0) {
        // Update existing scene
        updatedScenes = currentScenes.map((scene: any, index: number) => {
          if (index === existingSceneIndex) {
            return {
              ...scene,
              image_url: permanentUrl,
              status: 'ready',
              completed_at: new Date().toISOString(),
              metrics
            };
          }
          return scene;
        });
      } else {
        // Scene doesn't exist (race condition) - create new scene entry
        console.log(`⚠️ Scene ${sceneNumber} not found in array, creating new entry`);
        const newScene = {
          scene_number: sceneNumber,
          prediction_id: predictionId,
          image_url: permanentUrl,
          status: 'ready',
          completed_at: new Date().toISOString(),
          metrics
        };
        updatedScenes = [...currentScenes, newScene].sort((a: any, b: any) =>
          (a.scene_number || 0) - (b.scene_number || 0)
        );
      }

      await supabase.from('content_outputs').update({
        stage_data: {
          ...stageData,
          [stageId]: {
            ...stageData[stageId],
            scenes: updatedScenes,
            status: 'generating' // Keep generating status until all complete
          }
        }
      }).eq('id', output.id);
    }

    console.log(`✅ Image updated for scene ${sceneNumber}`);
  } else if (hasSlides) {
    // Carousel slides - update specific slide
    const updatedSlides = currentSlides.map((slide: any) => {
      if (slide.slide_number === prediction.scene_number || slide.prediction_id === prediction.prediction_id) {
        return {
          ...slide,
          image_url: permanentUrl,
          status: 'ready',
          completed_at: new Date().toISOString(),
          metrics
        };
      }
      return slide;
    });

    await supabase.from('content_outputs').update({
      stage_data: {
        ...stageData,
        [stageId]: {
          ...stageData[stageId],
          slides: updatedSlides
        }
      }
    }).eq('id', output.id);

    console.log(`✅ Image updated for carousel slide ${prediction.scene_number}`);
  } else {
    // Single image (social_media_post) - update stage directly with url
    await supabase.from('content_outputs').update({
      stage_data: {
        ...stageData,
        [stageId]: {
          ...stageData[stageId],
          url: permanentUrl,
          image_url: permanentUrl,
          status: 'ready',
          completed_at: new Date().toISOString(),
          metrics
        }
      }
    }).eq('id', output.id);

    console.log(`✅ Single image completed: ${permanentUrl}`);
  }
}

async function handleCarouselSlideCompletion(
  supabase: any,
  output: any,
  _stageData: any, // Not used directly - we re-fetch to avoid race conditions
  stageId: string,
  prediction: any,
  result: any,
  metrics: any
) {
  const imageUrl = Array.isArray(result) ? result[0] : result;

  // Upload to user's storage
  let permanentUrl = imageUrl;
  try {
    permanentUrl = await uploadToStorage(supabase, output.organization_id, imageUrl, 'image', output.id);
    console.log(`✅ Carousel slide image uploaded to storage: ${permanentUrl}`);
  } catch (error) {
    console.error('⚠️ Storage upload failed, using temporary URL:', error);
  }

  // Re-fetch latest stage_data to avoid race conditions with concurrent webhook calls
  const { data: freshOutput } = await supabase
    .from('content_outputs')
    .select('stage_data')
    .eq('id', output.id)
    .single();

  const stageData = freshOutput?.stage_data || {};

  // Update the specific slide in the slides array
  const currentSlides = stageData[stageId]?.slides || [];

  const updatedSlides = currentSlides.map((slide: any) => {
    if (slide.slide_number === prediction.scene_number || slide.prediction_id === prediction.prediction_id) {
      return {
        ...slide,
        image_url: permanentUrl,
        status: 'ready',
        completed_at: new Date().toISOString(),
        metrics
      };
    }
    return slide;
  });

  await supabase.from('content_outputs').update({
    stage_data: {
      ...stageData,
      [stageId]: {
        ...stageData[stageId],
        slides: updatedSlides
      }
    }
  }).eq('id', output.id);

  console.log(`✅ Carousel slide ${prediction.scene_number} image updated`);
}

async function handleClipCompletion(
  supabase: any,
  output: any,
  _stageData: any, // Not used directly - we re-fetch to avoid race conditions
  stageId: string,
  prediction: any,
  result: any,
  metrics: any
) {
  // Upload to user's storage
  let permanentUrl = result;
  try {
    permanentUrl = await uploadToStorage(supabase, output.organization_id, result, 'video', output.id);
    console.log(`✅ Clip uploaded to storage: ${permanentUrl}`);
  } catch (error) {
    console.error('⚠️ Storage upload failed, using temporary URL:', error);
  }

  // Re-fetch latest stage_data to avoid race conditions with concurrent webhook calls
  const { data: freshOutput } = await supabase
    .from('content_outputs')
    .select('stage_data')
    .eq('id', output.id)
    .single();

  const stageData = freshOutput?.stage_data || {};
  const currentClips = stageData[stageId]?.clips || [];
  const sceneNumber = prediction.scene_number;
  const predictionId = prediction.prediction_id;

  console.log(`🔄 Updating clip ${sceneNumber} (prediction: ${predictionId}) with video: ${permanentUrl}`);

  // Use atomic SQL update to prevent race conditions with concurrent webhooks
  const { error: updateError } = await supabase.rpc('update_clip_video', {
    p_output_id: output.id,
    p_stage_id: stageId,
    p_scene_number: sceneNumber,
    p_video_url: permanentUrl,
    p_status: 'ready',
    p_completed_at: new Date().toISOString(),
    p_metrics: metrics || {}
  });

  if (updateError) {
    console.error(`❌ Failed to update clip ${sceneNumber}:`, updateError);
    // Fallback to regular update if RPC doesn't exist
    const updatedClips = currentClips.map((clip: any) => {
      if (clip.scene_number === sceneNumber || clip.prediction_id === predictionId) {
        return {
          ...clip,
          video_url: permanentUrl,
          status: 'ready',
          completed_at: new Date().toISOString(),
          metrics
        };
      }
      return clip;
    });

    await supabase.from('content_outputs').update({
      stage_data: {
        ...stageData,
        [stageId]: {
          ...stageData[stageId],
          clips: updatedClips
        }
      }
    }).eq('id', output.id);
  }

  console.log(`✅ Clip updated for scene ${sceneNumber}`);
}

async function handleAudioMergeCompletion(
  supabase: any,
  output: any,
  prediction: any,
  result: any,
  _metrics: any
) {
  const mergedVideoUrl = Array.isArray(result) ? result[0] : result;
  const clipIndex = prediction.clip_index;

  console.log(`✅ Audio merge completed for clip index ${clipIndex}: ${mergedVideoUrl}`);

  // Re-fetch latest generation_params to avoid race conditions
  const { data: freshOutput } = await supabase
    .from('content_outputs')
    .select('generation_params, organization_id')
    .eq('id', output.id)
    .single();

  if (!freshOutput) {
    console.error('❌ Could not fetch output for audio merge completion');
    return;
  }

  const genParams = freshOutput.generation_params || {};
  const mergedClips = [...(genParams.merged_clips || [])];
  const totalMerges = genParams.total_audio_merges || 0;
  let completedMerges = (genParams.completed_audio_merges || 0) + 1;

  // Update the merged clip at the correct index
  if (clipIndex !== undefined && clipIndex < mergedClips.length) {
    mergedClips[clipIndex] = mergedVideoUrl;
  }

  // Update generation_params with new merged clip
  await supabase.from('content_outputs').update({
    generation_params: {
      ...genParams,
      merged_clips: mergedClips,
      completed_audio_merges: completedMerges
    }
  }).eq('id', output.id);

  console.log(`📊 Audio merge progress: ${completedMerges}/${totalMerges}`);

  // Check if all audio merges are complete
  if (completedMerges >= totalMerges) {
    console.log('🎉 All audio merges complete! Starting final concatenation...');

    // IMPORTANT: Re-fetch merged_clips from DB to get all updates from concurrent webhooks
    // Each webhook only updates its own clip index, so we need the final merged state
    const { data: finalOutput } = await supabase
      .from('content_outputs')
      .select('generation_params, organization_id')
      .eq('id', output.id)
      .single();

    const finalMergedClips = finalOutput?.generation_params?.merged_clips || [];
    console.log(`📋 Final merged clips count: ${finalMergedClips.length}`);
    console.log(`📋 Merged clips: ${JSON.stringify(finalMergedClips)}`);

    // Trigger phase 2: concatenation
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/assemble-video`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phase: 'concatenate',
          merged_clips: finalMergedClips,
          output_id: output.id,
          organization_id: finalOutput?.organization_id || freshOutput.organization_id
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to start concatenation phase:', errorText);
      } else {
        console.log('✅ Concatenation phase started');
      }
    } catch (error) {
      console.error('❌ Error triggering concatenation:', error);
    }
  }
}

/**
 * Handle concatenation completion (Phase 1 of single voiceover flow)
 * After all clips are concatenated, trigger Phase 2: audio overlay
 */
async function handleConcatenationCompletion(
  supabase: any,
  output: any,
  prediction: any,
  result: any,
  _metrics: any
) {
  const concatenatedVideoUrl = Array.isArray(result) ? result[0] : result;
  console.log(`✅ Concatenation completed: ${concatenatedVideoUrl}`);

  // Re-fetch latest generation_params to get voiceover audio URL
  const { data: freshOutput } = await supabase
    .from('content_outputs')
    .select('generation_params, organization_id, stage_data')
    .eq('id', output.id)
    .single();

  if (!freshOutput) {
    console.error('❌ Could not fetch output for concatenation completion');
    return;
  }

  const genParams = freshOutput.generation_params || {};
  const voiceoverAudioUrl = genParams.voiceover_audio_url;
  const assemblyMode = genParams.assembly_mode;

  // Check if this is the single voiceover flow
  if (assemblyMode === 'single_voiceover' && voiceoverAudioUrl) {
    console.log('🎬 Phase 1 complete! Starting Phase 2: Audio overlay...');
    console.log(`   Video: ${concatenatedVideoUrl}`);
    console.log(`   Audio: ${voiceoverAudioUrl}`);

    // Trigger Phase 2: overlay voiceover on concatenated video
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/assemble-video`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phase: 'overlay_audio',
          concatenated_video_url: concatenatedVideoUrl,
          audio_url: voiceoverAudioUrl,
          output_id: output.id,
          organization_id: freshOutput.organization_id
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to start audio overlay phase:', errorText);
      } else {
        console.log('✅ Audio overlay phase started');
      }
    } catch (error) {
      console.error('❌ Error triggering audio overlay:', error);
    }
  } else {
    // No voiceover - concatenation is the final step
    console.log('🎬 No voiceover to add - concatenation is final result');

    // Upload to user's storage
    let permanentUrl = concatenatedVideoUrl;
    try {
      permanentUrl = await uploadToStorage(supabase, output.organization_id, concatenatedVideoUrl, 'video', output.id);
      console.log(`✅ Final video uploaded to storage: ${permanentUrl}`);
    } catch (error) {
      console.error('⚠️ Storage upload failed, using temporary URL:', error);
    }

    // Update stage_data with final result
    const stageData = freshOutput.stage_data || {};
    await supabase.from('content_outputs').update({
      stage_data: {
        ...stageData,
        final: {
          ...stageData.final,
          url: permanentUrl,
          video_url: permanentUrl,
          status: 'completed',
          completed_at: new Date().toISOString()
        }
      }
    }).eq('id', output.id);

    // Mark stage complete
    await markStageComplete(supabase, output.id, 'final');
  }
}

/**
 * Handle audio overlay completion (Phase 2 of single voiceover flow)
 * This is the final step - save the result
 */
async function handleAudioOverlayCompletion(
  supabase: any,
  output: any,
  _stageData: any,
  _stageId: string,
  _prediction: any,
  result: any,
  metrics: any
) {
  const finalVideoUrl = Array.isArray(result) ? result[0] : result;
  console.log(`✅ Audio overlay completed: ${finalVideoUrl}`);

  if (!finalVideoUrl) {
    console.error('❌ No video URL in audio overlay result');
    return;
  }

  // Upload to user's storage
  let permanentUrl = finalVideoUrl;
  try {
    permanentUrl = await uploadToStorage(supabase, output.organization_id, finalVideoUrl, 'video', output.id);
    console.log(`✅ Final video uploaded to storage: ${permanentUrl}`);
  } catch (error) {
    console.error('⚠️ Storage upload failed, using temporary URL:', error);
  }

  // Re-fetch latest stage_data to avoid race conditions
  const { data: freshOutput } = await supabase
    .from('content_outputs')
    .select('stage_data, generation_params')
    .eq('id', output.id)
    .single();

  const stageData = freshOutput?.stage_data || {};
  const genParams = freshOutput?.generation_params || {};

  // Clean up intermediate data from generation_params
  const cleanedGenParams = { ...genParams };
  delete cleanedGenParams.voiceover_audio_url;
  delete cleanedGenParams.concatenated_video_url;
  delete cleanedGenParams.assembly_mode;

  // Update stage_data with final result
  await supabase.from('content_outputs').update({
    stage_data: {
      ...stageData,
      final: {
        ...stageData.final,
        url: permanentUrl,
        video_url: permanentUrl,
        status: 'completed',
        completed_at: new Date().toISOString(),
        metrics
      }
    },
    generation_params: cleanedGenParams
  }).eq('id', output.id);

  console.log(`🎉 Video assembly complete! Final URL: ${permanentUrl}`);

  // Mark stage complete so frontend displays final video
  await markStageComplete(supabase, output.id, 'final');

  // Auto-trigger Whisper transcription if subtitles are enabled
  await maybeAutoTriggerSubtitleTranscription(supabase, output);
}

async function handleSingleVideoCompletion(
  supabase: any,
  output: any,
  stageData: any,
  stageId: string,
  prediction: any,
  result: any,
  metrics: any
) {
  // Upload to user's storage
  let permanentUrl = result;
  try {
    permanentUrl = await uploadToStorage(supabase, output.organization_id, result, 'video', output.id);
    console.log(`✅ Single video uploaded to storage: ${permanentUrl}`);
  } catch (error) {
    console.error('⚠️ Storage upload failed, using temporary URL:', error);
  }
  
  await supabase.from('content_outputs').update({
    stage_data: {
      ...stageData,
      [stageId]: {
        ...stageData[stageId],
        url: permanentUrl,
        video_url: permanentUrl,
        status: 'ready',
        completed_at: new Date().toISOString(),
        metrics
      }
    }
  }).eq('id', output.id);

  console.log(`✅ Single video completed`);

  // Auto-trigger Whisper transcription if subtitles are enabled
  await maybeAutoTriggerSubtitleTranscription(supabase, output);
}

async function handleAssemblyCompletion(
  supabase: any,
  output: any,
  stageData: any,
  stageId: string,
  prediction: any,
  result: any,
  metrics: any
) {
  // andreasjansson/video-stitcher returns a single URL string
  // Handle both string and array outputs defensively
  const videoUrl = Array.isArray(result) ? result[0] : result;
  
  if (!videoUrl) {
    throw new Error('No video URL in assembly result');
  }
  
  // Upload to user's storage
  let permanentUrl = videoUrl;
  try {
    permanentUrl = await uploadToStorage(supabase, output.organization_id, videoUrl, 'video', output.id);
    console.log(`✅ Assembly uploaded to storage: ${permanentUrl}`);
  } catch (error) {
    console.error('⚠️ Storage upload failed, using temporary URL:', error);
  }
  
  await supabase.from('content_outputs').update({
    stage_data: {
      ...stageData,
      [stageId]: {
        ...stageData[stageId],
        url: permanentUrl,
        video_url: permanentUrl,
        status: 'completed',
        completed_at: new Date().toISOString(),
        metrics
      }
    }
  }).eq('id', output.id);
  
  console.log(`✅ Assembly completed, video URL: ${permanentUrl}`);

  // Mark stage complete so frontend displays final video
  await markStageComplete(supabase, output.id, stageId);

  // Auto-trigger Whisper transcription if subtitles are enabled
  await maybeAutoTriggerSubtitleTranscription(supabase, output);
}

/**
 * Auto-trigger subtitle pipeline after video assembly if subtitles are enabled on the blueprint.
 * Uses TTS alignment data (word_timestamps from ElevenLabs) when available — no Whisper needed.
 * Falls back to Whisper transcription only if no alignment data exists.
 */
async function maybeAutoTriggerSubtitleTranscription(supabase: any, output: any) {
  try {
    const genParams = output.generation_params || {};
    const blueprintId = genParams.blueprint_id;
    if (!blueprintId) return;

    const { data: blueprint } = await supabase
      .from('blueprints')
      .select('model_config')
      .eq('id', blueprintId)
      .single();

    if (!blueprint?.model_config?.subtitles_enabled) return;

    // Re-fetch latest stage_data
    const { data: freshOutput } = await supabase
      .from('content_outputs')
      .select('stage_data')
      .eq('id', output.id)
      .single();

    const stageData = freshOutput?.stage_data || {};
    const wordTimestamps = stageData.full_voiceover?.word_timestamps;

    if (wordTimestamps && wordTimestamps.length > 0) {
      // Fast path: build subtitle segments from TTS alignment data (no Whisper needed)
      console.log(`🎤 Subtitles enabled — building segments from ${wordTimestamps.length} TTS word timestamps (skipping Whisper)`);

      const segments = buildSubtitleSegments(wordTimestamps);

      await supabase.from('content_outputs').update({
        stage_data: {
          ...stageData,
          subtitle_transcription: {
            status: 'completed',
            words: wordTimestamps,
            segments,
            source: 'tts_alignment',
            completed_at: new Date().toISOString(),
          },
        },
      }).eq('id', output.id);

      console.log(`✅ Stored ${wordTimestamps.length} words, ${segments.length} segments from TTS alignment`);

      // Auto-trigger subtitle rendering
      await maybeAutoTriggerSubtitleRendering(supabase, output);
    } else {
      // Fallback: use Whisper transcription (for HeyGen, oneshot videos, or old TTS without timestamps)
      console.log(`🎤 Subtitles enabled — no TTS alignment, falling back to Whisper for output ${output.id}`);

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

      const response = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ output_id: output.id }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`✅ Whisper transcription auto-triggered: ${result.prediction_id}`);
      } else {
        const errorText = await response.text();
        console.error(`⚠️ Failed to auto-trigger transcription: ${errorText}`);
      }
    }
  } catch (error) {
    console.error(`⚠️ Error auto-triggering subtitle pipeline:`, error);
    // Non-fatal — video assembly succeeded, subtitles are optional
  }
}

/**
 * Build subtitle segments from word-level timestamps.
 * Groups words into ~6-word segments, breaking on sentence-ending punctuation.
 */
function buildSubtitleSegments(
  words: Array<{ word: string; start: number; end: number }>
): Array<{ id: number; text: string; start: number; end: number; words: Array<{ word: string; start: number; end: number }> }> {
  const segments: Array<{ id: number; text: string; start: number; end: number; words: typeof words }> = [];
  let currentSegment: typeof words = [];
  let segmentId = 0;

  for (let i = 0; i < words.length; i++) {
    currentSegment.push(words[i]);
    const isPunctuation = /[.!?]$/.test(words[i].word);
    const isGroupFull = currentSegment.length >= 6;
    const isLast = i === words.length - 1;

    if (isPunctuation || isGroupFull || isLast) {
      segments.push({
        id: segmentId++,
        text: currentSegment.map(w => w.word).join(' '),
        start: currentSegment[0].start,
        end: currentSegment[currentSegment.length - 1].end,
        words: [...currentSegment],
      });
      currentSegment = [];
    }
  }

  return segments;
}

/**
 * Handle Whisper transcription completion — store word-level timestamps
 */
async function handleWhisperTranscriptionCompletion(
  supabase: any,
  output: any,
  _stageData: any,
  _stageId: string,
  _prediction: any,
  result: any,
  _metrics: any
) {
  console.log(`🎤 Whisper transcription completed for output ${output.id}`);

  // Re-fetch latest stage_data
  const { data: freshOutput } = await supabase
    .from('content_outputs')
    .select('stage_data')
    .eq('id', output.id)
    .single();

  const stageData = freshOutput?.stage_data || {};

  // Parse Whisper output — incredibly-fast-whisper returns { text, chunks }
  // chunks: [{ text, timestamp: [start, end] }] with word-level when timestamp='word'
  const whisperOutput = typeof result === 'string' ? JSON.parse(result) : result;

  // Build word-level data from chunks
  const words: Array<{ word: string; start: number; end: number }> = [];
  const segments: Array<{ id: number; text: string; start: number; end: number; words: Array<{ word: string; start: number; end: number }> }> = [];

  if (whisperOutput.chunks) {
    // Word-level chunks from incredibly-fast-whisper
    for (const chunk of whisperOutput.chunks) {
      const word = chunk.text?.trim();
      if (!word) continue;
      const [start, end] = chunk.timestamp || [0, 0];
      words.push({ word, start, end });
    }
  } else if (whisperOutput.segments) {
    // Standard Whisper segment format with word_segments
    for (const seg of whisperOutput.segments) {
      if (seg.words) {
        for (const w of seg.words) {
          words.push({ word: w.word?.trim(), start: w.start, end: w.end });
        }
      }
    }
  }

  // Group words into sentence-like segments (by punctuation or ~6 word groups)
  let currentSegment: typeof words = [];
  let segmentId = 0;

  for (let i = 0; i < words.length; i++) {
    currentSegment.push(words[i]);
    const isPunctuation = /[.!?]$/.test(words[i].word);
    const isGroupFull = currentSegment.length >= 6;
    const isLast = i === words.length - 1;

    if (isPunctuation || isGroupFull || isLast) {
      segments.push({
        id: segmentId++,
        text: currentSegment.map(w => w.word).join(' '),
        start: currentSegment[0].start,
        end: currentSegment[currentSegment.length - 1].end,
        words: [...currentSegment],
      });
      currentSegment = [];
    }
  }

  // Store transcription data
  await supabase.from('content_outputs').update({
    stage_data: {
      ...stageData,
      subtitle_transcription: {
        status: 'completed',
        words,
        segments,
        source_audio_url: stageData.subtitle_transcription?.source_audio_url,
        completed_at: new Date().toISOString(),
      },
    },
  }).eq('id', output.id);

  console.log(`✅ Stored ${words.length} words, ${segments.length} segments for subtitles`);

  // Auto-trigger subtitle rendering if subtitles_enabled on blueprint
  await maybeAutoTriggerSubtitleRendering(supabase, output);
}

/**
 * Auto-trigger subtitle burn-in after transcription completes (if subtitles_enabled on blueprint)
 */
async function maybeAutoTriggerSubtitleRendering(supabase: any, output: any) {
  try {
    const genParams = output.generation_params || {};
    const blueprintId = genParams.blueprint_id;
    if (!blueprintId) return;

    const { data: blueprint } = await supabase
      .from('blueprints')
      .select('model_config')
      .eq('id', blueprintId)
      .single();

    if (!blueprint?.model_config?.subtitles_enabled) return;

    const templateId = blueprint.model_config.subtitle_template || genParams.subtitle_template || 'clean_white';

    console.log(`🔥 Subtitles enabled — auto-triggering burn-in with template "${templateId}" for output ${output.id}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const response = await fetch(`${supabaseUrl}/functions/v1/render-subtitles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ output_id: output.id, template_id: templateId }),
    });

    if (response.ok) {
      console.log(`✅ Subtitle rendering auto-triggered for output ${output.id}`);
    } else {
      const errorText = await response.text();
      console.error(`⚠️ Failed to auto-trigger subtitle rendering: ${errorText}`);
    }
  } catch (error) {
    console.error(`⚠️ Error auto-triggering subtitle rendering:`, error);
    // Non-fatal — transcription succeeded, rendering can be retried manually
  }
}

async function handleFailure(
  supabase: any,
  output: any,
  _stageData: any, // Not used directly - we re-fetch to avoid race conditions
  stageId: string,
  prediction: any,
  error: string
) {
  const errorMessage = parseReplicateError(error);

  // Re-fetch latest stage_data to avoid race conditions with concurrent webhook calls
  const { data: freshOutput } = await supabase
    .from('content_outputs')
    .select('stage_data, data')
    .eq('id', output.id)
    .single();

  const stageData = freshOutput?.stage_data || {};

  // Update the specific item with error
  if (prediction.item_type === 'image' || prediction.item_type === 'scene_image') {
    // Handle manual_image failure (ArticleLayout Featured Image)
    if (stageId === 'manual_image') {
      const currentData = freshOutput?.data || {};
      await supabase.from('content_outputs').update({
        status: 'review',
        data: {
          ...currentData,
          image_status: 'failed',
          image_error: errorMessage,
        },
        stage_data: {
          ...stageData,
          [stageId]: {
            ...stageData[stageId],
            status: 'failed',
            error: errorMessage,
            failed_at: new Date().toISOString()
          }
        }
      }).eq('id', output.id);
      console.log(`❌ Manual image generation failed: ${errorMessage}`);
      return;
    }

    const currentScenes = stageData[stageId]?.scenes || [];
    const currentSlides = stageData[stageId]?.slides || [];
    const hasScenes = currentScenes.length > 0 && prediction.scene_number !== undefined;
    const hasSlides = currentSlides.length > 0 && prediction.scene_number !== undefined;

    if (hasScenes) {
      // Scene-based image failure
      const updatedScenes = currentScenes.map((scene: any) => {
        if (scene.scene_number === prediction.scene_number || scene.prediction_id === prediction.prediction_id) {
          return {
            ...scene,
            status: 'failed',
            error: errorMessage,
            failed_at: new Date().toISOString()
          };
        }
        return scene;
      });

      await supabase.from('content_outputs').update({
        stage_data: {
          ...stageData,
          [stageId]: { ...stageData[stageId], scenes: updatedScenes }
        }
      }).eq('id', output.id);
    } else if (hasSlides) {
      // Carousel slide image failure
      const updatedSlides = currentSlides.map((slide: any) => {
        if (slide.slide_number === prediction.scene_number || slide.prediction_id === prediction.prediction_id) {
          return {
            ...slide,
            status: 'failed',
            error: errorMessage,
            failed_at: new Date().toISOString()
          };
        }
        return slide;
      });

      await supabase.from('content_outputs').update({
        stage_data: {
          ...stageData,
          [stageId]: { ...stageData[stageId], slides: updatedSlides }
        }
      }).eq('id', output.id);
    } else {
      // Single image failure (social_media_post)
      await supabase.from('content_outputs').update({
        stage_data: {
          ...stageData,
          [stageId]: {
            ...stageData[stageId],
            status: 'failed',
            error: errorMessage,
            failed_at: new Date().toISOString()
          }
        }
      }).eq('id', output.id);
    }
  } else if (prediction.item_type === 'carousel_slide') {
    // Carousel slide image failure
    const currentSlides = stageData[stageId]?.slides || [];
    const updatedSlides = currentSlides.map((slide: any) => {
      if (slide.slide_number === prediction.scene_number || slide.prediction_id === prediction.prediction_id) {
        return {
          ...slide,
          status: 'failed',
          error: errorMessage,
          failed_at: new Date().toISOString()
        };
      }
      return slide;
    });

    await supabase.from('content_outputs').update({
      stage_data: {
        ...stageData,
        [stageId]: { ...stageData[stageId], slides: updatedSlides }
      }
    }).eq('id', output.id);
  } else if (prediction.item_type === 'clip') {
    const currentClips = stageData[stageId]?.clips || [];
    const updatedClips = currentClips.map((clip: any) => {
      if (clip.scene_number === prediction.scene_number || clip.prediction_id === prediction.prediction_id) {
        return {
          ...clip,
          status: 'failed',
          error: errorMessage,
          failed_at: new Date().toISOString()
        };
      }
      return clip;
    });

    await supabase.from('content_outputs').update({
      stage_data: {
        ...stageData,
        [stageId]: { ...stageData[stageId], clips: updatedClips }
      }
    }).eq('id', output.id);
  } else {
    // Single video/assembly failure
    await supabase.from('content_outputs').update({
      stage_data: {
        ...stageData,
        [stageId]: {
          ...stageData[stageId],
          status: 'failed',
          error: errorMessage,
          failed_at: new Date().toISOString()
        }
      }
    }).eq('id', output.id);
  }
  
  console.log(`❌ Item marked as failed`);
}

async function markStageComplete(supabase: any, outputId: string, stageId: string) {
  console.log(`✅ Stage ${stageId} complete for output ${outputId}`);

  // Fetch current output with generation_params to check auto_approve_all setting
  const { data: output } = await supabase
    .from('content_outputs')
    .select('stage_data, autopilot_id, generation_params')
    .eq('id', outputId)
    .single();

  if (!output) return;

  // Check if we should auto-approve:
  // 1. Autopilot jobs always auto-approve
  // 2. Jobs with auto_approve_all=true in generation_params auto-approve
  const shouldAutoApprove = output.autopilot_id || output.generation_params?.auto_approve_all;

  if (shouldAutoApprove) {
    const autoApproveSource = output.autopilot_id ? 'Autopilot' : 'AutoApproveAll';
    console.log(`🤖 [${autoApproveSource}] Auto-approving async stage ${stageId}`);

    try {
      const { error: approveError } = await supabase.functions.invoke('approve-stage', {
        body: {
          output_id: outputId,
          stage_id: stageId,
          action: 'approve',
          is_automated: true,
          autopilot_id: output.autopilot_id
        }
      });

      if (approveError) {
        console.error(`❌ [${autoApproveSource}] Auto-advance failed for stage ${stageId}:`, approveError);
        // Fall back to ready status so user can manually trigger next stage
        const stageInfo = output.stage_data[stageId];
        await supabase.from('content_outputs').update({
          status: 'review',
          stage_data: {
            ...output.stage_data,
            [stageId]: {
              ...stageInfo,
              status: 'ready',
              completed_at: new Date().toISOString()
            }
          }
        }).eq('id', outputId);
      } else {
        console.log(`✅ [${autoApproveSource}] Stage ${stageId} auto-advanced to next stage`);
      }
    } catch (autoApproveError) {
      console.error(`❌ [${autoApproveSource}] Auto-advance exception for stage ${stageId}:`, autoApproveError);
      // Fall back to ready status
      const stageInfo = output.stage_data[stageId];
      await supabase.from('content_outputs').update({
        status: 'review',
        stage_data: {
          ...output.stage_data,
          [stageId]: {
            ...stageInfo,
            status: 'ready',
            completed_at: new Date().toISOString()
          }
        }
      }).eq('id', outputId);
    }
  } else {
    // Manual approval required - set stage to 'ready' and wait for user
    console.log(`⏸️ Stage ${stageId} requires manual approval - setting to ready`);
    const stageInfo = output.stage_data[stageId];
    await supabase.from('content_outputs').update({
      status: 'review',
      stage_data: {
        ...output.stage_data,
        [stageId]: {
          ...stageInfo,
          status: 'ready',
          completed_at: new Date().toISOString()
        }
      }
    }).eq('id', outputId);
  }

  console.log(`✅ Stage ${stageId} processing complete`);
}

async function uploadToStorage(
  supabase: any,
  organizationId: string,
  temporaryUrl: string,
  mediaType: 'image' | 'video',
  outputId: string
): Promise<string> {
  // Get organization's storage credentials
  const { data: credentials } = await supabase
    .from('storage_credentials')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .single();

  if (!credentials) {
    // Self-hosted: the shared module stores it in the install's own Supabase Storage.
    if (SELF_HOSTED) return await uploadToByokStorage(supabase, organizationId, temporaryUrl, mediaType, outputId);
    throw new Error('No active storage credentials found');
  }

  // Decrypt and parse the credentials
  let parsedCreds: any;
  try {
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    // Check if credentials are encrypted (hex:hex:hex format) or plain JSON
    const credValue = credentials.credentials_encrypted;
    if (credValue.includes(':') && !credValue.startsWith('{')) {
      // Encrypted format: ivHex:authTagHex:encryptedHex
      const decryptedJson = await decryptCredentials(credValue, encryptionKey);
      parsedCreds = JSON.parse(decryptedJson);
      console.log(`📦 Decrypted credentials for ${credentials.provider}`);
    } else {
      // Plain JSON format (legacy)
      parsedCreds = JSON.parse(credValue);
      console.log(`📦 Parsed plain credentials for ${credentials.provider}`);
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Unknown error';
    throw new Error(`Failed to decrypt/parse storage credentials: ${errorMsg}`);
  }

  // Download the file from temporary URL
  console.log(`⬇️ Downloading ${mediaType} from ${temporaryUrl}`);
  const response = await fetch(temporaryUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${mediaType}: ${response.statusText}`);
  }
  const fileBlob = await response.blob();

  // Generate storage path
  const extension = mediaType === 'video' ? 'mp4' : 'png';
  const timestamp = Date.now();
  const filename = `${outputId}_${timestamp}.${extension}`;
  const storagePath = `content-outputs/${mediaType}s/${filename}`;

  // Upload to appropriate storage provider
  let publicUrl: string;
  
  if (credentials.provider === 'cloudflare_r2') {
    publicUrl = await uploadToCloudflareR2(credentials, parsedCreds, storagePath, fileBlob, mediaType);
  } else if (credentials.provider === 'backblaze_b2') {
    publicUrl = await uploadToBackblazeB2(credentials, parsedCreds, storagePath, fileBlob, mediaType);
  } else if (credentials.provider === 'aws_s3') {
    publicUrl = await uploadToAwsS3(credentials, parsedCreds, storagePath, fileBlob, mediaType);
  } else {
    throw new Error(`Unsupported storage provider: ${credentials.provider}`);
  }

  console.log(`✅ Uploaded to ${credentials.provider}: ${publicUrl}`);
  return publicUrl;
}

async function uploadToCloudflareR2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  mediaType: string
): Promise<string> {
  const accountId = parsedCreds.accountId;
  const bucketName = credentials.bucket_name || parsedCreds.bucketName;
  const accessKeyId = parsedCreds.accessKeyId;
  const secretAccessKey = parsedCreds.secretAccessKey;

  console.log(`🔐 R2 Upload Debug:
    - accountId: ${accountId}
    - bucketName: ${bucketName}
    - accessKeyId: ${accessKeyId ? `${accessKeyId.length} chars` : 'MISSING'}
    - secretAccessKey: ${secretAccessKey ? `${secretAccessKey.length} chars` : 'MISSING'}
    - path: ${path}
    - blobSize: ${data.size} bytes`);

  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
    throw new Error(`Missing R2 credentials: accountId=${!!accountId}, bucket=${!!bucketName}, key=${!!accessKeyId}, secret=${!!secretAccessKey}`);
  }

  // AWS Signature V4 implementation for R2
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucketName}/${path}`;
  const contentType = mediaType === 'video' ? 'video/mp4' : 'image/webp';
  const region = 'auto';
  const service = 's3';
  const method = 'PUT';

  // Create date strings
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  // Hash the payload
  const encoder = new TextEncoder();
  const payloadBytes = new Uint8Array(await data.arrayBuffer());
  const payloadHash = await sha256Hex(payloadBytes);

  // Create canonical request
  const canonicalUri = `/${bucketName}/${path}`;
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  // Create string to sign
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(encoder.encode(canonicalRequest));
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  // Calculate signature
  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  // Create authorization header
  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  console.log(`⬆️ Uploading to R2: ${url}`);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authorizationHeader,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: data,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ R2 upload failed (${response.status}):`, errorText);
    throw new Error(`R2 upload failed: ${response.status} - ${response.statusText} - ${errorText}`);
  }

  console.log(`✅ R2 upload succeeded!`);

  // Use public_url from top-level column
  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

async function uploadToBackblazeB2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  mediaType: string
): Promise<string> {
  const keyId = parsedCreds.keyId;
  const applicationKey = parsedCreds.applicationKey;
  const bucketId = parsedCreds.bucketId;
  
  // Authorize
  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: {
      'Authorization': `Basic ${btoa(`${keyId}:${applicationKey}`)}`,
    },
  });
  const authData = await authResponse.json();
  
  // Get upload URL
  const uploadUrlResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: {
      'Authorization': authData.authorizationToken,
    },
    body: JSON.stringify({ bucketId }),
  });
  const uploadUrlData = await uploadUrlResponse.json();
  
  // Upload file
  const contentType = mediaType === 'video' ? 'video/mp4' : 'image/png';
  const uploadResponse = await fetch(uploadUrlData.uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': uploadUrlData.authorizationToken,
      'Content-Type': contentType,
      'X-Bz-File-Name': encodeURIComponent(path),
      'X-Bz-Content-Sha1': 'do_not_verify',
    },
    body: data,
  });
  
  if (!uploadResponse.ok) {
    throw new Error(`B2 upload failed: ${uploadResponse.statusText}`);
  }
  
  const uploadData = await uploadResponse.json();
  return credentials.public_url ? `${credentials.public_url}/${path}` : uploadData.fileUrl;
}

async function uploadToAwsS3(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  mediaType: string
): Promise<string> {
  const accessKeyId = parsedCreds.accessKeyId;
  const secretAccessKey = parsedCreds.secretAccessKey;
  const bucketName = credentials.bucket_name || parsedCreds.bucketName;
  const region = parsedCreds.region || 'us-east-1';

  // AWS Signature V4 implementation for S3
  // For S3 virtual-hosted style, bucket is in the hostname
  const host = `${bucketName}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${path}`;
  const contentType = mediaType === 'video' ? 'video/mp4' : 'image/webp';
  const service = 's3';
  const method = 'PUT';
  const acl = 'public-read'; // Make uploaded objects publicly readable

  // Create date strings
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  // Hash the payload
  const encoder = new TextEncoder();
  const payloadBytes = new Uint8Array(await data.arrayBuffer());
  const payloadHash = await sha256Hex(payloadBytes);

  // Create canonical request (headers must be in alphabetical order)
  const canonicalUri = `/${path}`;
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-acl:${acl}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-acl;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  // Create string to sign
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(encoder.encode(canonicalRequest));
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  // Calculate signature
  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  // Create authorization header
  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  console.log(`⬆️ Uploading to S3: ${url}`);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authorizationHeader,
      'Content-Type': contentType,
      'x-amz-acl': acl,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: data,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ S3 upload failed (${response.status}):`, errorText);
    throw new Error(`S3 upload failed: ${response.status} - ${response.statusText} - ${errorText}`);
  }

  console.log(`✅ S3 upload succeeded with public-read ACL`);
  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

function parseReplicateError(error: string): string {
  if (!error) return 'Generation failed';
  
  if (error.includes('E005') || error.includes('flagged as sensitive') || error.includes('content moderation')) {
    return 'Content flagged: Your prompt contains content filtered by AI safety systems. Try rephrasing - avoid terms like "Clone", "deepfake", or celebrity names.';
  }
  
  if (error.includes('NSFW')) {
    return 'NSFW content detected: Please use appropriate content in your prompts.';
  }
  
  if (error.includes('timeout') || error.includes('timed out')) {
    return 'Generation timed out: The model took too long to respond. Try again or use a shorter prompt.';
  }
  
  if (error.includes('out of memory') || error.includes('OOM')) {
    return 'Out of memory: Try reducing image resolution or video duration.';
  }

  if (error.includes('429') || error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('too many requests')) {
    return 'Rate limit reached: Too many requests to the AI service. Please wait a moment and try again.';
  }

  return error.length > 200 ? `${error.substring(0, 200)}...` : error;
}

// Decrypt credentials using AES-GCM
// Supports two formats:
// 1. Base64 format (new): IV + ciphertext combined in base64
// 2. Hex with colons format (legacy): ivHex:authTagHex:encryptedHex
async function decryptCredentials(encryptedData: string, encryptionKeyHex: string): Promise<string> {
  const keyData = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

  // Check if it's the legacy hex:colons format (contains exactly 2 colons)
  const parts = encryptedData.split(':');
  if (parts.length === 3 && parts.every(p => /^[0-9a-fA-F]+$/.test(p))) {
    // Legacy format: ivHex:authTagHex:encryptedHex
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const authTag = new Uint8Array(authTagHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const encrypted = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        key,
        new Uint8Array([...encrypted, ...authTag])
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      throw new Error('Decryption failed — the encryption key may have been rotated. Please delete this storage credential and re-add it.');
    }
  }

  // New format: Base64 encoded (IV + ciphertext combined)
  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}
