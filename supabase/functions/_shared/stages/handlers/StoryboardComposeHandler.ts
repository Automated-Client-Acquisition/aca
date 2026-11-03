/**
 * Custom Handler: Storyboard Compose Stage
 *
 * Calls the unified video-renderer Fly.io worker to render the final storyboard video
 * using the EditorComposition (track-based data model).
 *
 * Storyboard images are animated directly with camera moves (ken burns, zoom, pan)
 * at zero per-video cost vs ~$5-6 for AI video generation.
 *
 * Worker URL is read from the VIDEO_RENDERER_WORKER_URL env var.
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { storyboardToEditorState } from '../../editorState.ts';

interface SceneData {
  imageUrl: string;
  durationSeconds: number;
  cameraMove: CameraMoveConfig;
  narration?: string;
}

interface CameraMoveConfig {
  move: CameraMoveType;
  target_element?: string;
  start_scale?: number;
  end_scale?: number;
}

type CameraMoveType =
  | 'ken_burns_slow'
  | 'punch_zoom'
  | 'pan_left'
  | 'pan_right'
  | 'pan_down'
  | 'zoom_out_reveal'
  | 'shake'
  | 'hold';

const VALID_SUBTITLE_STYLES = new Set([
  'clean_white', 'karaoke_bold', 'boxed_yellow', 'bounce_pop', 'cinematic_lower',
  'tiktok_bounce', 'big_center', 'karaoke', 'minimal',
]);

function resolveSubtitleStyle(raw: string | undefined): string {
  if (!raw) return 'bounce_pop';
  if (VALID_SUBTITLE_STYLES.has(raw)) return raw;
  return 'bounce_pop';
}

interface BrandConfig {
  accent_color: string;
  primary_color: string;
  background_color: string;
  text_color: string;
  font_family: string;
  logo_url?: string;
}

// Supported camera moves with validation
const VALID_CAMERA_MOVES = new Set<string>([
  'ken_burns_slow',
  'punch_zoom',
  'pan_left',
  'pan_right',
  'pan_down',
  'zoom_out_reveal',
  'shake',
  'hold',
]);

// Default camera move cycling when scene has none specified
const DEFAULT_CAMERA_MOVE_CYCLE: CameraMoveType[] = [
  'ken_burns_slow',
  'pan_right',
  'punch_zoom',
  'pan_left',
  'zoom_out_reveal',
  'ken_burns_slow',
  'pan_down',
  'shake',
];

/**
 * Resolve camera move for a scene — validates or assigns a default.
 * Returns a CameraMoveConfig object matching the Remotion CameraMove type.
 */
function resolveCameraMove(rawMove: string | undefined, sceneIndex: number): CameraMoveConfig {
  const moveType: CameraMoveType = (rawMove && VALID_CAMERA_MOVES.has(rawMove))
    ? rawMove as CameraMoveType
    : DEFAULT_CAMERA_MOVE_CYCLE[sceneIndex % DEFAULT_CAMERA_MOVE_CYCLE.length];

  return { move: moveType };
}

/**
 * Build brand config from context brandVoice.
 */
function buildBrandConfig(context: ExecutionContext): BrandConfig {
  const bv = context.brandVoice;

  // Defaults matching Remotion's BrandConfig type (snake_case)
  const defaults: BrandConfig = {
    accent_color: '#FFB800',
    primary_color: '#FF3333',
    background_color: '#000000',
    text_color: '#FFFFFF',
    font_family: 'Inter, sans-serif',
  };

  if (!bv) return defaults;

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
    accent_color: accent || defaults.accent_color,
    primary_color: primary || defaults.primary_color,
    background_color: background || defaults.background_color,
    text_color: text || defaults.text_color,
    font_family: bv.fontStyle || defaults.font_family,
    logo_url: bv.logo || (bv.logos?.[0] ?? undefined),
  };
}

/**
 * Assemble SceneData array from the storyboard, scenes, and voiceover stage outputs.
 *
 * Uses voiceover section_segments as the authoritative timing source (when available).
 * Falls back to scenes metadata durations for backward compatibility with old jobs.
 */
function assembleScenes(
  storyboardOutput: any,
  scenesOutput: any,
  voiceoverOutput?: any
): SceneData[] {
  // Storyboard stage output: { scenes: [{ scene_number, image_url, ... }] }
  const storyboardScenes: any[] = storyboardOutput?.scenes || [];

  // Scenes stage output: { scenes: [{ scene_number, camera_move, duration_seconds, narration }] }
  const sceneMetadata: any[] = scenesOutput?.scenes || [];

  // Voiceover section_segments (authoritative timing from audio word timestamps)
  const sectionSegments: any[] = voiceoverOutput?.section_segments || [];

  // Build lookups by scene/section number for fast access
  const metadataByScene = new Map<number, any>();
  for (const meta of sceneMetadata) {
    const num = meta.scene_number || meta.scene || 0;
    metadataByScene.set(num, meta);
  }

  const segmentBySection = new Map<number, any>();
  for (const seg of sectionSegments) {
    segmentBySection.set(seg.section_number, seg);
  }

  const hasSectionSegments = sectionSegments.length > 0;
  if (hasSectionSegments) {
    console.log(`[StoryboardComposeHandler] Using section_segments for authoritative timing (${sectionSegments.length} segments)`);
  }

  const assembled: SceneData[] = [];

  for (let i = 0; i < storyboardScenes.length; i++) {
    const storyboardScene = storyboardScenes[i];
    const sceneNumber = storyboardScene.scene_number || storyboardScene.scene || i + 1;
    const meta = metadataByScene.get(sceneNumber) || sceneMetadata[i] || {};
    const segment = segmentBySection.get(sceneNumber) || sectionSegments[i];

    let imageUrl: string = storyboardScene.image_url || storyboardScene.url || '';
    if (!imageUrl) {
      // Fallback: reuse the previous scene's image so voiceover isn't playing over a black frame
      const fallbackUrl = assembled.length > 0 ? assembled[assembled.length - 1].imageUrl : '';
      if (!fallbackUrl) {
        console.warn(`[StoryboardComposeHandler] Scene ${sceneNumber} has no image and no fallback, skipping`);
        continue;
      }
      console.warn(`[StoryboardComposeHandler] Scene ${sceneNumber} has no image_url, reusing previous scene image as fallback`);
      imageUrl = fallbackUrl;
    }

    // Duration priority: section_segment (audio truth) > scenes metadata > storyboard scene > 5s default
    let durationSeconds: number;
    if (segment) {
      durationSeconds = segment.duration_seconds;
      // For the last scene, extend to cover remaining audio (accounts for trailing silence/pauses)
      if (i === storyboardScenes.length - 1 && voiceoverOutput?.duration_seconds) {
        const remainingAudio = voiceoverOutput.duration_seconds - (segment.start_time || 0);
        durationSeconds = Math.max(durationSeconds, remainingAudio);
      }
    } else {
      durationSeconds = meta.duration_seconds || storyboardScene.duration_seconds || 5;
    }

    assembled.push({
      imageUrl,
      durationSeconds,
      cameraMove: resolveCameraMove(meta.camera_move, i),
      narration: segment?.narration || meta.narration || storyboardScene.narration,
    });
  }

  // Validate total scene duration vs audio duration
  if (hasSectionSegments && voiceoverOutput?.duration_seconds) {
    const totalSceneDuration = assembled.reduce((sum, s) => sum + s.durationSeconds, 0);
    const audioDuration = voiceoverOutput.duration_seconds;
    const drift = Math.abs(totalSceneDuration - audioDuration);

    if (drift > 1.0 && assembled.length > 0) {
      console.warn(
        `[StoryboardComposeHandler] Duration drift: scenes total ${totalSceneDuration.toFixed(1)}s vs audio ${audioDuration}s. ` +
        `Normalizing scene durations proportionally.`
      );
      // Normalize durations so they sum to the audio duration
      const scale = audioDuration / totalSceneDuration;
      for (const scene of assembled) {
        scene.durationSeconds = Math.round(scene.durationSeconds * scale * 10) / 10;
      }
    }
  }

  return assembled;
}

/**
 * Execute the storyboard composition stage.
 * Calls the video-renderer worker and returns the final video URL.
 */
export async function executeStoryboardComposeStage(
  context: ExecutionContext,
  _stageDef: StageDefinition,
  _engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[StoryboardComposeHandler] Starting storyboard composition stage');

  // 1. Resolve worker URL
  const workerUrl = Deno.env.get('VIDEO_RENDERER_WORKER_URL');
  if (!workerUrl) {
    throw new Error(
      'VIDEO_RENDERER_WORKER_URL environment variable is not configured. ' +
      'Deploy the video-renderer Fly.io worker and set the URL.'
    );
  }

  // 2. Gather previous stage outputs
  const storyboardOutput = context.previousStageOutputs.storyboard;
  const voiceoverOutput = context.previousStageOutputs.full_voiceover;
  const scenesOutput = context.previousStageOutputs.scenes;

  if (!storyboardOutput) {
    throw new Error('final stage requires storyboard stage to be completed');
  }
  if (!voiceoverOutput) {
    throw new Error('final stage requires full_voiceover stage to be completed');
  }

  // 3. Get voiceover URL and word timestamps
  const voiceoverUrl: string = voiceoverOutput.audio_url || voiceoverOutput.url || '';
  if (!voiceoverUrl) {
    throw new Error('full_voiceover stage did not produce an audio_url');
  }

  const wordTimestamps: any[] = voiceoverOutput.word_timestamps || [];

  // 4. Assemble scenes from storyboard + scenes metadata + voiceover segments
  const scenes = assembleScenes(storyboardOutput, scenesOutput, voiceoverOutput);

  if (scenes.length === 0) {
    throw new Error('No scenes with image URLs found for storyboard composition');
  }

  const actualDuration = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  const targetDuration = context.outputConfig?.duration;

  console.log('[StoryboardComposeHandler] Assembled scenes:', {
    count: scenes.length,
    total_duration: actualDuration,
    has_camera_moves: scenes.filter((s) => s.cameraMove.move !== 'hold').length,
  });

  if (targetDuration) {
    const driftPct = Math.abs(actualDuration - targetDuration) / targetDuration * 100;
    console.log(
      `[StoryboardComposeHandler] Duration check: target=${targetDuration}s, actual=${actualDuration.toFixed(1)}s, drift=${driftPct.toFixed(1)}%`
    );
    if (driftPct > 20) {
      console.warn(
        `[StoryboardComposeHandler] Duration drift exceeds 20% — outline or voiceover may not have respected the target duration.`
      );
    }

    // Pad last scene if total duration falls significantly short of target.
    // This happens when the voiceover LLM generates fewer words than needed,
    // resulting in shorter TTS audio. The last scene's image stays on screen
    // while audio ends naturally — better than cutting the video short.
    if (actualDuration < targetDuration * 0.9 && scenes.length > 0) {
      const deficit = targetDuration - actualDuration;
      scenes[scenes.length - 1].durationSeconds += deficit;
      console.log(
        `[StoryboardComposeHandler] Padded last scene by ${deficit.toFixed(1)}s to reach target duration (${targetDuration}s)`
      );
    }
  }

  // 5. Resolve presentation config from raw config
  const rawConfig = context.rawConfiguration || {};
  const rawParams = context.rawGenerationParams || {};

  // subtitle_template lives inside model_config (from blueprint → dispatch → generation_params)
  const subtitleTemplate =
    rawConfig.model_config?.subtitle_template ||
    rawParams.model_config?.subtitle_template ||
    rawConfig.subtitle_style || rawParams.subtitle_style; // legacy fallback
  const subtitleStyle = resolveSubtitleStyle(subtitleTemplate);
  console.log(`[StoryboardComposeHandler] Subtitle: template=${subtitleTemplate}, resolved=${subtitleStyle}`);

  const backgroundMusicUrl: string | undefined =
    rawConfig.background_music_url || rawParams.background_music_url;

  const backgroundMusicVolume: number =
    rawConfig.background_music_volume ?? rawParams.background_music_volume ?? 0.10;

  // 6. Build brand config
  const brand = buildBrandConfig(context);

  // 7. Get Supabase credentials and encryption key for the worker to upload to user storage
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY') || '';

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for video renderer worker');
  }

  // Resolve orientation — storyboard defaults to landscape but can be overridden
  const orientation: 'portrait' | 'landscape' =
    rawConfig.orientation === 'portrait' ||
    rawParams.orientation === 'portrait' ||
    context.outputConfig?.aspectRatio === '9:16'
      ? 'portrait'
      : 'landscape';

  console.log('[StoryboardComposeHandler] Render config:', {
    scene_count: scenes.length,
    word_timestamps: wordTimestamps.length,
    subtitle_style: subtitleStyle,
    orientation,
    has_background_music: !!backgroundMusicUrl,
    background_music_volume: backgroundMusicVolume,
  });

  // 8. Transform to EditorState (track-based data model)
  const editorState = storyboardToEditorState({
    scenes,
    voiceoverUrl,
    wordTimestamps,
    subtitleStyle,
    backgroundMusicUrl,
    backgroundMusicVolume,
    brand,
    orientation,
  });

  console.log('[StoryboardComposeHandler] EditorState:', {
    track_count: editorState.tracks.length,
    asset_count: editorState.assets.length,
    total_items: editorState.tracks.reduce((sum, t) => sum + t.items.length, 0),
    duration_frames: editorState.durationInFrames,
    dimensions: `${editorState.width}x${editorState.height}`,
  });

  // 9. Build the render request with EditorState
  const renderRequest = {
    composition_id: 'EditorComposition' as const,
    output_id: context.outputId,
    stage_id: context.stageId,
    props: editorState,
    supabase_url: supabaseUrl,
    supabase_key: supabaseServiceKey,
    encryption_key: encryptionKey || undefined,
  };

  // 10. Fire render request to the worker (async — worker responds 202 immediately)
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
      throw new Error(`Video renderer worker rejected request (${response.status}): ${errorBody}`);
    }

    const accepted = await response.json();
    console.log('[StoryboardComposeHandler] Render accepted by worker:', accepted);
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        'Video renderer worker did not respond within 30s. ' +
        'The worker may be starting up or under heavy load.'
      );
    }
    throw error;
  }

  const totalDuration = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  console.log('[StoryboardComposeHandler] Render dispatched — worker will write results directly to DB');

  return {
    content: {
      composition_id: 'EditorComposition',
      editor_state: editorState,
      scene_count: scenes.length,
      total_duration_seconds: totalDuration,
      dispatched_at: new Date().toISOString(),
    },
    status: 'generating',
  };
}

export default executeStoryboardComposeStage;
