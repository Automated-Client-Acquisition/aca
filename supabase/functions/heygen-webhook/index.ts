import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { decryptApiKey } from '../_shared/llm-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Verify HeyGen webhook signature using HMAC-SHA256.
 * HeyGen sends the signature in the `Signature` header as a hex string.
 * We compute HMAC-SHA256(secret, rawBody) and compare.
 */
async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return computed === signature;
}

async function confirmVideoEventWithHeyGen(supabase: any, eventType: string, eventData: any): Promise<boolean> {
  const videoId = eventData?.video_id;
  const outputId = typeof eventData?.callback_id === 'string' ? eventData.callback_id.split(':')[0] : null;
  if (!videoId || !outputId) return false;

  const { data: output } = await supabase
    .from('content_outputs')
    .select('organization_id')
    .eq('id', outputId)
    .maybeSingle();
  if (!output?.organization_id) return false;

  const { data: keyRow } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', output.organization_id)
    .eq('provider', 'heygen')
    .limit(1)
    .maybeSingle();
  if (!keyRow?.key_encrypted) return false;

  const res = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
    headers: { 'X-Api-Key': await decryptApiKey(keyRow.key_encrypted) },
  });
  if (!res.ok) return false;
  const data = (await res.json())?.data;

  if (eventType === 'avatar_video.success') {
    if (data?.status !== 'completed' || !data?.video_url) return false;
    eventData.url = data.video_url;
    eventData.video_url = data.video_url;
    if (data.duration != null) eventData.duration = data.duration;
    return true;
  }
  return data?.status === 'failed';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Read raw body for signature verification
    const rawBody = await req.text();
    const signature = req.headers.get('Signature') || req.headers.get('signature') || '';

    // Verify webhook signature against stored secrets (multi-tenant: check all org secrets)
    let verified = false;
    if (signature) {
      const { data: endpoints } = await supabase
        .from('heygen_webhook_endpoints')
        .select('secret, organization_id')
        .eq('status', 'enabled');
      for (const endpoint of endpoints || []) {
        if (await verifyWebhookSignature(rawBody, signature, endpoint.secret)) {
          verified = true;
          break;
        }
      }
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload.event_type;
    const eventData = payload.event_data || payload.data || payload;

    console.log(`🎬 HeyGen webhook received: event=${eventType}`);

    // Unsigned or badly signed: never trust the body. Video events are confirmed against
    // HeyGen's API with the org's own key (and the URL taken from HeyGen); anything else
    // is rejected.
    if (!verified) {
      const confirmed = (eventType === 'avatar_video.success' || eventType === 'avatar_video.fail')
        && await confirmVideoEventWithHeyGen(supabase, eventType, eventData);
      if (!confirmed) {
        console.warn(`HeyGen webhook rejected: unverified ${eventType}`);
        return new Response(JSON.stringify({ error: 'Unverified webhook' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    console.log(`   Payload keys: ${Object.keys(payload).join(', ')}`);

    switch (eventType) {
      case 'avatar_video.success':
        await handleVideoSuccess(supabase, eventData);
        break;

      case 'avatar_video.fail':
        await handleVideoFailure(supabase, eventData);
        break;

      case 'photo_avatar_train.success':
        await handleAvatarTrainingSuccess(supabase, eventData);
        break;

      case 'photo_avatar_train.fail':
        await handleAvatarTrainingFailure(supabase, eventData);
        break;

      default:
        console.log(`⚠️ Unhandled HeyGen webhook event: ${eventType}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('HeyGen webhook error:', error);
    // Return 200 even on error to prevent HeyGen from retrying
    return new Response(JSON.stringify({ error: 'Internal processing error' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ─── Video Generation Success ────────────────────────────────────────────────

async function handleVideoSuccess(supabase: any, eventData: any) {
  const videoId = eventData.video_id;
  const videoUrl = eventData.url || eventData.video_url;
  const callbackId = eventData.callback_id;
  const duration = eventData.duration;

  console.log(`✅ HeyGen video completed: ${videoId}, callback=${callbackId}, url=${videoUrl ? 'present' : 'missing'}`);

  if (!videoUrl) {
    console.error('No video URL in success payload');
    return;
  }

  // Parse callback_id — formats:
  //   Single video:   "outputId:stageId"
  //   Multi-segment:  "outputId:stageId:segmentIndex"
  let outputId: string | undefined;
  let stageId: string | undefined;
  let segmentIndex: number | undefined;
  let outputRecord: any;

  if (callbackId && callbackId.includes(':')) {
    const parts = callbackId.split(':');
    outputId = parts[0];
    stageId = parts[1];
    if (parts.length >= 3 && !isNaN(Number(parts[2]))) {
      segmentIndex = Number(parts[2]);
    }
    const { data } = await supabase
      .from('content_outputs')
      .select('*')
      .eq('id', outputId)
      .single();
    outputRecord = data;
  }

  // Fallback: search by video_id in pending_predictions
  if (!outputRecord) {
    console.log(`Callback lookup failed, searching pending_predictions for video_id=${videoId}`);
    const { data: outputs } = await supabase
      .from('content_outputs')
      .select('*')
      .in('status', ['generating', 'review']);

    outputRecord = outputs?.find((out: any) => {
      const pending = out.generation_params?.pending_predictions || [];
      return pending.some((p: any) => p.prediction_id === videoId);
    });

    if (outputRecord) {
      const prediction = (outputRecord.generation_params?.pending_predictions || [])
        .find((p: any) => p.prediction_id === videoId);
      stageId = prediction?.stage_id;
      outputId = outputRecord.id;
      if (prediction?.extra_data?.segment_index !== undefined) {
        segmentIndex = prediction.extra_data.segment_index;
      }
    }
  }

  if (!outputRecord || !stageId) {
    console.error(`Could not find output for video ${videoId} / callback ${callbackId}`);
    return;
  }

  // Check if this is a multi-segment video
  const multiSegment = outputRecord.generation_params?.heygen_multi_segment;
  const isMultiSegment = multiSegment && segmentIndex !== undefined;

  try {
    // Download video from HeyGen's temporary URL and upload to org storage
    const storageSuffix = isMultiSegment ? `_seg${segmentIndex}` : '';
    const permanentUrl = await uploadToStorage(
      supabase,
      outputRecord.organization_id,
      videoUrl,
      'video',
      `${outputId}${storageSuffix}`
    );

    console.log(`✅ Video stored permanently: ${permanentUrl}${isMultiSegment ? ` (segment ${segmentIndex! + 1}/${multiSegment.total_segments})` : ''}`);

    // Remove from pending_predictions
    await removePendingPrediction(supabase, outputId!, videoId);

    if (isMultiSegment) {
      // ── Multi-segment: store URL in segment_video_urls array ──
      const { data: freshOutput } = await supabase
        .from('content_outputs')
        .select('stage_data, generation_params')
        .eq('id', outputId)
        .single();

      const genParams = freshOutput?.generation_params || {};
      const segMeta = genParams.heygen_multi_segment || {};
      const segmentUrls = [...(segMeta.segment_video_urls || [])];
      segmentUrls[segmentIndex!] = permanentUrl;

      // Update generation_params with the segment URL
      await supabase.from('content_outputs').update({
        generation_params: {
          ...genParams,
          heygen_multi_segment: {
            ...segMeta,
            segment_video_urls: segmentUrls,
          },
        },
      }).eq('id', outputId);

      // Check if ALL segments have completed
      const allDone = segmentUrls.length === segMeta.total_segments &&
        segmentUrls.every((url: any) => url !== null && url !== undefined);

      // Also check pending_predictions — no heygen_video items left for this stage
      const { data: checkOutput } = await supabase
        .from('content_outputs')
        .select('generation_params')
        .eq('id', outputId)
        .single();
      const remainingHeygen = (checkOutput?.generation_params?.pending_predictions || [])
        .filter((p: any) => p.stage_id === stageId && p.item_type === 'heygen_video');

      if (allDone && remainingHeygen.length === 0) {
        console.log(`🎉 All ${segMeta.total_segments} HeyGen segments complete — starting assembly`);
        await assembleMultiSegmentVideo(supabase, outputId!, stageId, segmentUrls, outputRecord);
      } else {
        const completedCount = segmentUrls.filter((u: any) => u).length;
        console.log(`⏳ Segment ${segmentIndex! + 1} done, ${completedCount}/${segMeta.total_segments} complete, ${remainingHeygen.length} still pending`);
      }
    } else {
      // ── Single video: original flow ──
      const { data: freshOutput } = await supabase
        .from('content_outputs')
        .select('stage_data, generation_params')
        .eq('id', outputId)
        .single();

      const stageData = freshOutput?.stage_data || {};

      await supabase.from('content_outputs').update({
        stage_data: {
          ...stageData,
          [stageId]: {
            ...stageData[stageId],
            url: permanentUrl,
            video_url: permanentUrl,
            heygen_video_id: videoId,
            duration,
            status: 'ready',
            completed_at: new Date().toISOString(),
          },
        },
      }).eq('id', outputId);

      // Check if all predictions for this stage are done
      const { data: updatedOutput } = await supabase
        .from('content_outputs')
        .select('generation_params')
        .eq('id', outputId)
        .single();

      const remaining = (updatedOutput?.generation_params?.pending_predictions || [])
        .filter((p: any) => p.stage_id === stageId);

      if (remaining.length === 0) {
        console.log(`🎉 All items complete for stage ${stageId}`);
        await markStageComplete(supabase, outputId!, stageId);
      }
    }
  } catch (storageError) {
    console.error(`Failed to store video permanently:`, storageError);

    if (isMultiSegment) {
      // For multi-segment, use the temp URL as fallback for this segment
      const { data: freshOutput } = await supabase
        .from('content_outputs')
        .select('generation_params')
        .eq('id', outputId)
        .single();

      const genParams = freshOutput?.generation_params || {};
      const segMeta = genParams.heygen_multi_segment || {};
      const segmentUrls = [...(segMeta.segment_video_urls || [])];
      segmentUrls[segmentIndex!] = videoUrl; // Use temp URL as fallback

      await supabase.from('content_outputs').update({
        generation_params: {
          ...genParams,
          heygen_multi_segment: { ...segMeta, segment_video_urls: segmentUrls },
        },
      }).eq('id', outputId);

      await removePendingPrediction(supabase, outputId!, videoId);

      // Still check if all segments are done
      const allDone = segmentUrls.length === segMeta.total_segments &&
        segmentUrls.every((url: any) => url !== null && url !== undefined);
      const { data: checkOutput } = await supabase
        .from('content_outputs')
        .select('generation_params')
        .eq('id', outputId)
        .single();
      const remainingHeygen = (checkOutput?.generation_params?.pending_predictions || [])
        .filter((p: any) => p.stage_id === stageId && p.item_type === 'heygen_video');

      if (allDone && remainingHeygen.length === 0) {
        console.log(`🎉 All segments complete (with storage fallback) — starting assembly`);
        await assembleMultiSegmentVideo(supabase, outputId!, stageId, segmentUrls, outputRecord);
      }
    } else {
      // Single video fallback — original flow
      const { data: freshOutput } = await supabase
        .from('content_outputs')
        .select('stage_data')
        .eq('id', outputId)
        .single();

      const stageData = freshOutput?.stage_data || {};
      await supabase.from('content_outputs').update({
        stage_data: {
          ...stageData,
          [stageId]: {
            ...stageData[stageId],
            url: videoUrl,
            video_url: videoUrl,
            heygen_video_id: videoId,
            duration,
            status: 'ready',
            completed_at: new Date().toISOString(),
            storage_warning: 'Using temporary HeyGen URL — permanent storage upload failed',
          },
        },
      }).eq('id', outputId);

      await removePendingPrediction(supabase, outputId!, videoId);
      await markStageComplete(supabase, outputId!, stageId);
    }
  }
}

/**
 * Assemble multiple HeyGen video segments into a single video via assemble-video edge function.
 * Called when all segments have completed and been uploaded to storage.
 */
async function assembleMultiSegmentVideo(
  supabase: any,
  outputId: string,
  stageId: string,
  segmentUrls: string[],
  outputRecord: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

  console.log(`🔗 Assembling ${segmentUrls.length} HeyGen segments via assemble-video`);

  try {
    // Call assemble-video with no audio (HeyGen videos already have their own audio)
    const { data, error } = await supabase.functions.invoke('assemble-video', {
      body: {
        clips: segmentUrls,
        output_id: outputId,
        organization_id: outputRecord.organization_id,
        target_stage_id: stageId, // 'video' — so completion webhook updates the correct stage
        // No audio_url / audio_segments — HeyGen videos have audio baked in
      },
    });

    if (error) {
      throw new Error(`Assembly invocation failed: ${error.message}`);
    }

    console.log(`✅ Multi-segment assembly started:`, data);

    // Update stage_data to reflect assembly in progress
    const { data: freshOutput } = await supabase
      .from('content_outputs')
      .select('stage_data')
      .eq('id', outputId)
      .single();

    const stageData = freshOutput?.stage_data || {};
    await supabase.from('content_outputs').update({
      stage_data: {
        ...stageData,
        [stageId]: {
          ...stageData[stageId],
          status: 'generating',
          segments: segmentUrls.length,
          assembly_status: 'concatenating',
        },
      },
    }).eq('id', outputId);

    // Note: assemble-video creates its own pending_prediction (item_type: 'assembly')
    // which will be handled by generation-completion-webhook when Replicate finishes.
    // generation-completion-webhook will then call markStageComplete → approve-stage.
  } catch (assemblyError: any) {
    console.error('❌ Multi-segment assembly failed:', assemblyError);

    // Fallback: use the first segment URL so the user has something
    const { data: freshOutput } = await supabase
      .from('content_outputs')
      .select('stage_data')
      .eq('id', outputId)
      .single();

    const stageData = freshOutput?.stage_data || {};
    await supabase.from('content_outputs').update({
      status: 'failed',
      error_message: `Video segments generated but assembly failed: ${assemblyError.message}`,
      stage_data: {
        ...stageData,
        [stageId]: {
          ...stageData[stageId],
          status: 'failed',
          error: `Assembly failed: ${assemblyError.message}`,
          segment_urls: segmentUrls,
          url: segmentUrls[0], // Fallback: first segment
          video_url: segmentUrls[0],
        },
      },
    }).eq('id', outputId);
  }
}

// ─── Video Generation Failure ────────────────────────────────────────────────

async function handleVideoFailure(supabase: any, eventData: any) {
  const videoId = eventData.video_id;
  const callbackId = eventData.callback_id;
  const errorMessage = eventData.error || eventData.msg || 'Unknown HeyGen error';

  console.error(`❌ HeyGen video failed: ${videoId}, callback=${callbackId}, error=${errorMessage}`);

  let outputId: string | undefined;
  let stageId: string | undefined;
  let outputRecord: any;

  // Find by callback_id
  if (callbackId && callbackId.includes(':')) {
    [outputId, stageId] = callbackId.split(':');
    const { data } = await supabase
      .from('content_outputs')
      .select('*')
      .eq('id', outputId)
      .single();
    outputRecord = data;
  }

  // Fallback: search pending_predictions
  if (!outputRecord) {
    const { data: outputs } = await supabase
      .from('content_outputs')
      .select('*')
      .in('status', ['generating', 'review']);

    outputRecord = outputs?.find((out: any) => {
      const pending = out.generation_params?.pending_predictions || [];
      return pending.some((p: any) => p.prediction_id === videoId);
    });

    if (outputRecord) {
      const prediction = (outputRecord.generation_params?.pending_predictions || [])
        .find((p: any) => p.prediction_id === videoId);
      stageId = prediction?.stage_id;
      outputId = outputRecord.id;
    }
  }

  if (!outputRecord || !stageId) {
    console.error(`Could not find output for failed video ${videoId}`);
    return;
  }

  // Re-fetch fresh stage_data
  const { data: freshOutput } = await supabase
    .from('content_outputs')
    .select('stage_data')
    .eq('id', outputId)
    .single();

  const stageData = freshOutput?.stage_data || {};

  // Update stage with failure
  await supabase.from('content_outputs').update({
    status: 'failed',
    stage_data: {
      ...stageData,
      [stageId]: {
        ...stageData[stageId],
        status: 'failed',
        error: errorMessage,
        heygen_video_id: videoId,
        completed_at: new Date().toISOString(),
      },
    },
  }).eq('id', outputId);

  await removePendingPrediction(supabase, outputId!, videoId);
}

// ─── Avatar Training Success ─────────────────────────────────────────────────

async function handleAvatarTrainingSuccess(supabase: any, eventData: any) {
  const groupId = eventData.group_id || eventData.avatar_group_id;
  const avatarId = eventData.avatar_id || groupId; // group_id becomes the avatar_id

  console.log(`✅ HeyGen avatar training completed: group=${groupId}, avatar=${avatarId}`);

  if (!groupId) {
    console.error('No group_id in avatar training success payload');
    return;
  }

  // Find the character with this group_id
  const { data: characters, error } = await supabase
    .from('library_characters')
    .select('id, name')
    .eq('heygen_avatar_group_id', groupId);

  if (error || !characters?.length) {
    console.error(`No character found with heygen_avatar_group_id=${groupId}`);
    return;
  }

  // Update all matching characters (should be just one)
  for (const char of characters) {
    await supabase
      .from('library_characters')
      .update({
        heygen_avatar_status: 'ready',
        heygen_avatar_id: avatarId,
      })
      .eq('id', char.id);

    console.log(`✅ Character "${char.name}" avatar status updated to ready`);
  }
}

// ─── Avatar Training Failure ─────────────────────────────────────────────────

async function handleAvatarTrainingFailure(supabase: any, eventData: any) {
  const groupId = eventData.group_id || eventData.avatar_group_id;

  console.error(`❌ HeyGen avatar training failed: group=${groupId}`);

  if (!groupId) {
    console.error('No group_id in avatar training failure payload');
    return;
  }

  const { data: characters } = await supabase
    .from('library_characters')
    .select('id, name')
    .eq('heygen_avatar_group_id', groupId);

  if (!characters?.length) {
    console.error(`No character found with heygen_avatar_group_id=${groupId}`);
    return;
  }

  for (const char of characters) {
    await supabase
      .from('library_characters')
      .update({ heygen_avatar_status: 'failed' })
      .eq('id', char.id);

    console.log(`❌ Character "${char.name}" avatar status updated to failed`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function removePendingPrediction(supabase: any, outputId: string, predictionId: string) {
  // Re-fetch to avoid overwriting concurrent updates
  const { data: output } = await supabase
    .from('content_outputs')
    .select('generation_params')
    .eq('id', outputId)
    .single();

  if (!output) return;

  const remaining = (output.generation_params?.pending_predictions || [])
    .filter((p: any) => p.prediction_id !== predictionId);

  await supabase.from('content_outputs').update({
    generation_params: {
      ...output.generation_params,
      pending_predictions: remaining,
    },
  }).eq('id', outputId);
}

async function markStageComplete(supabase: any, outputId: string, stageId: string) {
  console.log(`✅ Stage ${stageId} complete for output ${outputId}`);

  const { data: output } = await supabase
    .from('content_outputs')
    .select('stage_data, autopilot_id, generation_params')
    .eq('id', outputId)
    .single();

  if (!output) return;

  // Auto-trigger subtitle transcription if subtitles are enabled on the blueprint
  // (must happen before auto-approve so subtitles are ready when video is approved)
  await maybeAutoTriggerSubtitleTranscription(supabase, outputId, output.generation_params);

  const shouldAutoApprove = output.autopilot_id || output.generation_params?.auto_approve_all;

  if (shouldAutoApprove) {
    const source = output.autopilot_id ? 'Autopilot' : 'AutoApproveAll';
    console.log(`🤖 [${source}] Auto-approving async stage ${stageId}`);

    try {
      const { error: approveError } = await supabase.functions.invoke('approve-stage', {
        body: {
          output_id: outputId,
          stage_id: stageId,
          action: 'approve',
          is_automated: true,
          autopilot_id: output.autopilot_id,
        },
      });

      if (approveError) {
        console.error(`❌ [${source}] Auto-advance failed:`, approveError);
        await setStageReady(supabase, outputId, stageId, output.stage_data);
      } else {
        console.log(`✅ [${source}] Stage ${stageId} auto-advanced`);
      }
    } catch (e) {
      console.error(`❌ [${source}] Auto-advance exception:`, e);
      await setStageReady(supabase, outputId, stageId, output.stage_data);
    }
  } else {
    console.log(`⏸️ Stage ${stageId} requires manual approval`);
    await setStageReady(supabase, outputId, stageId, output.stage_data);
  }
}

/**
 * Auto-trigger Whisper transcription if subtitles are enabled on the blueprint.
 * Mirrors the same logic from generation-completion-webhook.
 */
async function maybeAutoTriggerSubtitleTranscription(
  supabase: any,
  outputId: string,
  genParams: any
) {
  try {
    const blueprintId = genParams?.blueprint_id;
    if (!blueprintId) return;

    const { data: blueprint } = await supabase
      .from('blueprints')
      .select('model_config')
      .eq('id', blueprintId)
      .single();

    if (!blueprint?.model_config?.subtitles_enabled) return;

    console.log(`🎤 Subtitles enabled — auto-triggering Whisper transcription for output ${outputId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const response = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ output_id: outputId }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Whisper transcription auto-triggered: ${result.prediction_id}`);
    } else {
      const errorText = await response.text();
      console.error(`⚠️ Failed to auto-trigger transcription: ${errorText}`);
    }
  } catch (error) {
    console.error(`⚠️ Error auto-triggering subtitle transcription:`, error);
    // Non-fatal — video succeeded, subtitles are optional
  }
}

async function setStageReady(supabase: any, outputId: string, stageId: string, stageData: any) {
  const stageInfo = stageData?.[stageId] || {};
  await supabase.from('content_outputs').update({
    status: 'review',
    stage_data: {
      ...stageData,
      [stageId]: {
        ...stageInfo,
        status: 'ready',
        completed_at: new Date().toISOString(),
      },
    },
  }).eq('id', outputId);
}

// ─── Storage Upload ──────────────────────────────────────────────────────────

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
    throw new Error('No active storage credentials found');
  }

  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  // Decrypt storage credentials
  let parsedCreds: any;
  const credValue = credentials.credentials_encrypted;
  if (credValue.includes(':') && !credValue.startsWith('{')) {
    const decryptedJson = await decryptCredentials(credValue, encryptionKey);
    parsedCreds = JSON.parse(decryptedJson);
  } else {
    parsedCreds = JSON.parse(credValue);
  }

  // Download from temporary URL
  console.log(`⬇️ Downloading ${mediaType} from HeyGen`);
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

  // Upload to storage provider
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

// ─── Storage Provider Implementations ────────────────────────────────────────

async function uploadToCloudflareR2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  mediaType: string
): Promise<string> {
  const { access_key_id: accessKeyId, secret_access_key: secretAccessKey } = parsedCreds;
  const bucketName = credentials.bucket_name;
  const endpoint = credentials.endpoint_url;
  const accountId = endpoint.match(/([a-f0-9]+)\.r2/)?.[1] || '';

  const url = `${endpoint}/${bucketName}/${path}`;
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');

  const contentType = mediaType === 'video' ? 'video/mp4' : 'image/png';
  const bodyBytes = new Uint8Array(await data.arrayBuffer());

  // AWS Signature V4
  const hashHex = await sha256Hex(bodyBytes);
  const canonicalHeaders = `content-type:${contentType}\nhost:${accountId}.r2.cloudflarestorage.com\nx-amz-content-sha256:${hashHex}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n/${bucketName}/${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${hashHex}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${await sha256Hex(new TextEncoder().encode(canonicalRequest))}`;

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);
  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authorizationHeader,
      'Content-Type': contentType,
      'x-amz-content-sha256': hashHex,
      'x-amz-date': amzDate,
    },
    body: bodyBytes,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`R2 upload failed (${response.status}): ${errorText}`);
  }

  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

async function uploadToBackblazeB2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  mediaType: string
): Promise<string> {
  const { key_id: keyId, application_key: applicationKey } = parsedCreds;

  // Authorize
  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { 'Authorization': `Basic ${btoa(`${keyId}:${applicationKey}`)}` },
  });
  if (!authResponse.ok) throw new Error('B2 auth failed');
  const authData = await authResponse.json();

  // Get upload URL
  const uploadUrlResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { 'Authorization': authData.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: credentials.bucket_id || parsedCreds.bucket_id }),
  });
  if (!uploadUrlResponse.ok) throw new Error('B2 get upload URL failed');
  const uploadUrlData = await uploadUrlResponse.json();

  // Upload
  const bodyBytes = new Uint8Array(await data.arrayBuffer());
  const sha1Hash = await sha1Hex(bodyBytes);
  const contentType = mediaType === 'video' ? 'video/mp4' : 'image/png';

  const uploadResponse = await fetch(uploadUrlData.uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': uploadUrlData.authorizationToken,
      'X-Bz-File-Name': encodeURIComponent(path),
      'Content-Type': contentType,
      'Content-Length': String(bodyBytes.length),
      'X-Bz-Content-Sha1': sha1Hash,
    },
    body: bodyBytes,
  });

  if (!uploadResponse.ok) throw new Error('B2 upload failed');

  const bucketName = credentials.bucket_name;
  return credentials.public_url
    ? `${credentials.public_url}/${path}`
    : `${authData.downloadUrl}/file/${bucketName}/${path}`;
}

async function uploadToAwsS3(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  mediaType: string
): Promise<string> {
  const { access_key_id: accessKeyId, secret_access_key: secretAccessKey } = parsedCreds;
  const bucketName = credentials.bucket_name;
  const region = credentials.region || 'us-east-1';

  const host = `${bucketName}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${path}`;
  const service = 's3';
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const contentType = mediaType === 'video' ? 'video/mp4' : 'image/png';
  const bodyBytes = new Uint8Array(await data.arrayBuffer());

  const hashHex = await sha256Hex(bodyBytes);
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-acl:public-read\nx-amz-content-sha256:${hashHex}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-acl;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n/${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${hashHex}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${await sha256Hex(new TextEncoder().encode(canonicalRequest))}`;

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);
  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authorizationHeader,
      'Content-Type': contentType,
      'x-amz-acl': 'public-read',
      'x-amz-content-sha256': hashHex,
      'x-amz-date': amzDate,
    },
    body: bodyBytes,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`S3 upload failed (${response.status}): ${errorText}`);
  }

  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

// ─── Crypto Helpers ──────────────────────────────────────────────────────────

async function decryptCredentials(encryptedData: string, encryptionKeyHex: string): Promise<string> {
  const keyData = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

  const parts = encryptedData.split(':');
  if (parts.length === 3 && parts.every(p => /^[0-9a-fA-F]+$/.test(p))) {
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const authTag = new Uint8Array(authTagHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const encrypted = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      new Uint8Array([...encrypted, ...authTag])
    );
    return new TextDecoder().decode(decrypted);
  }

  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha1Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSign(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}

async function hmacHex(key: Uint8Array, msg: string): Promise<string> {
  const sig = await hmacSign(key, msg);
  return Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Promise<Uint8Array> {
  const kDate = await hmacSign(new TextEncoder().encode(`AWS4${key}`), dateStamp);
  const kRegion = await hmacSign(kDate, region);
  const kService = await hmacSign(kRegion, service);
  return await hmacSign(kService, 'aws4_request');
}
