/**
 * Storyboard Video Longform Pipeline Stage Definitions
 *
 * Defines all 5 stages for the updated storyboard_video_longform pipeline.
 * The `clips` stage (image-to-video via Kling/Minimax) has been REMOVED entirely.
 * Remotion animates storyboard images directly with camera moves, transitions,
 * and effects — eliminating the most expensive per-video cost (~$5-6/video).
 *
 * Stages:
 * 1. outline       - Text: LLM generates video outline and structure
 * 2. full_voiceover - Audio: ElevenLabs TTS with word-level timestamps
 * 3. scenes        - Text: LLM generates per-scene descriptions + camera_move
 * 4. storyboard    - Image: OpenRouter image generation for each scene
 * 5. final         - Video: Remotion assembles full video with animations and captions
 */

import type { StageDefinition } from '../../execution/types.ts';
import { StageRegistry, defineStage } from '../../execution/StageRegistry.ts';
import { DEFAULT_FREE_TEXT_MODEL, DEFAULT_TEXT_STAGE_MAX_TOKENS } from '../../default-models.ts';

// ============= OUTLINE STAGE =============

export const STORYBOARD_OUTLINE_STAGE = defineStage({
  id: 'outline',
  type: 'text',
  provider: 'openrouter',
  requires: {
    libraryElements: ['brandVoice', 'product'],
    contextFields: ['ideaContext', 'masterPrompt'],
  },
  promptTemplate: {
    system: `You are a video content strategist and scriptwriter creating a narrated video outline with full voiceover script.

DURATION TARGET: The video must be approximately {{outputConfig.duration}} seconds long.
WORD COUNT TARGET: Write approximately {{outputConfig.duration}} × 3 words total (~3 words per second, 180 words/minute spoken pace).

Generate a structured outline with FULL NARRATION TEXT for each section:
- A compelling title and hook
- The RIGHT number of sections to fill the target duration:
  * 30-60s videos: 3-5 sections
  * 60-180s videos: 5-8 sections
  * 180-420s videos: 8-12 sections
  * 420s+ videos: 12-20 sections
- Each section should be 5-30 seconds
- The sum of all section durations MUST equal approximately {{outputConfig.duration}} seconds
- Key narrative arc (problem → insight → solution → proof → CTA)
- Each section MUST include a "narration" field with the actual spoken voiceover text

NARRATION RULES:
- Write in a natural, conversational tone (as if speaking to a friend, not reading an essay)
- Use short sentences. Vary sentence length for rhythm.
- Each section's narration should flow naturally into the next
- NEVER use markdown formatting, bullet points, or headers in narration — plain spoken text only
- Do NOT include section headings in the narration — just the spoken words
- Per section: duration_seconds × 3 words (e.g. a 10-second section needs ~30 words of narration)
- If you write too few words, the video will be too short. Err on the side of writing MORE.

{{#brandVoice.tone}}- Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#brandVoice.writingStyle}}- Style: {{brandVoice.writingStyle}}{{/brandVoice.writingStyle}}

OUTPUT FORMAT (valid JSON):
{
  "title": "Video title",
  "hook": "Opening hook sentence (first 5 seconds)",
  "total_duration_seconds": {{outputConfig.duration}},
  "sections": [
    {
      "section_number": 1,
      "heading": "Section title",
      "duration_seconds": number,
      "key_points": ["point 1", "point 2"],
      "narrative_role": "hook" | "problem" | "insight" | "solution" | "proof" | "cta",
      "narration": "The actual spoken voiceover text for this section. Write enough words to fill the duration."
    }
  ]
}

CRITICAL: total_duration_seconds MUST be {{outputConfig.duration}} and the sum of all section duration_seconds must equal this value.

Return ONLY valid JSON. No markdown, no code fences, no explanatory text before or after the JSON. Start your response with { and end with }.`,
    user: `Create a video outline with full narration script for:

{{ideaContext}}

Target video duration: {{outputConfig.duration}} seconds. Plan sections so their durations sum to this target. Write the voiceover narration for each section.

{{#product.name}}Product to feature: {{product.name}}
{{product.description}}{{/product.name}}

{{#masterPrompt}}## BLUEPRINT GUIDANCE
{{masterPrompt}}{{/masterPrompt}}`,
  },
  providerConfig: {
    model: DEFAULT_FREE_TEXT_MODEL,
    temperature: 0.7,
    // Output ceiling with room for a reasoning model's thinking; the duration sets the length.
    maxTokens: DEFAULT_TEXT_STAGE_MAX_TOKENS,
  },
  outputTransform: 'parseOutlineContent',
});

// ============= FULL VOICEOVER STAGE =============
// Custom handler: StoryboardVoiceoverHandler.ts
// 1. Takes narration text from outline sections (user-reviewable/editable)
// 2. Calls ElevenLabs TTS with word-level timestamps
// 3. Segments timestamps by section for precise audio-to-scene alignment

export const FULL_VOICEOVER_STAGE = defineStage({
  id: 'full_voiceover',
  type: 'audio',
  provider: 'elevenlabs',
  requires: {
    previousStages: ['outline'],
    libraryElements: ['brandVoice', 'character'],
    contextFields: ['ideaContext'],
  },
  promptTemplate: {
    system: 'Handled by custom handler — see StoryboardVoiceoverHandler.ts',
    user: 'Handled by custom handler — see StoryboardVoiceoverHandler.ts',
  },
  providerConfig: {
    model: 'eleven_multilingual_v2',
  },
  customHandler: 'executeStoryboardVoiceoverStage',
  isAsync: false,
});

// ============= SCENES STAGE =============
// The voiceover handler produces section_segments with exact audio timing.
// This stage's LLM only decides image_prompt, camera_move, and visual_concept.
// Scene count, durations, and narration text are LOCKED from the voiceover stage.

export const SCENES_STAGE = defineStage({
  id: 'scenes',
  type: 'text',
  provider: 'openrouter',
  requires: {
    previousStages: ['outline', 'full_voiceover'],
    libraryElements: ['brandVoice'],
    contextFields: ['ideaContext'],
  },
  promptTemplate: {
    system: `You are a storyboard artist creating visual scene descriptions for a narrated video.

IMPORTANT: Scene count, durations, and narration text are FIXED by the voiceover audio segmentation.
Do NOT change the number of scenes, their durations, or their narration. Copy them exactly.

Your job is ONLY to decide:
1. image_prompt — a detailed visual description for image generation (50-100 words, NO text in the image)
2. camera_move — the animation to apply to the image
3. visual_concept — a one-line summary of what the image shows

CAMERA MOVES (assign based on the emotional tone of each section):
- ken_burns_slow: cinematic, thoughtful content — slow zoom + pan
- punch_zoom: exciting reveals, key stats, surprising facts
- pan_left / pan_right: showing comparisons, timelines, progression
- pan_down: revealing something below, building anticipation
- zoom_out_reveal: starting zoomed in, pulling back for big picture
- shake: energy, excitement, dramatic moments
- hold: clean talking head moments, simple explanations

VISUAL STORY COHERENCE:
- First, design a UNIFIED VISUAL STORY that spans all scenes
- Scene 1 establishes the visual genre, color grading, and art direction
- Every subsequent scene MUST match Scene 1's visual style exactly
- NEVER mix visual styles (e.g., don't switch from photorealistic to cartoon)
- Each scene's image_prompt must visually represent what the narration discusses

OUTPUT FORMAT (valid JSON):
{
  "scenes": [
    {
      "scene_number": 1,
      "narration": "EXACT narration text from the voiceover segment (copy as-is)",
      "image_prompt": "Detailed image generation prompt. No text in the image. Cinematic quality.",
      "camera_move": "ken_burns_slow",
      "duration_seconds": 8.2,
      "visual_concept": "One-line description of what the image shows"
    }
  ],
  "visual_story_summary": "One paragraph describing the overall visual style, color palette, and mood consistent across all scenes"
}

Return ONLY the JSON object.

{{#brandVoice.tone}}- Visual tone: {{brandVoice.tone}}{{/brandVoice.tone}}`,
    user: `Create visual scene descriptions for this storyboard video.

## VOICEOVER AUDIO SEGMENTS (LOCKED — do not change count, durations, or narration)
{{previousStageOutputs.full_voiceover.section_segments}}

## FULL VOICEOVER SCRIPT (for narrative context)
{{previousStageOutputs.full_voiceover.script}}

## TOPIC
{{ideaContext}}

Generate exactly {{previousStageOutputs.full_voiceover.section_count}} scenes.
Copy each segment's narration and duration_seconds exactly as provided.
Add image_prompt, camera_move, and visual_concept for each scene.`,
  },
  providerConfig: {
    model: DEFAULT_FREE_TEXT_MODEL,
    temperature: 0.75,
    maxTokens: DEFAULT_TEXT_STAGE_MAX_TOKENS,
  },
  outputTransform: 'parseScenesWithCamera',
});

// ============= STORYBOARD STAGE (Image Generation) =============

export const STORYBOARD_STAGE = defineStage({
  id: 'storyboard',
  type: 'image',
  provider: 'openrouter',
  requires: {
    previousStages: ['scenes'],
    libraryElements: ['brandVoice'],
    contextFields: ['visualStyle'],
  },
  providerConfig: {
    model: 'black-forest-labs/flux.2-pro',
    aspectRatio: '16:9',
    useReferenceImage: false,
  },
  customHandler: 'executeStoryboardImagesStage',
  isAsync: false,
});

// ============= FINAL COMPOSITION STAGE =============

export const STORYBOARD_FINAL_STAGE = defineStage({
  id: 'final',
  type: 'video',
  provider: 'remotion',
  requires: {
    previousStages: ['storyboard', 'full_voiceover', 'scenes'],
    libraryElements: ['brandVoice'],
  },
  providerConfig: {},
  customHandler: 'executeStoryboardComposeStage',
  isAsync: false,
});

// ============= REGISTER ALL STAGES =============

export function registerStoryboardVideoLongformStages(): void {
  StageRegistry.register('storyboard_video_longform', STORYBOARD_OUTLINE_STAGE);
  StageRegistry.register('storyboard_video_longform', FULL_VOICEOVER_STAGE);
  StageRegistry.register('storyboard_video_longform', SCENES_STAGE);
  StageRegistry.register('storyboard_video_longform', STORYBOARD_STAGE);
  StageRegistry.register('storyboard_video_longform', STORYBOARD_FINAL_STAGE);

  console.log('[StageDefinitions] Registered storyboard_video_longform stages (5-stage, clips removed)');
}

// Auto-register on import
registerStoryboardVideoLongformStages();

export default {
  STORYBOARD_OUTLINE_STAGE,
  FULL_VOICEOVER_STAGE,
  SCENES_STAGE,
  STORYBOARD_STAGE,
  STORYBOARD_FINAL_STAGE,
};
