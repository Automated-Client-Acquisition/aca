/**
 * Custom Handler: Storyboard Voiceover Stage
 *
 * Replaces the generic executeAudioStage for the storyboard_video_longform pipeline.
 * Produces a voiceover with word-level timestamps AND per-section segmentation
 * so downstream stages (scenes, final) can align visuals to exact audio timing.
 *
 * Two-step process:
 *   Step B: ElevenLabs TTS with word-level timestamps for the full concatenated script
 *   Step C: Segment word timestamps back to outline sections for precise timing
 *
 * Narration text comes directly from the outline stage (user-reviewable/editable).
 *
 * Returns: { audio_url, duration_seconds, script, word_timestamps, section_segments, ... }
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { ElevenLabsProvider } from '../../providers/ElevenLabsProvider.ts';
import { resolveVoiceId } from '../../execution/ExecutionContext.ts';

// ============= Types =============

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

interface SectionNarration {
  section_number: number;
  heading: string;
  narration: string;
}

interface SectionSegment {
  section_number: number;
  heading: string;
  narration: string;
  start_time: number;
  end_time: number;
  duration_seconds: number;
  word_count: number;
}

// ============= Shared Utilities =============

/**
 * Convert ElevenLabs character-level alignment to word-level timestamps.
 * Same logic as PresenterVoiceHandler.extractWordTimestamps().
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

    if (char === ' ' || char === '\n' || char === '\t') {
      if (currentWord.trim().length > 0 && wordStart !== null && wordEnd !== null) {
        wordTimestamps.push({ word: currentWord.trim(), start: wordStart, end: wordEnd });
      }
      currentWord = '';
      wordStart = null;
      wordEnd = null;
    } else {
      if (wordStart === null) {
        wordStart = startTime;
      }
      wordEnd = endTime;
      currentWord += char;
    }
  }

  // Flush last word
  if (currentWord.trim().length > 0 && wordStart !== null && wordEnd !== null) {
    wordTimestamps.push({ word: currentWord.trim(), start: wordStart, end: wordEnd });
  }

  return wordTimestamps;
}

/**
 * Tokenize text into words (splitting on whitespace), matching ElevenLabs' word splitting.
 */
function tokenizeText(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Segment global word timestamps into per-section segments.
 *
 * Walks through the global wordTimestamps array, consuming N words for each section
 * (where N is the section's word count). Records the start of the first word and
 * end of the last word as the section's audio segment.
 */
function segmentTimestampsBySections(
  sections: SectionNarration[],
  wordTimestamps: WordTimestamp[]
): SectionSegment[] {
  const segments: SectionSegment[] = [];
  let globalWordIndex = 0;

  for (const section of sections) {
    const sectionWords = tokenizeText(section.narration);
    const wordCount = sectionWords.length;

    if (wordCount === 0) {
      // Empty section — assign zero-duration segment at current position
      const currentTime = globalWordIndex < wordTimestamps.length
        ? wordTimestamps[globalWordIndex].start
        : (segments.length > 0 ? segments[segments.length - 1].end_time : 0);

      segments.push({
        section_number: section.section_number,
        heading: section.heading,
        narration: section.narration,
        start_time: currentTime,
        end_time: currentTime,
        duration_seconds: 0,
        word_count: 0,
      });
      continue;
    }

    // Consume words from the global timestamp array
    const startIdx = globalWordIndex;
    const endIdx = Math.min(globalWordIndex + wordCount - 1, wordTimestamps.length - 1);

    if (startIdx >= wordTimestamps.length) {
      // Ran out of timestamps — estimate from previous segment
      const prevEnd = segments.length > 0 ? segments[segments.length - 1].end_time : 0;
      // Rough estimate: ~0.4s per word at natural speaking pace
      const estimatedDuration = wordCount * 0.4;

      segments.push({
        section_number: section.section_number,
        heading: section.heading,
        narration: section.narration,
        start_time: prevEnd,
        end_time: prevEnd + estimatedDuration,
        duration_seconds: Math.round(estimatedDuration * 10) / 10,
        word_count: wordCount,
      });

      console.warn(
        `[StoryboardVoiceoverHandler] Ran out of word timestamps for section ${section.section_number}. ` +
        `Expected ${wordCount} words starting at index ${startIdx} but only ${wordTimestamps.length} total timestamps.`
      );
      continue;
    }

    const startTime = wordTimestamps[startIdx].start;
    const endTime = wordTimestamps[endIdx].end;
    const duration = Math.round((endTime - startTime) * 10) / 10;

    segments.push({
      section_number: section.section_number,
      heading: section.heading,
      narration: section.narration,
      start_time: Math.round(startTime * 100) / 100,
      end_time: Math.round(endTime * 100) / 100,
      duration_seconds: duration,
      word_count: wordCount,
    });

    globalWordIndex = endIdx + 1;
  }

  return segments;
}

// ============= Step B: Generate TTS with Timestamps =============

async function generateTTSWithTimestamps(
  fullScript: string,
  voiceId: string,
  apiKey: string,
  outputId: string,
  supabase: any,
): Promise<{
  audioBuffer: ArrayBuffer;
  audioUrl: string;
  wordTimestamps: WordTimestamp[];
  durationSeconds: number;
  cost: number;
}> {
  const modelId = 'eleven_multilingual_v2';

  console.log('[StoryboardVoiceoverHandler] Generating TTS with timestamps:', {
    voice_id: voiceId,
    model: modelId,
    script_length: fullScript.length,
  });

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
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
  const audioBase64: string = ttsResult.audio_base64;
  if (!audioBase64) {
    throw new Error('ElevenLabs TTS did not return audio_base64');
  }

  // Decode base64 audio
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

  // Calculate duration from last word timestamp (most accurate)
  const durationSeconds =
    wordTimestamps.length > 0
      ? wordTimestamps[wordTimestamps.length - 1].end
      : audioBuffer.byteLength / (128 * 125); // Rough estimate at 128kbps

  console.log('[StoryboardVoiceoverHandler] TTS complete:', {
    word_count: wordTimestamps.length,
    duration_seconds: Math.round(durationSeconds * 10) / 10,
    audio_bytes: audioBuffer.byteLength,
  });

  // Upload audio to Supabase Storage
  const fileName = `storyboard_voiceover_${outputId}_${Date.now()}.mp3`;
  const audioUrl = await ElevenLabsProvider.uploadToStorage(supabase, audioBuffer, fileName);

  // Calculate cost (~$0.30 per 1000 characters)
  const cost = (fullScript.length / 1000) * 0.30;

  return { audioBuffer, audioUrl, wordTimestamps, durationSeconds, cost };
}

// ============= Main Handler =============

/**
 * Execute the storyboard voiceover stage.
 *
 * 1. Gets narration from director shots (new architecture) or outline sections (backward compat)
 * 2. Concatenates narrations and generates TTS with word-level timestamps
 * 3. Segments the timestamps by section for precise audio-to-scene alignment
 */
export async function executeStoryboardVoiceoverStage(
  context: ExecutionContext,
  _stageDef: StageDefinition,
  engine: ExecutionEngine,
): Promise<StageResult> {
  console.log('[StoryboardVoiceoverHandler] Starting storyboard voiceover stage');

  const supabase = engine.getSupabase();

  // 1. Get narration from director shots (new architecture) or outline sections (backward compat)
  const directorOutput = context.previousStageOutputs.director;
  const outlineOutput = context.previousStageOutputs.outline;

  let sectionNarrations: SectionNarration[];

  if (directorOutput?.shots?.length) {
    // New architecture: build sections from director shots
    const shots: any[] = directorOutput.shots;
    sectionNarrations = shots
      .filter((s: any) => (s.narration || '').trim()) // skip silent beats
      .map((s: any, i: number) => ({
        section_number: i + 1,
        heading: s.text_overlay || s.layout || `Shot ${i + 1}`,
        narration: (s.narration || '').trim(),
      }));
    console.log('[StoryboardVoiceoverHandler] Built sections from director shots:', sectionNarrations.length);
  } else if (outlineOutput?.sections?.length) {
    // Backward compat: read from outline
    const outlineSections: any[] = outlineOutput.sections;
    sectionNarrations = outlineSections.map((s: any) => ({
      section_number: s.section_number || s.number || 0,
      heading: s.heading || s.title || '',
      narration: (s.narration || '').trim(),
    }));
    console.log('[StoryboardVoiceoverHandler] Using outline sections (backward compat):', sectionNarrations.length);
  } else {
    throw new Error(
      'Storyboard voiceover stage requires narration from director shots or outline sections. ' +
      'Neither was found in previous stage outputs.'
    );
  }

  // Filter out entries with empty narration (silent beats from director)
  const emptyCount = sectionNarrations.filter(s => !s.narration).length;
  if (emptyCount > 0) {
    console.warn(`[StoryboardVoiceoverHandler] Filtering out ${emptyCount} sections with empty narration (silent beats)`);
    sectionNarrations = sectionNarrations.filter(s => s.narration);
  }

  if (sectionNarrations.length === 0) {
    throw new Error('No narration text found in any section/shot for TTS generation.');
  }

  // 2. Get ElevenLabs API key
  const elevenLabsKey = context.apiKeys.elevenlabs;
  if (!elevenLabsKey) {
    throw new Error('ElevenLabs API key not configured');
  }

  // 3. Resolve voice ID from character (canonical) > blueprint fallback > default
  const voiceId: string = resolveVoiceId(context);

  console.log('[StoryboardVoiceoverHandler] Using narration from', directorOutput?.shots ? 'director shots' : 'outline sections');

  // 5. Concatenate all narrations into a single script (with paragraph breaks for natural pauses)
  const fullScript = sectionNarrations
    .map(s => s.narration)
    .join('\n\n');

  const wordCount = tokenizeText(fullScript).length;
  const characterCount = fullScript.length;

  console.log('[StoryboardVoiceoverHandler] Full script:', {
    sections: sectionNarrations.length,
    words: wordCount,
    characters: characterCount,
  });

  // 6. Step B — Generate TTS with word-level timestamps
  const { audioUrl, wordTimestamps, durationSeconds, cost } = await generateTTSWithTimestamps(
    fullScript,
    voiceId,
    elevenLabsKey,
    context.outputId,
    supabase,
  );

  // 7. Step C — Segment timestamps by section
  const sectionSegments = segmentTimestampsBySections(sectionNarrations, wordTimestamps);

  // Validate total segment duration matches audio
  const totalSegmentDuration = sectionSegments.reduce((sum, s) => sum + s.duration_seconds, 0);
  const driftSeconds = Math.abs(totalSegmentDuration - durationSeconds);
  if (driftSeconds > 1.0) {
    console.warn(
      `[StoryboardVoiceoverHandler] Timing drift: segments total ${totalSegmentDuration}s vs audio ${durationSeconds}s ` +
      `(drift: ${driftSeconds.toFixed(1)}s). Adjusting last segment.`
    );
    // Adjust last segment to absorb the drift
    if (sectionSegments.length > 0) {
      const lastSeg = sectionSegments[sectionSegments.length - 1];
      lastSeg.end_time = Math.round(durationSeconds * 100) / 100;
      lastSeg.duration_seconds = Math.round((lastSeg.end_time - lastSeg.start_time) * 10) / 10;
    }
  }

  console.log('[StoryboardVoiceoverHandler] Section segments:', {
    count: sectionSegments.length,
    total_duration: sectionSegments.reduce((sum, s) => sum + s.duration_seconds, 0),
    audio_duration: Math.round(durationSeconds * 10) / 10,
    segments: sectionSegments.map(s => ({
      num: s.section_number,
      heading: s.heading.substring(0, 30),
      duration: s.duration_seconds,
      words: s.word_count,
    })),
  });

  // 8. Return enriched output
  return {
    content: {
      audio_url: audioUrl,
      duration_seconds: Math.round(durationSeconds * 10) / 10,
      script: fullScript,
      word_timestamps: wordTimestamps,
      section_segments: sectionSegments,
      section_count: sectionSegments.length,
      character_count: characterCount,
      word_count: wordCount,
      voice_id: voiceId,
      model_id: 'eleven_multilingual_v2',
      cost,
      status: 'completed',
    },
    status: 'completed',
  };
}

export default executeStoryboardVoiceoverStage;
