/**
 * Custom Handler: Remix Compose Stage
 *
 * Calls the video-renderer Fly.io worker to render a video remix
 * using the EditorComposition (track-based data model).
 *
 * Sends the original video URL + edit segments (time ranges)
 * transformed into EditorState via remixToEditorState().
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { remixToEditorState } from '../../editorState.ts';

interface BrandConfig {
  accent_color: string;
  primary_color: string;
  background_color: string;
  text_color: string;
  font_family: string;
  logo_url?: string;
}

const DEFAULT_BRAND: BrandConfig = {
  accent_color: '#FFD700',
  primary_color: '#FF4444',
  background_color: '#0A0A0A',
  text_color: '#FFFFFF',
  font_family: 'Inter, sans-serif',
};

function buildBrandConfig(context: ExecutionContext): BrandConfig {
  const bv = context.brandVoice;
  if (!bv) return { ...DEFAULT_BRAND };

  const palette = bv.colorPalette;
  let primary: string | undefined;
  let background: string | undefined;
  let text: string | undefined;
  let accent: string | undefined;

  if (Array.isArray(palette)) {
    const colors = palette as string[];
    primary = colors[0];
    accent = colors[2] || colors[1];
  } else if (palette && typeof palette === 'object') {
    const cp = palette as any;
    primary = cp.primary;
    background = cp.background;
    text = cp.text;
    accent = cp.accent;
  }

  return {
    accent_color: accent || DEFAULT_BRAND.accent_color,
    primary_color: primary || DEFAULT_BRAND.primary_color,
    background_color: background || DEFAULT_BRAND.background_color,
    text_color: text || DEFAULT_BRAND.text_color,
    font_family: bv.fontStyle || DEFAULT_BRAND.font_family,
    logo_url: bv.logo || (bv.logos?.[0] ?? undefined),
  };
}

/**
 * Sync segment durations to actual TTS audio timing.
 *
 * For 'video' segments, adjusts playback speed to match the narration timing.
 * For 'text_card' and 'b_roll' segments, keeps original durations.
 * Falls back to proportional scaling if word matching fails.
 */
function syncSegmentDurationsToAudio(
  segments: any[],
  wordTimestamps: Array<{ word: string; start: number; end: number }>,
  audioDurationSeconds: number | undefined,
): any[] {
  if (!wordTimestamps.length) {
    console.warn('[RemixComposeHandler] No word timestamps — keeping director durations');
    return segments;
  }

  const audioDuration = audioDurationSeconds || wordTimestamps[wordTimestamps.length - 1].end;

  // Calculate total video segments duration vs audio duration
  const videoSegmentsDuration = segments
    .filter((s: any) => s.type === 'video')
    .reduce((sum: number, s: any) => {
      const dur = s.duration || ((s.source_end - s.source_start) / (s.speed || 1));
      return sum + dur;
    }, 0);

  const nonVideoSegmentsDuration = segments
    .filter((s: any) => s.type !== 'video')
    .reduce((sum: number, s: any) => sum + (s.duration || 3), 0);

  const totalCurrentDuration = videoSegmentsDuration + nonVideoSegmentsDuration;

  console.log('[RemixComposeHandler] Duration sync:', {
    total_current: totalCurrentDuration,
    audio_duration: audioDuration,
    video_segments_duration: videoSegmentsDuration,
    non_video_segments_duration: nonVideoSegmentsDuration,
  });

  // If the mismatch is small (<10%), don't adjust
  if (Math.abs(totalCurrentDuration - audioDuration) / audioDuration < 0.1) {
    console.log('[RemixComposeHandler] Duration mismatch <10% — keeping original timing');
    return segments;
  }

  // Scale video segment speeds proportionally to match audio duration
  const targetVideoTime = audioDuration - nonVideoSegmentsDuration;
  if (targetVideoTime <= 0 || videoSegmentsDuration <= 0) {
    return segments;
  }

  const speedScale = videoSegmentsDuration / targetVideoTime;

  return segments.map((segment: any) => {
    if (segment.type !== 'video') return segment;

    const currentSpeed = segment.speed || 1;
    const newSpeed = Math.max(0.5, Math.min(2.0, currentSpeed * speedScale));

    return {
      ...segment,
      speed: Math.round(newSpeed * 100) / 100,
    };
  });
}

/**
 * Execute the remix composition stage.
 * Calls the video-renderer worker with the VideoRemix composition.
 */
export async function executeRemixComposeStage(
  context: ExecutionContext,
  _stageDef: StageDefinition,
  _engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[RemixComposeHandler] Starting remix composition stage');

  // 1. Resolve worker URL
  const workerUrl = Deno.env.get('VIDEO_RENDERER_WORKER_URL');
  if (!workerUrl) {
    throw new Error(
      'VIDEO_RENDERER_WORKER_URL environment variable is not configured. ' +
      'Deploy the video-renderer Fly.io worker and set the URL.'
    );
  }

  // 2. Gather previous stage outputs
  const videoIngestOutput = context.previousStageOutputs.video_ingest;
  const directorOutput = context.previousStageOutputs.director;
  const voiceAvatarOutput = context.previousStageOutputs.voice_avatar;
  const voiceoverOutput = context.previousStageOutputs.voiceover;
  const transcribeOutput = context.previousStageOutputs.transcribe;
  const bRollOutput = context.previousStageOutputs.b_roll;

  if (!videoIngestOutput?.source_url) {
    throw new Error('composition stage requires video_ingest with source_url');
  }

  if (!directorOutput?.segments) {
    throw new Error('composition stage requires director stage with segments output');
  }

  // 3. Resolve segments (prefer B-roll enriched if available)
  const rawSegments = (bRollOutput?.segments?.length ? bRollOutput.segments : directorOutput.segments) || [];
  if (!rawSegments.length) {
    throw new Error('Director stage produced no segments for composition');
  }

  // 4. Determine voice mode and resolve audio
  const rawConfig = context.rawConfiguration || {};
  const rawParams = context.rawGenerationParams || {};
  const remixConfig = rawParams.remix_config || rawConfig.remix_config || {};
  const voiceOption: string = remixConfig.voiceOption || remixConfig.voice_option || 'new_voice';

  let voiceoverUrl: string | null = null;
  let originalAudioUrl: string | null = null;
  let avatarVideoUrl: string | null = null;
  let wordTimestamps: Array<{ word: string; start: number; end: number }> = [];

  const voiceOutput = voiceAvatarOutput || voiceoverOutput;

  if (voiceOption === 'keep_original' && transcribeOutput) {
    originalAudioUrl = transcribeOutput.audio_url || null;
    wordTimestamps = transcribeOutput.word_timestamps || [];
    console.log('[RemixComposeHandler] Using original audio (keep_original mode)');
  } else if (voiceOutput) {
    voiceoverUrl = voiceOutput.audio_url || null;
    wordTimestamps = voiceOutput.word_timestamps || [];
    avatarVideoUrl = voiceOutput.avatar_video_url || null;
  } else if (voiceOption === 'keep_original') {
    throw new Error('keep_original mode requires transcribe stage output with audio_url');
  } else {
    throw new Error('No voice stage output available for composition');
  }

  if (!voiceoverUrl && !originalAudioUrl) {
    throw new Error('No audio source available for composition');
  }

  // 5. Sync segment durations to audio (for new_voice/avatar modes)
  const audioDuration = voiceOutput?.duration_seconds ?? transcribeOutput?.duration_seconds ?? 0;
  const segments = (voiceOption !== 'keep_original')
    ? syncSegmentDurationsToAudio(rawSegments, wordTimestamps, audioDuration)
    : rawSegments; // keep_original: preserve original timing

  // 6. Resolve orientation and subtitle style
  const presenterConfig = rawParams.presenter_config || rawConfig.presenter_config || {};
  const orientation: 'portrait' | 'landscape' =
    presenterConfig.orientation === 'landscape' ||
    remixConfig.orientation === 'landscape' ||
    rawParams.orientation === 'landscape' ||
    rawConfig.orientation === 'landscape' ||
    context.outputConfig?.aspectRatio === '16:9'
      ? 'landscape'
      : 'portrait';

  const subtitleStyle =
    remixConfig.subtitle_style ||
    remixConfig.subtitleStyle ||
    rawParams.subtitle_style ||
    rawConfig.subtitle_style ||
    'tiktok_bounce';

  // 7. Build brand config
  const brand = buildBrandConfig(context);

  // 8. Get Supabase credentials
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for video renderer worker');
  }

  console.log('[RemixComposeHandler] Render config:', {
    segment_count: segments.length,
    orientation,
    subtitle_style: subtitleStyle,
    voice_option: voiceOption,
    word_timestamp_count: wordTimestamps.length,
    has_avatar_video: !!avatarVideoUrl,
    source_video_url: videoIngestOutput.source_url.substring(0, 80) + '...',
    source_duration: videoIngestOutput.video_duration_seconds,
  });

  // 9. Transform to EditorState (track-based data model)
  const editorState = remixToEditorState({
    sourceVideoUrl: videoIngestOutput.source_url,
    sourceDurationSeconds: videoIngestOutput.video_duration_seconds || 0,
    segments,
    voiceoverUrl,
    originalAudioUrl,
    wordTimestamps,
    voiceOption,
    avatarVideoUrl,
    brand,
    orientation,
    subtitleStyle,
  });

  console.log('[RemixComposeHandler] EditorState:', {
    track_count: editorState.tracks.length,
    asset_count: editorState.assets.length,
    total_items: editorState.tracks.reduce((sum, t) => sum + t.items.length, 0),
    duration_frames: editorState.durationInFrames,
    dimensions: `${editorState.width}x${editorState.height}`,
  });

  // 10. Build the render request with EditorState
  const renderRequest = {
    composition_id: 'EditorComposition' as const,
    output_id: context.outputId,
    stage_id: context.stageId,
    props: editorState,
    supabase_url: supabaseUrl,
    supabase_key: supabaseServiceKey,
  };

  // 11. Fire render request to worker (async — returns 202 immediately)
  try {
    const response = await fetch(`${workerUrl}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': Deno.env.get('WORKER_INTERNAL_KEY') || '',
      },
      body: JSON.stringify(renderRequest),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Video renderer worker error ${response.status}: ${errorBody}`);
    }

    const acceptResponse = await response.json();
    console.log('[RemixComposeHandler] Render accepted by worker:', acceptResponse);
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        'Video renderer worker did not respond within 30s. The worker may be down or unreachable.'
      );
    }
    throw error;
  }

  console.log('[RemixComposeHandler] Render dispatched — worker will write results directly to DB');

  return {
    content: {
      composition_id: 'EditorComposition',
      editor_state: editorState,
      orientation,
      segment_count: segments.length,
      voice_option: voiceOption,
      dispatched_at: new Date().toISOString(),
    },
    status: 'generating',
  };
}

export default executeRemixComposeStage;
