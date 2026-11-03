/**
 * Custom Handler: Presenter Compose Stage
 *
 * Calls the unified video-renderer Fly.io worker to render the final presenter video
 * using the EditorComposition (track-based data model).
 *
 * Gathers screenshots, director shots, voice/avatar audio, and transforms everything
 * into EditorState via compositionInputToEditorState(). The worker renders a single
 * unified composition for all pipeline types.
 *
 * Worker URL is read from the VIDEO_RENDERER_WORKER_URL env var.
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { compositionInputToEditorState } from '../../editorState.ts';

interface BrandConfig {
  accent_color: string;
  primary_color: string;
  background_color: string;
  text_color: string;
  font_family: string;
  logo_url?: string;
}

// Sensible defaults for video rendering — high-contrast for readability
const DEFAULT_BRAND: BrandConfig = {
  accent_color: '#FFD700',
  primary_color: '#FF4444',
  background_color: '#0A0A0A',
  text_color: '#FFFFFF',
  font_family: 'Inter, sans-serif',
};

/**
 * Build brand config from context brandVoice.
 * Always returns a complete BrandConfig with all fields filled (using defaults where needed).
 */
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
 * Normalize a word for fuzzy matching: lowercase, strip punctuation.
 */
function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, '');
}

/**
 * Sync shot durations to actual TTS audio timing.
 *
 * The director estimates shot durations (~3 words/sec), but ElevenLabs
 * determines actual speech pace. This function matches each shot's narration
 * words to the word-level timestamps from TTS, then sets each shot's duration
 * to span from its first spoken word to its last spoken word.
 *
 * Falls back to proportional scaling if word matching fails.
 */
function syncShotDurationsToAudio(
  shots: any[],
  wordTimestamps: Array<{ word: string; start: number; end: number }>,
  audioDurationSeconds: number | undefined,
): any[] {
  if (!wordTimestamps.length) {
    console.warn('[PresenterComposeHandler] No word timestamps — keeping director durations');
    return shots;
  }

  const audioDuration = audioDurationSeconds || wordTimestamps[wordTimestamps.length - 1].end;
  const directorTotal = shots.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);

  console.log('[PresenterComposeHandler] Duration sync:', {
    director_total: directorTotal,
    audio_duration: audioDuration,
    mismatch_seconds: Math.abs(directorTotal - audioDuration),
    word_count: wordTimestamps.length,
  });

  // Try word-level alignment: walk through word timestamps sequentially,
  // matching each shot's narration words to consecutive timestamp entries.
  const normalizedTimestampWords = wordTimestamps.map((wt) => normalizeWord(wt.word));
  let tsIndex = 0; // current position in the word timestamps stream

  const alignedShots: Array<{ shotIndex: number; startTime: number; endTime: number }> = [];

  for (let i = 0; i < shots.length; i++) {
    const narration: string = shots[i].narration || '';
    if (!narration.trim()) {
      // No narration (text_card hooks, etc.) — will get minimum duration later
      alignedShots.push({ shotIndex: i, startTime: -1, endTime: -1 });
      continue;
    }

    // Extract words from this shot's narration
    const narrationWords = narration
      .split(/\s+/)
      .map(normalizeWord)
      .filter((w) => w.length > 0);

    if (narrationWords.length === 0) {
      alignedShots.push({ shotIndex: i, startTime: -1, endTime: -1 });
      continue;
    }

    // Find the first narration word in the timestamp stream (starting from tsIndex)
    let firstMatch = -1;
    let lastMatch = -1;
    let searchStart = tsIndex;

    // Search for the first word of this shot's narration
    for (let j = searchStart; j < normalizedTimestampWords.length; j++) {
      if (normalizedTimestampWords[j] === narrationWords[0]) {
        firstMatch = j;
        break;
      }
    }

    if (firstMatch === -1) {
      // First word not found — this shot can't be aligned
      alignedShots.push({ shotIndex: i, startTime: -1, endTime: -1 });
      continue;
    }

    // From the first match, try to match remaining narration words sequentially
    lastMatch = firstMatch;
    let nIdx = 1;
    let tIdx = firstMatch + 1;

    while (nIdx < narrationWords.length && tIdx < normalizedTimestampWords.length) {
      if (normalizedTimestampWords[tIdx] === narrationWords[nIdx]) {
        lastMatch = tIdx;
        nIdx++;
      }
      tIdx++;
      // Don't search too far ahead (max 3x narration words to allow some mismatches)
      if (tIdx - firstMatch > narrationWords.length * 3) break;
    }

    alignedShots.push({
      shotIndex: i,
      startTime: wordTimestamps[firstMatch].start,
      endTime: wordTimestamps[lastMatch].end,
    });

    // Advance the stream position past this shot's words
    tsIndex = lastMatch + 1;
  }

  // Count how many shots were successfully aligned
  const alignedCount = alignedShots.filter((a) => a.startTime >= 0).length;
  const narrationShotCount = shots.filter((s: any) => (s.narration || '').trim()).length;

  console.log('[PresenterComposeHandler] Word alignment:', {
    aligned: alignedCount,
    narration_shots: narrationShotCount,
    total_shots: shots.length,
  });

  // If less than half of narration shots aligned, fall back to proportional scaling
  if (alignedCount < narrationShotCount * 0.5) {
    console.warn('[PresenterComposeHandler] Word alignment poor — falling back to proportional scaling');
    const scale = directorTotal > 0 ? audioDuration / directorTotal : 1;
    return shots.map((s: any) => ({
      ...s,
      duration: Math.max(Math.round((s.duration || 2) * scale * 10) / 10, 1),
    }));
  }

  // Assign durations from word alignment
  const syncedShots = shots.map((shot: any, i: number) => {
    const alignment = alignedShots[i];

    if (alignment.startTime >= 0 && alignment.endTime > alignment.startTime) {
      // Calculate duration from word timestamps + small padding for visual breathing room
      const speechDuration = alignment.endTime - alignment.startTime;
      const paddedDuration = speechDuration + 0.3; // 300ms padding per shot
      return {
        ...shot,
        duration: Math.max(Math.round(paddedDuration * 10) / 10, 1),
      };
    }

    // Non-narration shot (text_card, etc.) — keep original duration or use minimum
    return {
      ...shot,
      duration: Math.max(shot.duration || 1.5, 1),
    };
  });

  const syncedTotal = syncedShots.reduce((sum: number, s: any) => sum + s.duration, 0);
  console.log('[PresenterComposeHandler] Synced durations:', {
    original_total: directorTotal,
    synced_total: syncedTotal,
    audio_duration: audioDuration,
  });

  return syncedShots;
}

/**
 * Execute the presenter composition stage.
 * Calls the video-renderer worker and returns the final video URL.
 */
export async function executePresenterComposeStage(
  context: ExecutionContext,
  _stageDef: StageDefinition,
  _engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[PresenterComposeHandler] Starting presenter composition stage');

  // 1. Resolve worker URL
  const workerUrl = Deno.env.get('VIDEO_RENDERER_WORKER_URL');
  if (!workerUrl) {
    throw new Error(
      'VIDEO_RENDERER_WORKER_URL environment variable is not configured. ' +
      'Deploy the video-renderer Fly.io worker and set the URL.'
    );
  }

  // 2. Gather previous stage outputs
  const webCaptureOutput = context.previousStageOutputs.web_capture;
  const videoIngestOutput = context.previousStageOutputs.video_ingest;
  const directorOutput = context.previousStageOutputs.director;
  const voiceAvatarOutput = context.previousStageOutputs.voice_avatar;
  const voiceoverOutput = context.previousStageOutputs.voiceover;
  const transcribeOutput = context.previousStageOutputs.transcribe;

  if (!directorOutput) {
    throw new Error('composition stage requires director stage to be completed');
  }

  // Determine if this is a "keep_original" voice path (video_remix pipeline)
  const rawConfig = context.rawConfiguration || {};
  const rawParams = context.rawGenerationParams || {};
  const remixConfig = rawParams.remix_config || rawConfig.remix_config || {};
  const voiceOption: string = remixConfig.voiceOption || remixConfig.voice_option || '';
  const isKeepOriginal = voiceOption === 'keep_original';

  // For standard pipelines, require a voice stage. For keep_original, skip it.
  const voiceOutput = voiceAvatarOutput || voiceoverOutput;
  if (!voiceOutput && !isKeepOriginal) {
    throw new Error('composition stage requires voice_avatar or voiceover stage to be completed');
  }

  // Prefer B-roll enriched shots (with cutaway entries interleaved) when available
  const bRollOutput = context.previousStageOutputs.b_roll;
  const rawShots = (bRollOutput?.shots?.length ? bRollOutput.shots : directorOutput.shots) || [];
  if (!rawShots.length) {
    throw new Error('Director stage produced no shots for composition');
  }

  // Transform screenshots: web-capture stores bboxes as flat { selector, text, x, y, width, height }
  // but the Remotion renderer expects elements as { selector, text, bounds: { x, y, width, height } }
  // For video_remix pipeline, frames come from video_ingest instead of web_capture
  const sourceOutput = webCaptureOutput || videoIngestOutput;
  const rawScreenshots = sourceOutput?.screenshots || [];
  const screenshots = rawScreenshots.map((s: any) => ({
    url: s.url,
    narration_hint: s.narrate || s.narration_hint || s.area || '',
    elements: (s.bboxes || []).map((b: any) => ({
      selector: b.selector,
      text: b.text,
      type: b.selector?.split('.')[0] || 'unknown',
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
    })),
  }));

  // Resolve audio and timestamps — either from voice stage or from original video
  let avatarVideoUrl: string;
  let audioUrl: string;
  let wordTimestamps: Array<{ word: string; start: number; end: number }>;

  if (isKeepOriginal && transcribeOutput) {
    // Keep original: use the extracted audio from the transcribe stage
    audioUrl = transcribeOutput.audio_url || '';
    wordTimestamps = transcribeOutput.word_timestamps || [];
    avatarVideoUrl = '';
    console.log('[PresenterComposeHandler] Using original audio (keep_original mode)');
  } else if (voiceOutput) {
    // Standard: use TTS audio from voice stage
    audioUrl = voiceOutput.audio_url || '';
    wordTimestamps = voiceOutput.word_timestamps || [];
    avatarVideoUrl = voiceOutput.avatar_video_url || '';
  } else {
    throw new Error('No audio source available for composition');
  }

  if (!audioUrl) {
    throw new Error('No audio_url available for composition');
  }

  if (!avatarVideoUrl) {
    console.warn('[PresenterComposeHandler] No avatar video — rendering screenshots-only mode with voiceover');
  }

  // 2b. Sync shot durations to actual audio timing
  // The director guesses durations (~3 words/sec), but ElevenLabs determines
  // the real speech pace. We match each shot's narration to word timestamps
  // so the video duration exactly matches the voiceover.
  const audioDuration = voiceOutput?.duration_seconds ?? voiceAvatarOutput?.duration_seconds ?? (isKeepOriginal ? transcribeOutput?.duration_seconds : 0) ?? 0;
  const shots = syncShotDurationsToAudio(rawShots, wordTimestamps, audioDuration);

  // 3. Resolve presentation config from raw config

  // Resolve orientation — check nested config objects first, then top-level fields
  const presenterConfig = rawParams.presenter_config || rawConfig.presenter_config || {};
  const orientation: 'portrait' | 'landscape' =
    presenterConfig.orientation === 'landscape' ||
    remixConfig.orientation === 'landscape' ||
    rawParams.orientation === 'landscape' ||
    rawConfig.orientation === 'landscape' ||
    rawConfig.video_orientation === 'landscape' ||
    rawParams.video_orientation === 'landscape' ||
    context.outputConfig?.aspectRatio === '16:9'
      ? 'landscape'
      : 'portrait';

  const subtitleStyle: PresenterVideoProps['subtitleStyle'] =
    presenterConfig.subtitle_style ||
    remixConfig.subtitle_style ||
    rawParams.model_config?.subtitle_template ||
    rawConfig.model_config?.subtitle_template ||
    rawParams.subtitle_style ||
    rawConfig.subtitle_style ||
    'tiktok_bounce';

  // 4. Build brand config
  const brand = buildBrandConfig(context);

  // 5. Get Supabase credentials for the worker to upload the rendered video
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for video renderer worker');
  }

  console.log('[PresenterComposeHandler] Render config:', {
    shot_count: shots.length,
    screenshot_count: screenshots.length,
    orientation,
    subtitle_style: subtitleStyle,
    word_timestamp_count: wordTimestamps.length,
    has_avatar_video: !!avatarVideoUrl,
    has_audio: !!audioUrl,
  });

  // 6. Resolve background music
  const backgroundMusicUrl: string | undefined =
    presenterConfig.background_music_url || rawConfig.background_music_url || rawParams.background_music_url;
  const backgroundMusicVolume: number =
    presenterConfig.background_music_volume ?? rawConfig.background_music_volume ?? rawParams.background_music_volume ?? 0.10;

  // 7. Transform to EditorState (track-based data model)
  const editorState = compositionInputToEditorState({
    shots,
    screenshots,
    sourceVideoUrl: null,
    sourceDurationSeconds: 0,
    audioUrl: audioUrl || null,
    originalAudioUrl: isKeepOriginal ? (transcribeOutput?.audio_url || null) : null,
    wordTimestamps,
    voiceMode: isKeepOriginal ? 'keep_original' : (avatarVideoUrl ? 'avatar' : 'voiceover'),
    avatarVideoUrl: avatarVideoUrl || null,
    brand,
    orientation,
    subtitleStyle,
    backgroundMusicUrl,
    backgroundMusicVolume,
  });

  console.log('[PresenterComposeHandler] EditorState:', {
    track_count: editorState.tracks.length,
    asset_count: editorState.assets.length,
    total_items: editorState.tracks.reduce((sum, t) => sum + t.items.length, 0),
    duration_frames: editorState.durationInFrames,
    dimensions: `${editorState.width}x${editorState.height}`,
  });

  // 8. Build the render request with EditorState
  const renderRequest = {
    composition_id: 'EditorComposition' as const,
    output_id: context.outputId,
    stage_id: context.stageId,
    props: editorState,
    supabase_url: supabaseUrl,
    supabase_key: supabaseServiceKey,
  };

  // 9. Fire render request to worker (async — returns 202 immediately)
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
    console.log('[PresenterComposeHandler] Render accepted by worker:', acceptResponse);
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        'Video renderer worker did not respond within 30s. The worker may be down or unreachable.'
      );
    }
    throw error;
  }

  console.log('[PresenterComposeHandler] Render dispatched — worker will write results directly to DB');

  return {
    content: {
      composition_id: 'EditorComposition',
      editor_state: editorState,
      orientation,
      shot_count: shots.length,
      dispatched_at: new Date().toISOString(),
    },
    status: 'generating',
  };
}

export default executePresenterComposeStage;
