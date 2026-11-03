/**
 * Custom Handler: Video Ingest Stage
 *
 * Processes an uploaded video file to extract key frames for the presenter pipeline.
 * This is the alternative source stage when sourceType === 'upload' (instead of web_capture).
 *
 * Flow:
 * 1. Get the uploaded video URL from configuration
 * 2. Call the video-renderer Fly.io worker's /extract-frames endpoint
 * 3. Worker extracts key frames at regular intervals and uploads to Supabase Storage
 * 4. Return the same shape as web_capture output: { screenshots, page_metadata }
 *
 * Worker URL is read from the VIDEO_RENDERER_WORKER_URL env var.
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';

// Timeout for frame extraction — shorter than web_capture since no LLM planning needed
const EXTRACT_TIMEOUT_MS = 120_000;

interface FrameData {
  url: string;
  viewport_area?: string;
  narration_hint?: string;
  timestamp_ms?: number;
}

interface ExtractFramesRequest {
  videoUrl: string;
  maxFrames: number;
  orientation: 'portrait' | 'landscape';
  supabase_url: string;
  supabase_key: string;
  output_id: string;
  stage_id: string;
}

interface ExtractFramesResponse {
  success: boolean;
  frames: FrameData[];
  duration_ms: number;
  video_duration_seconds: number;
  frame_count: number;
}

/**
 * Execute the video ingest stage.
 * Calls the Fly.io video-renderer worker to extract key frames from an uploaded video.
 */
export async function executeVideoIngestStage(
  context: ExecutionContext,
  _stageDef: StageDefinition,
  _engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[VideoIngestHandler] Starting video ingest stage');

  // 1. Resolve the worker URL from environment
  const workerUrl = Deno.env.get('VIDEO_RENDERER_WORKER_URL');
  if (!workerUrl) {
    throw new Error(
      'VIDEO_RENDERER_WORKER_URL environment variable is not configured. ' +
      'Deploy the video-renderer Fly.io worker and set the URL.'
    );
  }

  // 2. Extract the uploaded video URL from configuration
  // Check multiple sources: slot_values (per-idea), video_config (unified video), remix_config, presenter_config, top-level
  const rawParams = context.rawGenerationParams || {};
  const rawConfig = context.rawConfiguration || {};
  const videoConfig = rawParams.video_config || rawConfig.video_config || {};
  const presenterConfig = rawParams.presenter_config || rawConfig.presenter_config || {};
  const remixConfig = rawParams.remix_config || rawConfig.remix_config || {};
  const slotValues = rawParams.slot_values || {};

  const uploadedVideoUrl: string =
    // Per-idea video URL (video_remix / unified video: each idea carries its own video)
    slotValues.uploaded_video_url ||
    // Unified video config (video pipeline)
    videoConfig.uploaded_video_url || videoConfig.uploadedVideoUrl ||
    // Remix config
    remixConfig.uploadedVideoUrl ||
    remixConfig.uploaded_video_url ||
    // Presenter config
    presenterConfig.uploadedVideoUrl ||
    presenterConfig.uploaded_video_url ||
    // Top-level fallbacks
    rawParams.uploaded_video_url ||
    rawConfig.uploaded_video_url ||
    '';

  if (!uploadedVideoUrl) {
    throw new Error(
      'No uploaded video URL found for video_ingest stage. ' +
      'Set `uploaded_video_url` in slot_values, remix_config, or presenter_config.'
    );
  }

  const maxFrames: number =
    videoConfig.maxFrames || videoConfig.max_frames ||
    presenterConfig.maxFrames ||
    presenterConfig.max_frames ||
    remixConfig.maxFrames ||
    remixConfig.max_frames ||
    rawParams.max_screenshots ||
    rawConfig.max_screenshots ||
    8;

  // Resolve orientation — check all possible field names from video_config, presenter_config, remix_config, and top-level
  const presenterOrientation = videoConfig.orientation || presenterConfig.orientation || remixConfig.orientation;
  const orientation: 'portrait' | 'landscape' =
    presenterOrientation === 'landscape' ||
    rawParams.orientation === 'landscape' ||
    rawConfig.orientation === 'landscape' ||
    rawConfig.video_orientation === 'landscape' ||
    rawParams.video_orientation === 'landscape' ||
    context.outputConfig?.aspectRatio === '16:9'
      ? 'landscape'
      : 'portrait';

  // Supabase credentials for the worker to upload frames
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for video ingest worker');
  }

  console.log('[VideoIngestHandler] Ingest config:', {
    uploadedVideoUrl: uploadedVideoUrl.substring(0, 80) + '...',
    maxFrames,
    orientation,
    worker_url: workerUrl,
  });

  // 3. Build request body
  const requestBody: ExtractFramesRequest = {
    videoUrl: uploadedVideoUrl,
    maxFrames,
    orientation,
    supabase_url: supabaseUrl,
    supabase_key: supabaseServiceKey,
    output_id: context.outputId,
    stage_id: context.stageId,
  };

  // 4. Call the video-renderer worker's extract-frames endpoint
  let extractResponse: ExtractFramesResponse;

  try {
    const response = await fetch(`${workerUrl}/extract-frames`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': Deno.env.get('WORKER_INTERNAL_KEY') || '',
      },
      body: JSON.stringify({
        ...requestBody,
        organization_id: context.organizationId,
      }),
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Video ingest worker error ${response.status}: ${errorBody}`
      );
    }

    extractResponse = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        `Video ingest worker timed out after ${EXTRACT_TIMEOUT_MS / 1000}s. ` +
        'The video may be too large or the worker may be unavailable.'
      );
    }
    throw error;
  }

  // 5. Validate the response
  if (!extractResponse.success) {
    throw new Error('Video ingest worker returned failure');
  }

  if (!extractResponse.frames || extractResponse.frames.length === 0) {
    throw new Error(
      'Video ingest worker returned 0 frames. ' +
      'The video may be corrupted or in an unsupported format.'
    );
  }

  console.log('[VideoIngestHandler] Extraction complete:', {
    frames: extractResponse.frames.length,
    video_duration_s: extractResponse.video_duration_seconds,
    elapsed_ms: extractResponse.duration_ms,
  });

  // 6. Return the stage result — same shape as web_capture for downstream compatibility
  const screenshots = extractResponse.frames.map((frame, index) => ({
    url: frame.url,
    narration_hint: frame.narration_hint || `Frame ${index + 1} at ${((frame.timestamp_ms || 0) / 1000).toFixed(1)}s`,
    viewport_area: frame.viewport_area,
    step_index: index,
  }));

  return {
    content: {
      screenshots,
      page_metadata: {
        title: presenterConfig.videoTitle || 'Uploaded Video',
        description: presenterConfig.videoDescription || '',
        url: uploadedVideoUrl,
      },
      total_screenshots: screenshots.length,
      capture_duration_ms: extractResponse.duration_ms,
      source_url: uploadedVideoUrl,
      source_type: 'upload',
      video_duration_seconds: extractResponse.video_duration_seconds,
    },
    status: 'completed',
  };
}

export default executeVideoIngestStage;
