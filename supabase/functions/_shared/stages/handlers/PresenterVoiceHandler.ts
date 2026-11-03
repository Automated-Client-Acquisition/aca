/**
 * Custom Handler: Presenter Voice + Avatar Stage
 *
 * Handles the two-step TTS and lip-sync avatar generation for the presenter_video pipeline:
 *
 * Step A: ElevenLabs TTS with word-level timestamps
 *   - Calls /v1/text-to-speech/{voice_id}/with-timestamps
 *   - Converts character-level alignment → word-level timestamps
 *   - Uploads audio to Supabase Storage
 *
 * Step B: Lip-sync avatar video generation (routed by config.lip_sync_provider)
 *   - 'elevenlabs' → ElevenLabs /v1/video/generate (simplest, one vendor)
 *   - 'heygen'     → HeyGen /v2/video/generate (premium quality, no base video needed)
 *   - 'sync_labs'  → fal.ai Sync Labs lipsync-2 (max realism, requires base video)
 *
 * Step C (optional): Background removal via fal.ai BiRefNet
 *   - Applied when lip_sync_provider is 'heygen' (renders on green BG)
 *   - Applied when config.remove_background is true
 *
 * Returns: { audio_url, avatar_video_url, word_timestamps, duration_seconds, provider }
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { ElevenLabsProvider } from '../../providers/ElevenLabsProvider.ts';
import { resolveVoiceId } from '../../execution/ExecutionContext.ts';

// fal.ai is imported dynamically to avoid top-level module resolution issues
// when the handler is registered but not yet called.

// ElevenLabs TTS with-timestamps endpoint returns character-level alignment
interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

type LipSyncProvider = 'elevenlabs' | 'heygen' | 'sync_labs';

// HeyGen video generation polling interval (ms) and max wait (ms)
const HEYGEN_POLL_INTERVAL_MS = 5_000;
const HEYGEN_MAX_WAIT_MS = 300_000; // 5 minutes

// ElevenLabs video generation polling interval and max wait
const ELEVENLABS_VIDEO_POLL_INTERVAL_MS = 5_000;
const ELEVENLABS_VIDEO_MAX_WAIT_MS = 300_000;

/**
 * Convert ElevenLabs character-level alignment to word-level timestamps.
 */
function extractWordTimestamps(alignment: ElevenLabsAlignment): WordTimestamp[] {
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;

  const wordTimestamps: WordTimestamp[] = [];
  let currentWord = '';
  let wordStart: number | null = null;
  let wordEnd: number | null = null;

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    const startTime = character_start_times_seconds[i];
    const endTime = character_end_times_seconds[i];

    // Whitespace or punctuation at word boundary
    if (char === ' ' || char === '\n' || char === '\t') {
      if (currentWord.trim().length > 0 && wordStart !== null && wordEnd !== null) {
        wordTimestamps.push({
          word: currentWord.trim(),
          start: wordStart,
          end: wordEnd,
        });
      }
      currentWord = '';
      wordStart = null;
      wordEnd = null;
    } else {
      // Accumulate character into current word
      if (wordStart === null) {
        wordStart = startTime;
      }
      wordEnd = endTime;
      currentWord += char;
    }
  }

  // Flush last word
  if (currentWord.trim().length > 0 && wordStart !== null && wordEnd !== null) {
    wordTimestamps.push({
      word: currentWord.trim(),
      start: wordStart,
      end: wordEnd,
    });
  }

  return wordTimestamps;
}

/**
 * Generate TTS audio with word-level timestamps from ElevenLabs.
 * Returns: { audioBuffer, audioUrl, wordTimestamps, durationSeconds }
 */
async function generateTTSWithTimestamps(
  fullScript: string,
  voiceId: string,
  apiKey: string,
  outputId: string,
  supabase: any
): Promise<{
  audioBuffer: ArrayBuffer;
  audioUrl: string;
  wordTimestamps: WordTimestamp[];
  durationSeconds: number;
}> {
  const baseUrl = 'https://api.elevenlabs.io/v1';
  const modelId = 'eleven_multilingual_v2';

  console.log('[PresenterVoiceHandler] Generating TTS with timestamps:', {
    voice_id: voiceId,
    model: modelId,
    script_length: fullScript.length,
  });

  const response = await fetch(`${baseUrl}/text-to-speech/${voiceId}/with-timestamps`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      text: fullScript,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
      output_format: 'mp3_44100_128',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`ElevenLabs TTS with-timestamps error ${response.status}: ${errorBody}`);
  }

  const ttsResult = await response.json();

  // Decode base64 audio
  const audioBase64: string = ttsResult.audio_base64;
  if (!audioBase64) {
    throw new Error('ElevenLabs TTS did not return audio_base64');
  }

  const binaryString = atob(audioBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const audioBuffer = bytes.buffer;

  // Extract word-level timestamps
  const alignment: ElevenLabsAlignment = ttsResult.alignment || {
    characters: [],
    character_start_times_seconds: [],
    character_end_times_seconds: [],
  };

  const wordTimestamps = extractWordTimestamps(alignment);

  // Calculate duration from last timestamp
  const durationSeconds =
    wordTimestamps.length > 0
      ? wordTimestamps[wordTimestamps.length - 1].end
      : audioBuffer.byteLength / (128 * 125); // Rough estimate at 128kbps

  console.log('[PresenterVoiceHandler] TTS complete:', {
    word_count: wordTimestamps.length,
    duration_seconds: durationSeconds,
    audio_bytes: audioBuffer.byteLength,
  });

  // Upload audio to Supabase Storage
  const fileName = `presenter_audio_${outputId}_${Date.now()}.mp3`;
  const audioUrl = await ElevenLabsProvider.uploadToStorage(supabase, audioBuffer, fileName);

  return { audioBuffer, audioUrl, wordTimestamps, durationSeconds };
}

/**
 * Generate avatar video via ElevenLabs lip-sync.
 * Uploads reference photo + audio → polls for talking head video.
 */
async function generateElevenLabsAvatarVideo(
  avatarPhotoUrl: string,
  audioUrl: string,
  apiKey: string
): Promise<string> {
  const baseUrl = 'https://api.elevenlabs.io/v1';

  console.log('[PresenterVoiceHandler] Generating ElevenLabs avatar video');

  // Build multipart form
  const formData = new FormData();

  // Fetch the avatar photo
  const photoResponse = await fetch(avatarPhotoUrl);
  if (!photoResponse.ok) {
    throw new Error(`Failed to fetch avatar photo: ${photoResponse.status}`);
  }
  const photoBlob = await photoResponse.blob();
  formData.append('image', photoBlob, 'avatar.jpg');

  // Fetch the audio
  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new Error(`Failed to fetch TTS audio: ${audioResponse.status}`);
  }
  const audioBlob = await audioResponse.blob();
  formData.append('audio', audioBlob, 'voiceover.mp3');

  const initResponse = await fetch(`${baseUrl}/video/generate`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: formData,
  });

  if (!initResponse.ok) {
    const errorBody = await initResponse.text();
    throw new Error(`ElevenLabs video generate error ${initResponse.status}: ${errorBody}`);
  }

  const initResult = await initResponse.json();
  const videoId: string = initResult.video_id || initResult.id;

  if (!videoId) {
    throw new Error('ElevenLabs video generate did not return a video_id');
  }

  console.log('[PresenterVoiceHandler] ElevenLabs video job started:', videoId);

  // Poll for completion
  const startTime = Date.now();
  while (Date.now() - startTime < ELEVENLABS_VIDEO_MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, ELEVENLABS_VIDEO_POLL_INTERVAL_MS));

    const statusResponse = await fetch(`${baseUrl}/video/${videoId}`, {
      headers: { 'xi-api-key': apiKey },
    });

    if (!statusResponse.ok) {
      console.warn('[PresenterVoiceHandler] Status check failed, retrying...');
      continue;
    }

    const statusResult = await statusResponse.json();
    const status = statusResult.status || statusResult.state;

    console.log('[PresenterVoiceHandler] ElevenLabs video status:', status);

    if (status === 'completed' || status === 'succeeded' || status === 'ready') {
      const videoUrl = statusResult.video_url || statusResult.url;
      if (!videoUrl) {
        throw new Error('ElevenLabs video completed but no video_url returned');
      }
      return videoUrl;
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(`ElevenLabs video generation failed: ${statusResult.error || 'Unknown error'}`);
    }
  }

  throw new Error(`ElevenLabs video generation timed out after ${ELEVENLABS_VIDEO_MAX_WAIT_MS / 1000}s`);
}

/**
 * Generate avatar video via HeyGen API.
 * No base video needed — picks from HeyGen avatar library.
 * Renders on green background for post-processing background removal.
 */
async function generateHeyGenAvatarVideo(
  heygenAvatarId: string,
  ttsAudioUrl: string,
  apiKey: string,
  orientation: string
): Promise<string> {
  console.log('[PresenterVoiceHandler] Generating HeyGen avatar video:', {
    avatar_id: heygenAvatarId,
    orientation,
  });

  const isPortrait = orientation === 'portrait';
  const dimension = isPortrait
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };

  // Initiate HeyGen video generation
  const initResponse = await fetch('https://api.heygen.com/v2/video/generate', {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_inputs: [
        {
          character: {
            type: 'avatar',
            avatar_id: heygenAvatarId,
            avatar_style: 'normal',
          },
          voice: {
            type: 'audio',
            audio_url: ttsAudioUrl,
          },
        },
      ],
      dimension,
      // Green background for BiRefNet background removal
      background: { type: 'color', value: '#00FF00' },
    }),
  });

  if (!initResponse.ok) {
    const errorBody = await initResponse.text();
    throw new Error(`HeyGen video generate error ${initResponse.status}: ${errorBody}`);
  }

  const initResult = await initResponse.json();
  const videoId: string = initResult.data?.video_id;

  if (!videoId) {
    throw new Error(`HeyGen video generate did not return video_id. Response: ${JSON.stringify(initResult)}`);
  }

  console.log('[PresenterVoiceHandler] HeyGen video job started:', videoId);

  // Poll for completion
  const startTime = Date.now();
  while (Date.now() - startTime < HEYGEN_MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, HEYGEN_POLL_INTERVAL_MS));

    const statusResponse = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
      headers: { 'X-Api-Key': apiKey },
    });

    if (!statusResponse.ok) {
      console.warn('[PresenterVoiceHandler] HeyGen status check failed, retrying...');
      continue;
    }

    const statusResult = await statusResponse.json();
    const status = statusResult.data?.status;

    console.log('[PresenterVoiceHandler] HeyGen video status:', status);

    if (status === 'completed') {
      const videoUrl = statusResult.data?.video_url;
      if (!videoUrl) {
        throw new Error('HeyGen video completed but no video_url returned');
      }
      return videoUrl;
    }

    if (status === 'failed') {
      throw new Error(`HeyGen video generation failed: ${statusResult.data?.error || 'Unknown error'}`);
    }
  }

  throw new Error(`HeyGen video generation timed out after ${HEYGEN_MAX_WAIT_MS / 1000}s`);
}

/**
 * Generate avatar video via fal.ai Sync Labs lipsync-2.
 * Requires a base avatar video (real person recording) + new TTS audio.
 */
async function generateSyncLabsAvatarVideo(
  baseAvatarVideoUrl: string,
  ttsAudioUrl: string,
  apiKey: string
): Promise<string> {
  console.log('[PresenterVoiceHandler] Generating Sync Labs avatar video');

  // Dynamic import of fal.ai client
  const fal = await import('npm:@fal-ai/serverless-client@^0.15');

  fal.config({ credentials: apiKey });

  const result = await fal.subscribe('fal-ai/sync-lipsync/v2', {
    input: {
      video_url: baseAvatarVideoUrl,
      audio_url: ttsAudioUrl,
      model: 'lipsync-2',
    },
  });

  const videoUrl = (result as any)?.video?.url;
  if (!videoUrl) {
    throw new Error(`Sync Labs did not return a video URL. Result: ${JSON.stringify(result)}`);
  }

  console.log('[PresenterVoiceHandler] Sync Labs video complete:', videoUrl);
  return videoUrl;
}

/**
 * Remove background from avatar video using fal.ai BiRefNet.
 * Processes video frames and returns a transparent-background version.
 */
async function removeAvatarBackground(
  avatarVideoUrl: string,
  apiKey: string
): Promise<string> {
  console.log('[PresenterVoiceHandler] Removing background via fal.ai BiRefNet');

  const fal = await import('npm:@fal-ai/serverless-client@^0.15');
  fal.config({ credentials: apiKey });

  const result = await fal.subscribe('fal-ai/birefnet', {
    input: {
      image_url: avatarVideoUrl,
      model: 'General Use (Light)',
    },
  });

  const outputUrl = (result as any)?.image?.url;
  if (!outputUrl) {
    throw new Error(`BiRefNet did not return output URL. Result: ${JSON.stringify(result)}`);
  }

  console.log('[PresenterVoiceHandler] Background removal complete:', outputUrl);
  return outputUrl;
}

/**
 * Main handler: voice + avatar stage for presenter_video pipeline.
 */
export async function executeVoiceAvatarStage(
  context: ExecutionContext,
  _stageDef: StageDefinition,
  engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[PresenterVoiceHandler] Starting voice + avatar stage');

  const supabase = engine.getSupabase();

  // 1. Get the full script from available sources
  // Priority: outline sections → rewrite text → director full_script
  // In the unified video pipeline, voice runs BEFORE the director,
  // so we read from outline or rewrite. Fall back to director for legacy pipelines.
  let fullScript = '';

  const outlineOutput = context.previousStageOutputs.outline;
  const rewriteOutput = context.previousStageOutputs.rewrite;
  const directorOutput = context.previousStageOutputs.director;

  if (outlineOutput?.sections) {
    // Concatenate narration from outline sections
    const sections: any[] = outlineOutput.sections || [];
    fullScript = sections
      .map((s: any) => (s.narration || '').trim())
      .filter(Boolean)
      .join('\n\n');
    console.log('[PresenterVoiceHandler] Using narration from outline sections:', {
      section_count: sections.length,
      script_length: fullScript.length,
    });
  } else if (rewriteOutput?.text) {
    // Use rewritten text
    fullScript = rewriteOutput.text;
    console.log('[PresenterVoiceHandler] Using rewritten text:', {
      script_length: fullScript.length,
    });
  } else if (directorOutput?.full_script) {
    // Legacy: director already ran (presenter_video pipeline)
    fullScript = directorOutput.full_script;
    console.log('[PresenterVoiceHandler] Using director full_script:', {
      script_length: fullScript.length,
    });
  }

  if (!fullScript) {
    throw new Error(
      'Voice stage requires a script source: outline sections, rewrite text, or director full_script. ' +
      'None were found in previous stage outputs.'
    );
  }

  // 2. Get API keys
  const elevenLabsKey = context.apiKeys.elevenlabs;
  if (!elevenLabsKey) {
    throw new Error('ElevenLabs API key not configured');
  }

  // 3. Resolve voice ID from character (canonical) > blueprint fallback > default
  const rawConfig = context.rawConfiguration || {};
  const voiceId: string = rawConfig.voice_id || resolveVoiceId(context);

  // 4. Step A — TTS with word-level timestamps
  const { audioUrl, wordTimestamps, durationSeconds } = await generateTTSWithTimestamps(
    fullScript,
    voiceId,
    elevenLabsKey,
    context.outputId,
    supabase
  );

  console.log('[PresenterVoiceHandler] TTS audio ready:', audioUrl);

  // 5. Resolve avatar mode and lip-sync provider from config
  const rawParams = context.rawGenerationParams || {};

  // avatar_type: 'none' means voiceover-only — skip lip-sync entirely
  const avatarType: string =
    rawConfig.avatar_type ||
    rawParams.avatar_type ||
    'none';

  const lipSyncProvider: LipSyncProvider =
    rawConfig.lip_sync_provider ||
    rawParams.lip_sync_provider ||
    'elevenlabs';

  const orientation: string =
    rawConfig.video_orientation ||
    rawParams.video_orientation ||
    context.outputConfig?.aspectRatio === '9:16' ? 'portrait' : 'landscape';

  const removeBackground: boolean =
    rawConfig.remove_background === true ||
    rawParams.remove_background === true ||
    lipSyncProvider === 'heygen'; // Always remove BG for HeyGen (rendered on green)

  console.log('[PresenterVoiceHandler] Lip-sync configuration:', {
    avatar_type: avatarType,
    provider: lipSyncProvider,
    orientation,
    remove_background: removeBackground,
  });

  // 6. Step B — Avatar video generation (routing)
  // Skipped entirely when avatarType is 'none' (voiceover-only mode).
  // Otherwise optional — if it fails, we continue with audio-only mode.
  let avatarVideoUrl: string | null = null;

  if (avatarType === 'none') {
    console.log('[PresenterVoiceHandler] Voiceover-only mode — skipping lip-sync avatar generation');
  } else {
    try {
    switch (lipSyncProvider) {
    case 'heygen': {
      const heygenKey = context.apiKeys.heygen;
      if (!heygenKey) {
        throw new Error('HeyGen API key not configured. Add it as provider "heygen" in org API keys.');
      }

      const heygenAvatarId: string =
        context.character?.heygen_avatar_id ||
        rawConfig.heygen_avatar_id ||
        rawParams.heygen_avatar_id || '';

      if (!heygenAvatarId) {
        throw new Error(
          'HeyGen lip_sync_provider requires heygen_avatar_id in character config or blueprint configuration.'
        );
      }

      avatarVideoUrl = await generateHeyGenAvatarVideo(
        heygenAvatarId,
        audioUrl,
        heygenKey,
        orientation
      );
      break;
    }

    case 'sync_labs': {
      const falKey = context.apiKeys.fal;
      if (!falKey) {
        throw new Error('fal.ai API key not configured. Add it as provider "fal" in org API keys.');
      }

      const baseAvatarVideoUrl: string =
        rawConfig.base_avatar_video_url ||
        rawParams.base_avatar_video_url ||
        context.character?.referenceImageUrl || '';

      if (!baseAvatarVideoUrl) {
        throw new Error(
          'Sync Labs lip_sync_provider requires base_avatar_video_url in blueprint configuration or character referenceImageUrl.'
        );
      }

      avatarVideoUrl = await generateSyncLabsAvatarVideo(
        baseAvatarVideoUrl,
        audioUrl,
        falKey
      );
      break;
    }

    case 'elevenlabs':
    default: {
      let avatarPhotoUrl: string =
        rawConfig.avatar_photo_url ||
        rawParams.avatar_photo_url ||
        context.character?.referenceImageUrl ||
        (context.character?.referenceImages?.[0] ?? '');

      // Fallback: look up character from DB if character_id is provided but no avatar URL found
      if (!avatarPhotoUrl) {
        const characterId = rawConfig.character_id || rawParams.character_id;
        if (characterId) {
          console.log(`[PresenterVoiceHandler] Looking up character ${characterId} for avatar photo`);
          const { data: charData } = await supabase
            .from('library_characters')
            .select('reference_images')
            .eq('id', characterId)
            .single();

          if (charData?.reference_images?.[0]) {
            avatarPhotoUrl = charData.reference_images[0];
            console.log(`[PresenterVoiceHandler] Found avatar from character DB: ${avatarPhotoUrl.substring(0, 60)}...`);
          }
        }
      }

      if (!avatarPhotoUrl) {
        throw new Error(
          'ElevenLabs lip_sync_provider requires avatar_photo_url in blueprint configuration, character referenceImageUrl, or a character_id with an avatar_url set.'
        );
      }

      avatarVideoUrl = await generateElevenLabsAvatarVideo(
        avatarPhotoUrl,
        audioUrl,
        elevenLabsKey
      );
      break;
    }
  }

    console.log('[PresenterVoiceHandler] Avatar video ready:', avatarVideoUrl);
    } catch (lipSyncError) {
      console.error('[PresenterVoiceHandler] Lip-sync generation failed (continuing audio-only):', lipSyncError);
      // avatarVideoUrl remains null — composition stage will work without talking head
    }
  } // end avatarType !== 'none'

  // 7. Step C (optional) — Background removal
  if (removeBackground && avatarVideoUrl) {
    const falKey = context.apiKeys.fal;
    if (!falKey) {
      console.warn('[PresenterVoiceHandler] fal.ai key not found, skipping background removal');
    } else {
      try {
        avatarVideoUrl = await removeAvatarBackground(avatarVideoUrl, falKey);
        console.log('[PresenterVoiceHandler] Background removed:', avatarVideoUrl);
      } catch (bgError) {
        console.error('[PresenterVoiceHandler] Background removal failed (continuing without):', bgError);
        // Non-fatal: compositor can handle a video with a background
      }
    }
  }

  // 8. Return stage result
  return {
    content: {
      audio_url: audioUrl,
      avatar_video_url: avatarVideoUrl,
      word_timestamps: wordTimestamps,
      duration_seconds: durationSeconds,
      provider: lipSyncProvider,
      voice_id: voiceId,
      word_count: wordTimestamps.length,
    },
    status: 'completed',
  };
}

export default executeVoiceAvatarStage;
