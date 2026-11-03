import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Decrypt API key using AES-256-GCM
async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  try {
    // Convert hex encryption key to bytes
    const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

    // Import the crypto key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Decode base64 and extract IV + ciphertext
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    // Decrypt
    const decryptedBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );

    return new TextDecoder().decode(decryptedBytes);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt API key');
  }
}


/**
 * Video Assembly Edge Function
 *
 * NEW SIMPLIFIED FLOW (for storyboard_video_longform with full_voiceover):
 * Phase 1: Concatenate all video clips (preserve original video audio)
 *          - If audio_duration > video_duration, loop the last clip to cover the gap
 * Phase 2: Overlay single voiceover on the concatenated video
 *
 * LEGACY FLOW (for per-scene audio - deprecated):
 * Phase 1: Launch N video-audio-merge predictions (one per clip+audio pair)
 * Phase 2: When all merges complete, webhook triggers final video-merge concatenation
 *
 * Expected input:
 * {
 *   clips: string[], // Array of video URLs
 *   audio_url?: string, // Single voiceover audio URL (new flow)
 *   audio_duration?: number, // Duration of voiceover in seconds (for looping calculation)
 *   clip_duration?: number, // Duration of each clip in seconds (default: 5)
 *   audio_segments?: Array<{scene_number: number, audio_url: string, duration: number}>, // Per-scene audio (legacy)
 *   sync_mode?: 'single' | 'per_clip', // Audio sync mode - 'single' for new flow
 *   output_id: string, // For tracking
 *   organization_id: string,
 *   phase?: 'concatenate' | 'overlay_audio', // Internal: which phase to execute
 *   concatenated_video_url?: string // Internal: result from phase 1 for phase 2
 * }
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Internal-only (execute-stage, generation-completion-webhook, heygen-webhook all send the
  // service key). Deployed with verify_jwt=false, so without this anyone could spend any
  // org's Replicate key by passing its organization_id.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || req.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const {
      clips,
      audio_url,
      audio_duration,
      clip_duration,
      audio_segments,
      sync_mode,
      output_id,
      organization_id,
      phase,
      concatenated_video_url,
      target_stage_id, // Override stage_id for pending_prediction (default: 'final')
      aspect_ratio, // Video aspect ratio for resolution: 'portrait' | 'landscape' | 'square'
    } = await req.json();

    // Derive resolution from aspect ratio for consistent output quality
    const getVideoResolution = (ar?: string) => {
      switch (ar) {
        case 'portrait': case '9:16': return { width: 1080, height: 1920, fps: 30 };
        case 'square': case '1:1': return { width: 1080, height: 1080, fps: 30 };
        case 'landscape': case '16:9': default: return { width: 1920, height: 1080, fps: 30 };
      }
    };
    const videoRes = getVideoResolution(aspect_ratio);

    if (!organization_id) {
      throw new Error('organization_id is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Replicate API key
    console.log('Fetching Replicate API key...');
    const { data: apiKeyData, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', organization_id)
      .eq('provider', 'replicate')
      .single();

    if (apiKeyError || !apiKeyData?.key_encrypted) {
      throw new Error('Replicate API key not found. Please add your Replicate API key in settings.');
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    const replicateApiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
    const webhookUrl = `${supabaseUrl}/functions/v1/generation-completion-webhook`;

    // ========== PHASE 2: Overlay voiceover on concatenated video ==========
    if (phase === 'overlay_audio' && concatenated_video_url && audio_url) {
      console.log(`=== PHASE 2: Overlaying voiceover on concatenated video ===`);
      console.log(`Video: ${concatenated_video_url}`);
      console.log(`Audio: ${audio_url}`);

      const response = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${replicateApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: 'lucataco/video-audio-merge:8c3d57c9c9a1aaa05feabafbcd2dff9f68a5cb394e54ec020c1c2dcc42bde109',
          input: {
            video_file: concatenated_video_url,
            audio_file: audio_url,
            duration_mode: 'video',      // Keep video duration, trim audio if longer
            replace_audio: true,          // REPLACE AI-generated noise with clean voiceover
            audio_volume: 1,              // Voiceover at full volume
            output_format: 'mp4',
            video_codec: 'h264',
            audio_codec: 'aac'
          },
          webhook: webhookUrl,
          webhook_events_filter: ["completed"]
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Replicate API error: ${response.status} - ${errorText}`);
      }

      const prediction = await response.json();
      console.log('Audio overlay prediction started:', prediction.id);

      // Track the final assembly prediction
      if (output_id) {
        const { data: outputData } = await supabase
          .from('content_outputs')
          .select('generation_params')
          .eq('id', output_id)
          .single();

        const pendingPredictions = outputData?.generation_params?.pending_predictions || [];
        pendingPredictions.push({
          prediction_id: prediction.id,
          stage_id: target_stage_id || 'final',
          item_type: 'audio_overlay',
          started_at: new Date().toISOString()
        });

        await supabase.from('content_outputs').update({
          generation_params: {
            ...outputData?.generation_params,
            pending_predictions: pendingPredictions,
            // Clear intermediate data
            concatenated_video_url: undefined
          }
        }).eq('id', output_id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          status: 'overlaying_audio',
          prediction_id: prediction.id,
          message: 'Audio overlay started - final step'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== PHASE 1: Concatenate clips ==========
    if (!clips || !Array.isArray(clips) || clips.length === 0) {
      throw new Error('clips array is required and must not be empty');
    }

    const hasSingleVoiceover = sync_mode === 'single' && audio_url;
    const hasPerSceneAudio = sync_mode === 'per_clip' && audio_segments && audio_segments.length > 0;

    console.log(`Assembling ${clips.length} video clips`);
    console.log(`Audio mode: ${hasSingleVoiceover ? 'single voiceover' : (hasPerSceneAudio ? 'per-scene segments (legacy)' : 'no audio')}`);

    // ========== NEW FLOW: Single voiceover ==========
    if (hasSingleVoiceover) {
      console.log('=== PHASE 1: Concatenating clips (will overlay audio after) ===');

      // Calculate if we need to loop the last clip to cover the audio duration
      const perClipDuration = clip_duration || 5; // Default to 5s if not specified
      const totalVideoDuration = clips.length * perClipDuration;
      const audioDur = audio_duration || 0;

      let clipsToConcat = [...clips];

      if (audioDur > 0 && audioDur > totalVideoDuration) {
        // Need to loop the last clip to cover the gap
        const gap = audioDur - totalVideoDuration;
        const loopsNeeded = Math.ceil(gap / perClipDuration);
        const lastClip = clips[clips.length - 1];

        console.log(`Audio (${audioDur}s) > Video (${totalVideoDuration}s). Gap: ${gap}s. Looping last clip ${loopsNeeded} time(s).`);

        for (let i = 0; i < loopsNeeded; i++) {
          clipsToConcat.push(lastClip);
        }

        console.log(`Total clips after looping: ${clipsToConcat.length} (was ${clips.length})`);
      } else {
        console.log(`Video duration (${totalVideoDuration}s) covers audio (${audioDur}s). No looping needed.`);
      }

      const input = {
        video_files: clipsToConcat,
        fps: videoRes.fps,
        width: videoRes.width,
        height: videoRes.height,
        keep_audio: false  // Strip AI-generated noise — voiceover will be overlaid in Phase 2
      };

      const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${replicateApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: 'lucataco/video-merge:14273448a57117b5d424410e2e79700ecde6cc7d60bf522a769b9c7cf989eba7',
          input,
          webhook: webhookUrl,
          webhook_events_filter: ["completed"]
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Replicate API error: ${createResponse.status} - ${errorText}`);
      }

      const prediction = await createResponse.json();
      console.log('Concatenation prediction started:', prediction.id);

      // Store context for Phase 2
      if (output_id) {
        const { data: outputData } = await supabase
          .from('content_outputs')
          .select('generation_params')
          .eq('id', output_id)
          .single();

        const pendingPredictions = outputData?.generation_params?.pending_predictions || [];
        pendingPredictions.push({
          prediction_id: prediction.id,
          stage_id: target_stage_id || 'final',
          item_type: 'concatenation',  // Webhook will detect this and trigger Phase 2
          started_at: new Date().toISOString()
        });

        await supabase.from('content_outputs').update({
          generation_params: {
            ...outputData?.generation_params,
            pending_predictions: pendingPredictions,
            // Store audio URL for Phase 2
            voiceover_audio_url: audio_url,
            assembly_mode: 'single_voiceover'
          }
        }).eq('id', output_id);
      }

      const finalVideoDuration = clipsToConcat.length * perClipDuration;
      const looped = clipsToConcat.length > clips.length;

      return new Response(
        JSON.stringify({
          success: true,
          status: 'concatenating',
          prediction_id: prediction.id,
          estimated_duration: finalVideoDuration,
          clips_count: clipsToConcat.length,
          original_clips_count: clips.length,
          audio_mode: 'single_voiceover',
          looped: looped,
          message: looped
            ? `Concatenation started with ${clipsToConcat.length - clips.length} looped clip(s) - audio overlay will follow`
            : 'Concatenation started - audio overlay will follow'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== LEGACY FLOW: Per-scene audio (deprecated) ==========
    if (hasPerSceneAudio) {
      console.log('=== LEGACY: Per-scene audio merge flow ===');
      console.log('WARNING: This flow is deprecated. Use single voiceover mode for new implementations.');

      const pendingPredictions: any[] = [];
      let mergeCount = 0;

      // Initialize merged_clips array with original clips (fallback for scenes without audio)
      const initialMergedClips = [...clips];

      for (let i = 0; i < clips.length; i++) {
        const clipUrl = clips[i];
        const audioSegment = audio_segments[i];

        if (audioSegment && audioSegment.audio_url) {
          const sceneNumber = audioSegment.scene_number || (i + 1);

          const response = await fetch('https://api.replicate.com/v1/predictions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${replicateApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              version: 'lucataco/video-audio-merge:8c3d57c9c9a1aaa05feabafbcd2dff9f68a5cb394e54ec020c1c2dcc42bde109',
              input: {
                video_file: clipUrl,
                audio_file: audioSegment.audio_url,
                duration_mode: 'video',     // Changed from 'audio' - keep video duration
                replace_audio: false,        // Keep video sounds
                audio_volume: 1,
                output_format: 'mp4',
                video_codec: 'h264',
                audio_codec: 'aac'
              },
              webhook: webhookUrl,
              webhook_events_filter: ["completed"]
            }),
          });

          if (!response.ok) {
            console.error(`Failed to create audio merge for scene ${sceneNumber}`);
            continue;
          }

          const prediction = await response.json();
          console.log(`Scene ${sceneNumber} audio merge started: ${prediction.id}`);

          pendingPredictions.push({
            prediction_id: prediction.id,
            stage_id: target_stage_id || 'final',
            item_type: 'audio_merge',
            scene_number: sceneNumber,
            clip_index: i,
            started_at: new Date().toISOString()
          });
          mergeCount++;
        } else {
          console.log(`Scene ${i + 1}: No audio, will use original clip`);
        }
      }

      // Store tracking info for webhook to use
      if (output_id) {
        const { data: outputData } = await supabase
          .from('content_outputs')
          .select('generation_params')
          .eq('id', output_id)
          .single();

        const existingPredictions = outputData?.generation_params?.pending_predictions || [];

        await supabase.from('content_outputs').update({
          generation_params: {
            ...outputData?.generation_params,
            pending_predictions: [...existingPredictions, ...pendingPredictions],
            // Store assembly context for webhook to use when all merges complete
            merged_clips: initialMergedClips,
            total_audio_merges: mergeCount,
            completed_audio_merges: 0,
            original_clips: clips,
            audio_segments: audio_segments,
            assembly_mode: 'per_scene'
          }
        }).eq('id', output_id);
      }

      const totalDuration = clips.length * 8;
      const estimatedCost = mergeCount * 0.01 + (totalDuration / 60) * 0.01;

      return new Response(
        JSON.stringify({
          success: true,
          status: 'merging_audio',
          audio_merges_started: mergeCount,
          clips_count: clips.length,
          estimated_cost: estimatedCost,
          message: `Started ${mergeCount} audio merge jobs - will concatenate when complete`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== NO AUDIO: Direct concatenation ==========
    console.log('=== No audio, proceeding directly to concatenation ===');

    const input = {
      video_files: clips,
      fps: videoRes.fps,
      width: videoRes.width,
      height: videoRes.height,
      keep_audio: true  // No voiceover — preserve original clip audio
    };

    const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${replicateApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: 'lucataco/video-merge:14273448a57117b5d424410e2e79700ecde6cc7d60bf522a769b9c7cf989eba7',
        input,
        webhook: webhookUrl,
        webhook_events_filter: ["completed"]
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Replicate API error: ${createResponse.status} - ${errorText}`);
    }

    const prediction = await createResponse.json();
    console.log('Concatenation prediction started:', prediction.id);

    if (output_id) {
      const { data: outputData } = await supabase
        .from('content_outputs')
        .select('generation_params')
        .eq('id', output_id)
        .single();

      const pendingPredictions = outputData?.generation_params?.pending_predictions || [];
      pendingPredictions.push({
        prediction_id: prediction.id,
        stage_id: target_stage_id || 'final',
        item_type: 'assembly',
        started_at: new Date().toISOString()
      });

      await supabase.from('content_outputs').update({
        generation_params: {
          ...outputData?.generation_params,
          pending_predictions: pendingPredictions,
          assembly_mode: 'no_audio'
        }
      }).eq('id', output_id);
    }

    const totalDuration = clips.length * 8;

    return new Response(
      JSON.stringify({
        success: true,
        status: 'processing',
        prediction_id: prediction.id,
        estimated_duration: totalDuration,
        clips_count: clips.length,
        audio_mode: 'none',
        message: 'Assembly started - will complete via webhook'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Assembly error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during assembly',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
