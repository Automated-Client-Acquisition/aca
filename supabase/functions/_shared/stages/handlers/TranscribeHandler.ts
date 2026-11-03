/**
 * Custom Handler: Transcribe Stage (fire-and-forget dispatcher)
 *
 * Dispatches transcription work to the video-renderer Fly.io worker,
 * which has no timeout limit. The worker extracts audio, calls ElevenLabs STT,
 * and writes results directly to the DB.
 *
 * The edge function returns immediately with status: 'generating'.
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';

/**
 * Execute the transcribe stage.
 * Dispatches to the video-renderer worker and returns immediately.
 */
export async function executeTranscribeStage(
  context: ExecutionContext,
  _stageDef: StageDefinition,
  _engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[TranscribeHandler] Dispatching transcription to video-renderer worker');

  // 1. Resolve the video-renderer worker URL
  const workerUrl = Deno.env.get('VIDEO_RENDERER_WORKER_URL');
  if (!workerUrl) {
    throw new Error(
      'VIDEO_RENDERER_WORKER_URL environment variable is not configured.'
    );
  }

  // 2. Get the source video URL — from video_ingest output OR directly from video_config
  const videoIngestOutput = context.previousStageOutputs.video_ingest;
  const rawConfig = context.rawConfiguration || {};
  const rawParams = context.rawGenerationParams || {};
  const videoConfig = rawParams.video_config || rawConfig.video_config || {};

  let sourceVideoUrl: string = '';

  if (videoIngestOutput) {
    // Legacy path: video_ingest already processed the video
    sourceVideoUrl = videoIngestOutput.source_url || videoIngestOutput.page_metadata?.url || '';
  } else {
    // Direct path (record / upload_video): video URL comes from video_config
    sourceVideoUrl =
      videoConfig.screen_video_url ||
      videoConfig.uploaded_video_url ||
      videoConfig.uploadedVideoUrl ||
      '';
  }

  if (!sourceVideoUrl) {
    throw new Error('No source video URL found — need video_ingest output or video URL in video_config');
  }

  // 3. Get ElevenLabs API key
  const elevenLabsKey =
    context.apiKeys?.elevenlabs ||
    Deno.env.get('ELEVENLABS_API_KEY') ||
    '';

  if (!elevenLabsKey) {
    throw new Error(
      'ElevenLabs API key is required for transcription. ' +
      'Add it in Settings > API Keys.'
    );
  }

  // 4. Get Supabase credentials for the worker
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  console.log('[TranscribeHandler] Dispatching to worker:', {
    video_url: sourceVideoUrl.substring(0, 80) + '...',
    output_id: context.outputId,
  });

  // 5. Fire request to worker (30s to accept — worker responds 202 immediately)
  try {
    const response = await fetch(`${workerUrl}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': Deno.env.get('WORKER_INTERNAL_KEY') || '',
      },
      body: JSON.stringify({
        output_id: context.outputId,
        stage_id: context.stageId,
        video_url: sourceVideoUrl,
        elevenlabs_key: elevenLabsKey,
        supabase_url: supabaseUrl,
        supabase_key: supabaseServiceKey,
        organization_id: context.organizationId,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Transcribe worker error ${response.status}: ${errorBody}`);
    }

    const acceptResponse = await response.json();
    console.log('[TranscribeHandler] Worker accepted:', acceptResponse);
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Video renderer worker did not respond within 30s. The worker may be down.');
    }
    throw error;
  }

  // 6. Return 'generating' — worker will write results to DB when done
  return {
    content: {
      dispatched_at: new Date().toISOString(),
    },
    status: 'generating',
  };
}

export default executeTranscribeStage;
