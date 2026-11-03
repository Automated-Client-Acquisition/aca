/**
 * Custom Handler: Video Compose Stage
 *
 * Unified composition handler for the `video` pipeline.
 * Gathers outputs from all preceding stages (whatever ran based on resolveVideoStages),
 * builds UnifiedVideoProps, syncs shot durations to audio, and dispatches to the
 * video-renderer Fly.io worker with composition_id: 'EditorComposition'.
 *
 * Handles all source modes:
 * - URL screenshots (web_capture output)
 * - Uploaded video (video_ingest output + source video URL)
 * - Uploaded images (passed through video_config)
 * - AI-generated images (images stage output)
 * - Prompt-only (no source visuals)
 *
 * Voice modes:
 * - voiceover/avatar: uses voiceover stage output
 * - keep_original: uses transcribe stage output (original audio)
 * - none: no audio
 *
 * Worker URL is read from the VIDEO_RENDERER_WORKER_URL env var.
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
// ClipData format used by the deployed Fly.io Remotion worker

// ============= Types =============

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

// ============= Shared Utilities =============

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
    console.warn('[VideoComposeHandler] No word timestamps — keeping director durations');
    return shots;
  }

  const audioDuration = audioDurationSeconds || wordTimestamps[wordTimestamps.length - 1].end;
  const directorTotal = shots.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);

  console.log('[VideoComposeHandler] Duration sync:', {
    director_total: directorTotal,
    audio_duration: audioDuration,
    mismatch_seconds: Math.abs(directorTotal - audioDuration),
    word_count: wordTimestamps.length,
  });

  // Try word-level alignment
  const normalizedTimestampWords = wordTimestamps.map((wt) => normalizeWord(wt.word));
  let tsIndex = 0;

  const alignedShots: Array<{ shotIndex: number; startTime: number; endTime: number }> = [];

  for (let i = 0; i < shots.length; i++) {
    const narration: string = shots[i].narration || '';
    if (!narration.trim()) {
      alignedShots.push({ shotIndex: i, startTime: -1, endTime: -1 });
      continue;
    }

    const narrationWords = narration
      .split(/\s+/)
      .map(normalizeWord)
      .filter((w) => w.length > 0);

    if (narrationWords.length === 0) {
      alignedShots.push({ shotIndex: i, startTime: -1, endTime: -1 });
      continue;
    }

    let firstMatch = -1;
    let lastMatch = -1;
    const searchStart = tsIndex;

    for (let j = searchStart; j < normalizedTimestampWords.length; j++) {
      if (normalizedTimestampWords[j] === narrationWords[0]) {
        firstMatch = j;
        break;
      }
    }

    if (firstMatch === -1) {
      alignedShots.push({ shotIndex: i, startTime: -1, endTime: -1 });
      continue;
    }

    lastMatch = firstMatch;
    let nIdx = 1;
    let tIdx = firstMatch + 1;

    while (nIdx < narrationWords.length && tIdx < normalizedTimestampWords.length) {
      if (normalizedTimestampWords[tIdx] === narrationWords[nIdx]) {
        lastMatch = tIdx;
        nIdx++;
      }
      tIdx++;
      if (tIdx - firstMatch > narrationWords.length * 3) break;
    }

    alignedShots.push({
      shotIndex: i,
      startTime: wordTimestamps[firstMatch].start,
      endTime: wordTimestamps[lastMatch].end,
    });

    tsIndex = lastMatch + 1;
  }

  const alignedCount = alignedShots.filter((a) => a.startTime >= 0).length;
  const narrationShotCount = shots.filter((s: any) => (s.narration || '').trim()).length;

  console.log('[VideoComposeHandler] Word alignment:', {
    aligned: alignedCount,
    narration_shots: narrationShotCount,
    total_shots: shots.length,
  });

  if (alignedCount < narrationShotCount * 0.5) {
    console.warn('[VideoComposeHandler] Word alignment poor — falling back to proportional scaling');
    const scale = directorTotal > 0 ? audioDuration / directorTotal : 1;
    return shots.map((s: any) => ({
      ...s,
      duration: Math.max(Math.round((s.duration || 2) * scale * 10) / 10, 1),
    }));
  }

  const syncedShots = shots.map((shot: any, i: number) => {
    const alignment = alignedShots[i];

    if (alignment.startTime >= 0 && alignment.endTime > alignment.startTime) {
      const speechDuration = alignment.endTime - alignment.startTime;
      const paddedDuration = speechDuration + 0.3;
      return {
        ...shot,
        duration: Math.max(Math.round(paddedDuration * 10) / 10, 1),
      };
    }

    return {
      ...shot,
      duration: Math.max(shot.duration || 1.5, 1),
    };
  });

  const syncedTotal = syncedShots.reduce((sum: number, s: any) => sum + s.duration, 0);
  console.log('[VideoComposeHandler] Synced durations:', {
    original_total: directorTotal,
    synced_total: syncedTotal,
    audio_duration: audioDuration,
  });

  return syncedShots;
}

// ============= Main Handler =============

/**
 * Execute the unified video composition stage.
 * Gathers all preceding stage outputs, builds props, and dispatches to worker.
 */
export async function executeVideoComposeStage(
  context: ExecutionContext,
  _stageDef: StageDefinition,
  _engine: ExecutionEngine,
): Promise<StageResult> {
  console.log('[VideoComposeHandler] Starting unified video composition stage');

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
  const transcribeOutput = context.previousStageOutputs.transcribe;
  const directorOutput = context.previousStageOutputs.director;
  const voiceoverOutput = context.previousStageOutputs.voiceover;
  const bRollOutput = context.previousStageOutputs.b_roll;
  const imagesOutput = context.previousStageOutputs.images;

  if (!directorOutput) {
    throw new Error('composition stage requires director stage to be completed');
  }

  // 3. Extract VideoConfig
  const rawConfig = context.rawConfiguration || {};
  const rawParams = context.rawGenerationParams || {};
  const videoConfig = rawParams.video_config || rawConfig.video_config || {};

  const voiceMode: string = videoConfig.voiceMode || videoConfig.voice_mode || 'voiceover';
  const imageMode: string = videoConfig.imageMode || videoConfig.image_mode || 'none';
  const source: string = videoConfig.source || 'prompt_only';

  // 4. Get shots (prefer B-roll enriched)
  const rawShots = (bRollOutput?.shots?.length ? bRollOutput.shots : directorOutput.shots) || [];
  if (!rawShots.length) {
    throw new Error('Director stage produced no shots for composition');
  }

  // 5. Map AI-generated image URLs into shots (storyboard mode)
  let shotsWithImages = rawShots;
  if (imageMode === 'ai_generated' && imagesOutput?.scenes) {
    const imageScenes: any[] = imagesOutput.scenes || [];
    shotsWithImages = rawShots.map((shot: any, index: number) => {
      if (shot.layout === 'scene_image' && shot.image_prompt) {
        // Find matching scene by index or by matching image_prompt
        const matchingScene = imageScenes[index] || imageScenes.find(
          (s: any) => s.scene_number === index + 1
        );
        if (matchingScene?.image_url) {
          return { ...shot, scene_image_url: matchingScene.image_url };
        }
      }
      return shot;
    });
    console.log('[VideoComposeHandler] Mapped AI-generated images into shots:', {
      total_shots: shotsWithImages.length,
      shots_with_images: shotsWithImages.filter((s: any) => s.scene_image_url).length,
    });
  }

  // 6. Map uploaded image URLs into shots
  if (source === 'upload_images') {
    const uploadedUrls: string[] = videoConfig.uploadedImageUrls || videoConfig.uploaded_image_urls || [];
    if (uploadedUrls.length > 0) {
      shotsWithImages = shotsWithImages.map((shot: any) => {
        if (shot.layout === 'scene_image' && shot.screenshot_index != null) {
          const imageUrl = uploadedUrls[shot.screenshot_index];
          if (imageUrl) {
            return { ...shot, scene_image_url: imageUrl };
          }
        }
        return shot;
      });
      console.log('[VideoComposeHandler] Mapped uploaded images into shots');
    }
  }

  // 7. Transform screenshots from web_capture or video_ingest
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

  // 8. Resolve audio and timestamps
  let audioUrl: string | null = null;
  let originalAudioUrl: string | null = null;
  let avatarVideoUrl: string | null = null;
  let wordTimestamps: Array<{ word: string; start: number; end: number }> = [];
  let audioDuration = 0;

  if (voiceMode === 'keep_original' && transcribeOutput) {
    originalAudioUrl = transcribeOutput.audio_url || null;
    wordTimestamps = transcribeOutput.word_timestamps || [];
    audioDuration = transcribeOutput.duration_seconds || 0;
    console.log('[VideoComposeHandler] Using original audio (keep_original mode)');
  } else if (voiceoverOutput) {
    audioUrl = voiceoverOutput.audio_url || null;
    wordTimestamps = voiceoverOutput.word_timestamps || [];
    avatarVideoUrl = voiceoverOutput.avatar_video_url || null;
    audioDuration = voiceoverOutput.duration_seconds || 0;
  } else if (voiceMode === 'none') {
    console.log('[VideoComposeHandler] No voice mode — video without audio narration');
  } else if (voiceMode === 'keep_original') {
    throw new Error('keep_original mode requires transcribe stage output with audio_url');
  } else {
    throw new Error('No voice stage output available for composition');
  }

  const hasAudio = !!(audioUrl || originalAudioUrl);

  // 9. Sync shot durations to audio
  const shots = hasAudio
    ? syncShotDurationsToAudio(shotsWithImages, wordTimestamps, audioDuration)
    : shotsWithImages;

  // 10. Resolve orientation and subtitle style
  const orientation: 'portrait' | 'landscape' =
    videoConfig.orientation === 'landscape' ||
    rawParams.orientation === 'landscape' ||
    rawConfig.orientation === 'landscape' ||
    context.outputConfig?.aspectRatio === '16:9'
      ? 'landscape'
      : 'portrait';

  const subtitleStyle: string =
    videoConfig.subtitleStyle || videoConfig.subtitle_style ||
    rawParams.model_config?.subtitle_template ||
    rawConfig.model_config?.subtitle_template ||
    rawParams.subtitle_style || rawConfig.subtitle_style ||
    'bounce_pop';

  const transitionType: string =
    videoConfig.transitionType || videoConfig.transition_type ||
    rawParams.transition_type || rawConfig.transition_type ||
    'cut_hard';

  const backgroundMusicUrl: string | undefined =
    videoConfig.backgroundMusicUrl || videoConfig.background_music_url ||
    rawConfig.background_music_url || rawParams.background_music_url;

  const backgroundMusicVolume: number =
    videoConfig.backgroundMusicVolume ?? videoConfig.background_music_volume ??
    rawConfig.background_music_volume ?? rawParams.background_music_volume ?? 0.10;

  // 11. Build brand config
  const brand = buildBrandConfig(context);

  // 12. Get Supabase credentials
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for video renderer worker');
  }

  // 13. Resolve source video URL (for video_clip layouts)
  const sourceVideoUrl: string | null = videoIngestOutput?.source_url || null;
  const sourceDurationSeconds: number = videoIngestOutput?.video_duration_seconds || transcribeOutput?.duration_seconds || 0;

  console.log('[VideoComposeHandler] Render config:', {
    shot_count: shots.length,
    screenshot_count: screenshots.length,
    source,
    voice_mode: voiceMode,
    image_mode: imageMode,
    orientation,
    subtitle_style: subtitleStyle,
    word_timestamp_count: wordTimestamps.length,
    has_avatar_video: !!avatarVideoUrl,
    has_audio: hasAudio,
    has_source_video: !!sourceVideoUrl,
    has_uploaded_images: (videoConfig.uploadedImageUrls || videoConfig.uploaded_image_urls || []).length,
  });

  // 14. Build scene descriptions for editor-chat prompt
  const sceneDescriptions = shots.map((shot: any, i: number) => {
    const imageUrl = shot.scene_image_url || (shot.screenshot_index != null ? screenshots[shot.screenshot_index]?.url : null);
    return `Scene ${i + 1} (${shot.duration || 3}s): ${shot.narration || shot.heading || ''}${shot.layout ? ` [layout: ${shot.layout}]` : ''}${shot.camera_move ? ` [camera: ${shot.camera_move}]` : ''}${imageUrl ? ` [image: ${imageUrl}]` : ''}`;
  }).join('\n');

  const totalDuration = shots.reduce((sum: number, s: any) => sum + (s.duration || 3), 0);

  // 15. Build project state for editor-chat (mimics what the frontend sends)
  const projectState = {
    settings: {
      aspect_ratio: orientation,
      caption_style: subtitleStyle,
    },
    scenes: shots.map((shot: any, i: number) => ({
      index: i,
      duration: shot.duration || 3,
      media_type: shot.scene_image_url ? 'image' : 'color',
      has_media: !!shot.scene_image_url,
      text: shot.narration || '',
      transition: 'fade',
    })),
    scene_count: shots.length,
    has_remotion_code: false,
  };

  // 16. Generate Remotion code via direct OpenRouter call (faster than editor-chat SSE)
  console.log('[VideoComposeHandler] Generating Remotion composition code via OpenRouter...');

  const decryptedKey = context.apiKeys?.['openrouter'];
  if (!decryptedKey) {
    throw new Error('OpenRouter API key required for Remotion code generation');
  }

  const imageList = shots
    .filter((s: any) => s.scene_image_url)
    .map((s: any, i: number) => `const IMAGE_${i + 1} = "${s.scene_image_url}";`)
    .join('\n');

  const codeGenPrompt = `Write a complete Remotion TSX composition for this video. Output ONLY the code, no explanation.

## Rules
- No import statements (deps are pre-injected: React, useCurrentFrame, useVideoConfig, interpolate, spring, Img, Audio, Sequence, AbsoluteFill, Video are globals)
- Must start with metadata comments: // @aspect ${orientation}  // @duration ${totalDuration}s  // @fps 30
- Must end with: export default ComponentName
- ALL animations use useCurrentFrame() + interpolate(). NO CSS animations, NO Tailwind animation classes
- Use Img for images (not img), Audio for audio
- Make it cinematic: Ken Burns (scale + translateX/Y interpolation) on images, spring() for text entrances, opacity fades between scenes
- Bold typography: large font sizes (48-80px), font-weight 900, text shadows
- The first 3 seconds must be visually explosive - fast zoom, bold text punch-in
- Use the brand colors throughout

## Video Data
Topic: ${context.ideaContext || 'Video content'}
Aspect: ${orientation} (${orientation === 'portrait' ? '1080x1920' : '1920x1080'})
Total duration: ${totalDuration}s at 30fps = ${Math.round(totalDuration * 30)} frames
Voiceover: ${audioUrl ? `"${audioUrl}"` : 'none'}
Brand: primary=${brand.primary_color} accent=${brand.accent_color} bg=${brand.background_color} text=${brand.text_color} font="${brand.font_family}"

## Scene Images
${imageList || '// No images - use solid color backgrounds with brand colors'}

## Scenes (with timing)
${shots.map((shot: any, i: number) => {
    const startFrame = shots.slice(0, i).reduce((sum: number, s: any) => sum + Math.round((s.duration || 3) * 30), 0);
    const durationFrames = Math.round((shot.duration || 3) * 30);
    return `// Scene ${i + 1}: frames ${startFrame}-${startFrame + durationFrames} (${shot.duration || 3}s)
// Narration: "${shot.narration || ''}"
// Layout: ${shot.layout || 'full_screen'}, Camera: ${shot.camera_move || 'ken_burns_slow'}`;
  }).join('\n')}

Write the composition now. Use Sequence components for scene timing. Each scene should have Ken Burns zoom on its image, animated text that enters with spring(), and smooth transitions.`;

  const codeGenResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${decryptedKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': supabaseUrl,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4',
      messages: [
        { role: 'user', content: codeGenPrompt }
      ],
      max_tokens: 16000,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!codeGenResponse.ok) {
    const errText = await codeGenResponse.text();
    throw new Error(`OpenRouter code gen failed (${codeGenResponse.status}): ${errText}`);
  }

  const codeGenResult = await codeGenResponse.json();
  let remotionCode = codeGenResult.choices?.[0]?.message?.content?.trim() || '';

  // Strip markdown code fences if present
  remotionCode = remotionCode.replace(/^```(?:tsx?|jsx?|javascript|typescript)?\n?/i, '').replace(/\n?```$/i, '').trim();

  if (!remotionCode || remotionCode.length < 100) {
    throw new Error('Code generation produced insufficient output');
  }

  console.log('[VideoComposeHandler] Generated Remotion code:', remotionCode.length, 'chars');

  // 18. Create a video_project to store the composition
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.81.1');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: videoProject, error: projectError } = await supabase
    .from('video_projects')
    .insert({
      organization_id: context.organizationId,
      title: context.ideaContext?.slice(0, 80) || 'Pipeline Video',
      remotion_code: remotionCode,
      settings: { aspect_ratio: orientation, caption_style: subtitleStyle },
      voiceover: audioUrl ? {
        url: audioUrl,
        source: 'ai',
        word_timestamps: wordTimestamps,
        duration: audioDuration,
      } : undefined,
      music: backgroundMusicUrl ? {
        url: backgroundMusicUrl,
        volume: backgroundMusicVolume,
        source: 'generated',
      } : undefined,
      status: 'draft',
    })
    .select('id')
    .single();

  if (projectError) {
    console.error('[VideoComposeHandler] Failed to create video_project:', projectError);
  } else {
    console.log('[VideoComposeHandler] Created video_project:', videoProject.id);

    // Link the video_project to the generation job
    await supabase
      .from('content_generation_jobs')
      .update({ video_project_id: videoProject.id })
      .eq('id', context.jobId);
  }

  // 19. Send remotion_code to the render worker
  const renderRequest = {
    output_id: context.outputId,
    organization_id: context.organizationId,
    remotion_code: remotionCode,
    audio_url: audioUrl || originalAudioUrl || undefined,
    word_timestamps: wordTimestamps.length > 0 ? wordTimestamps : undefined,
    aspect_ratio: orientation,
    caption_style: subtitleStyle === 'none' ? 'none' : 'hormozi',
    brand,
    background_music_url: backgroundMusicUrl,
    background_music_volume: backgroundMusicVolume,
    supabase_url: supabaseUrl,
    supabase_key: supabaseServiceKey,
  };

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
    console.log('[VideoComposeHandler] Render dispatched:', acceptResponse);
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Video renderer worker did not respond within 30s.');
    }
    throw error;
  }

  // 20. Return 'generating' -- worker renders async and writes results to DB
  return {
    content: {
      remotion_code_length: remotionCode.length,
      video_project_id: videoProject?.id,
      orientation,
      shot_count: shots.length,
      voice_mode: voiceMode,
      source,
      dispatched_at: new Date().toISOString(),
    },
    status: 'generating',
  };
}

export default executeVideoComposeStage;
