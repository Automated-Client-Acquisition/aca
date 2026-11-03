/**
 * Video Remix Pipeline Stage Definitions
 *
 * Pipeline for importing existing videos, extracting and rewriting their speech,
 * re-voicing with ElevenLabs/HeyGen, and creating professional montages with Remotion.
 *
 * Stages:
 * - video_ingest   — Extract key frames from uploaded video (REUSED from presenter_video)
 * - transcribe     — ElevenLabs Speech-to-Text with word-level timestamps (NEW)
 * - rewrite        — LLM rewrites transcript with 6 style modes (NEW)
 * - director       — LLM generates shot list from frames + rewritten script (REUSED, remix variant)
 * - b_roll         — (optional) Stock footage or AI images as cutaways (REUSED)
 * - voice_avatar   — ElevenLabs TTS + optional lip-sync avatar (REUSED)
 * - voiceover      — ElevenLabs TTS only (REUSED)
 * - composition    — Remotion render worker assembles final video (REUSED)
 */

import type { StageDefinition } from '../../execution/types.ts';
import { StageRegistry, defineStage } from '../../execution/StageRegistry.ts';

// Import reusable stage definitions from presenter_video
import {
  VIDEO_INGEST_STAGE,
  B_ROLL_STAGE,
  VOICE_AVATAR_STAGE,
  VOICEOVER_STAGE,
} from './presenter_video.ts';

// ============= TRANSCRIBE STAGE (NEW) =============

export const TRANSCRIBE_STAGE = defineStage({
  id: 'transcribe',
  type: 'composite',
  provider: 'elevenlabs',
  requires: {
    previousStages: ['video_ingest'],
  },
  providerConfig: {},
  customHandler: 'executeTranscribeStage',
  isAsync: true,
});

// ============= REWRITE STAGE (NEW) =============

export const REWRITE_STAGE = defineStage({
  id: 'rewrite',
  type: 'text',
  provider: 'openrouter',
  requires: {
    previousStages: ['transcribe'],
    libraryElements: ['brandVoice', 'product', 'icp'],
    contextFields: ['ideaContext', 'masterPrompt'],
  },
  promptTemplate: {
    system: `You are an expert video script rewriter. You take raw transcripts from existing videos and transform them into polished, engaging narration scripts.

## REWRITE MODE: {{rewriteStyle}}

{{#isPolish}}### POLISH MODE
Keep the original structure, ideas, and flow intact. Your job is to:
- Remove filler words ("um", "like", "you know", "basically", "actually")
- Tighten sentences — say the same thing in fewer words
- Improve transitions between ideas
- Make the language more conversational and engaging
- Add natural spoken-word rhythm (contractions, rhetorical questions, short punchy sentences)
The output should sound like a professional narrator saying what the original speaker MEANT to say.
{{/isPolish}}

{{#isShorten}}### SHORTEN MODE
Reduce the content to its core takeaways. Target 100-200 words (~30-60 seconds of narration).
- Cut tangents, repetition, and examples that don't serve the main point
- Every sentence must earn its place
- Start with the single most compelling insight or hook
- End with a clear takeaway or CTA
- Think "elevator pitch" — if you only had 60 seconds, what matters?
{{/isShorten}}

{{#isExpand}}### EXPAND MODE
Flesh out the ideas with more detail, context, and storytelling. Target 2-5 minutes of narration.
- Add analogies and metaphors to explain complex concepts
- Include relevant examples, data points, or case studies
- Create a clear narrative arc: setup → tension → insight → resolution
- Add transitions between topics ("Here's where it gets interesting...", "But that's only half the story...")
- Make it suitable for a longer-form explainer or deep-dive video
{{/isExpand}}

{{#isReact}}### REACT MODE
Transform this into reaction-style content. You are a knowledgeable commentator reacting to what was said.
- Write in first person as the reactor/analyst
- Use phrases like "Look at this...", "Here's what they're not telling you...", "This is actually brilliant because..."
- Add your analysis, opinion, and context on top of the original content
- Call out what's impressive, what's missing, and what they got wrong
- Be entertaining and opinionated — this should feel like watching a creator's commentary
{{/isReact}}

{{#isTranslate}}### TRANSLATE MODE
Translate the content to {{targetLanguage}} while preserving:
- The original meaning, tone, and emotional intent
- Cultural nuances — adapt idioms and references for the target audience
- Natural spoken rhythm in the target language
- The same approximate length as the original
{{/isTranslate}}

{{#isCustom}}### CUSTOM REWRITE
Follow these specific instructions for the rewrite:
{{customRewriteInstructions}}
{{/isCustom}}

## RULES
- Output ONLY the rewritten script as plain text
- Do NOT include stage directions, timestamps, formatting marks, or section headers
- Write in a conversational, natural tone suitable for voiceover
- Keep the script speakable — avoid complex sentence structures that trip up TTS
- Match approximate pacing: ~3 words per second of target duration

{{#brandVoice.tone}}## BRAND TONE
Write in this tone: {{brandVoice.tone}}
{{/brandVoice.tone}}
{{#brandVoice.writingStyle}}## WRITING STYLE
Follow this style: {{brandVoice.writingStyle}}
{{/brandVoice.writingStyle}}
{{#product.name}}## PRODUCT CONTEXT
Product: {{product.name}}
{{#product.description}}Description: {{product.description}}{{/product.description}}
{{#product.features}}Key features: {{product.features}}{{/product.features}}
{{#product.benefits}}Benefits: {{product.benefits}}{{/product.benefits}}
When relevant, naturally weave in mentions of the product's strengths and differentiators.
{{/product.name}}
{{#icp.name}}## TARGET AUDIENCE
ICP: {{icp.name}}
{{#icp.description}}Description: {{icp.description}}{{/icp.description}}
{{#icp.painPoints}}Pain points: {{icp.painPoints}}{{/icp.painPoints}}
Tailor the language and examples to resonate with this audience.
{{/icp.name}}
{{#masterPrompt}}## BLUEPRINT GUIDANCE
{{masterPrompt}}
{{/masterPrompt}}`,
    user: `## ORIGINAL TRANSCRIPT
{{previousStageOutputs.transcribe.transcript}}

## VIDEO CONTEXT
Duration: {{previousStageOutputs.transcribe.duration_seconds}} seconds
Language: {{previousStageOutputs.transcribe.language}}
Word count: approximately {{previousStageOutputs.transcribe.word_count}} words

{{#creativePrompt}}## ADDITIONAL CREATIVE DIRECTION
{{creativePrompt}}{{/creativePrompt}}

{{#ideaContext}}## TOPIC CONTEXT
{{ideaContext}}{{/ideaContext}}

Rewrite this transcript now.`,
  },
  providerConfig: {
    model: 'anthropic/claude-sonnet-4',
    temperature: 0.7,
    maxTokens: 4000,
  },
  outputTransform: undefined,
});

// ============= REMIX DIRECTOR STAGE =============

/**
 * The remix director produces VIDEO EDIT DECISIONS — time-range segments
 * that reference the original video, NOT screenshot-index-based shots.
 *
 * Key difference from presenter_video director:
 * - Output is `segments[]` with `source_start`/`source_end` (seconds in original video)
 * - The AI uses frames + transcript timestamps to map decisions to actual video times
 * - The original video footage is PRESERVED — segments define cuts/trims of the real video
 */
export const REMIX_DIRECTOR_STAGE = defineStage({
  id: 'director',
  type: 'text',
  provider: 'openrouter',
  requires: {
    previousStages: ['video_ingest', 'rewrite', 'transcribe'],
    libraryElements: ['brandVoice'],
    contextFields: ['ideaContext', 'masterPrompt'],
  },
  promptTemplate: {
    system: `You are an elite video editor. You take existing video footage and a rewritten narration script, and create a professional edit decision list (EDL) that a Remotion video renderer will execute.

## YOUR ROLE
The narration script has ALREADY been written (rewrite stage). Your job is to:
1. Break the rewritten script into segments and map each to a TIME RANGE in the original video
2. Decide which parts of the original video to keep, cut, speed up, or slow down
3. Add text cards, transitions, and effects for a polished result
4. The OUTPUT IS THE ORIGINAL VIDEO WITH EDITS — not a slideshow of screenshots

## CRITICAL: TIME-BASED EDITING
- The attached images are KEY FRAMES extracted at regular intervals from the source video
- The original transcript has word-level timestamps showing WHEN things were said
- Use the timestamps to determine which TIME RANGES of the video correspond to which content
- Frame N corresponds approximately to time: (N / total_frames) * video_duration
- Your segments reference source_start and source_end in SECONDS — these define which portions of the original video to play

## OUTPUT FORMAT: {{outputConfig.aspectRatio}} ({{#isPortrait}}portrait / vertical{{/isPortrait}}{{#isLandscape}}landscape / horizontal{{/isLandscape}})
- Design all text cards and overlays for {{outputConfig.aspectRatio}} aspect ratio
{{#isPortrait}}- Portrait: tall frame — use large, bold text; keep text overlays short (3-5 words); vertical-friendly compositions{{/isPortrait}}
{{#isLandscape}}- Landscape: wide frame — more room for text overlays and split layouts; cinematic feel{{/isLandscape}}

## VISUAL STYLE: {{visualStyleMode}}

{{#isRemixStyle}}### FULL REMIX
Full creative control — this should feel like a professionally re-edited video:
- Re-order segments for maximum narrative impact
- Cut dead air, filler words, and tangential sections
- Speed up slow sections (speed: 1.5) or slow down important moments (speed: 0.75)
- Insert text_card segments for hooks, key stats, and transitions between topics
- Use dynamic transitions: cut_hard (50%), slide_left, snap_cut, fade, whoosh, slam_zoom
- Sound effects add punch: whoosh, pop, click, ding, boom (on ~50% of segments)
{{#hasBRoll}}- Add b_roll_keywords for 3-5 segments where cutaway footage would enhance the story{{/hasBRoll}}
{{/isRemixStyle}}

{{#isEnhanceStyle}}### ENHANCE (Light Polish)
Preserve the original video flow with minimal, tasteful edits:
- Keep segments in chronological order — do NOT reorder
- Trim dead air and long pauses but preserve the natural flow
- Use speed: 1.0 for almost all segments (occasional 1.25 for slow parts)
- Simple transitions: mostly cut_hard, occasional fade
- Add a text_card hook at the start and optional CTA at the end
- Minimal sound effects — only on hook and key moments
- NO b_roll — keep the original footage front and center
{{/isEnhanceStyle}}

## STRUCTURE & PACING
- HOOK: First segment should be a text_card with a bold statement (1.5-2.5s duration)
- Video segments should be 2-6 seconds each
- Cut or speed-up sections longer than 6 seconds
- ARC: Hook → Context → Core Content → Insight/Twist → CTA
- End with a text_card CTA if appropriate

## NARRATION ASSIGNMENT
- Split the rewritten script into natural segments (1-2 sentences per segment)
- Each video segment's narration should match the visual content at that time range
- For text_card segments, the card_text is the display text, narration is what's spoken over it
- caption_emphasis: Pick 1-3 key words per segment for subtitle emphasis

## OUTPUT FORMAT
Return a JSON object with this exact structure:
{
  "segments": [
    {
      "id": "seg_001",
      "type": "video" | "text_card" | "b_roll",
      "source_start": number (seconds in original video, for type "video"),
      "source_end": number (seconds in original video, for type "video"),
      "speed": number (1.0 = normal, 0.75 = slow-mo, 1.5 = speed up),
      "duration": number (seconds, for text_card/b_roll types),
      "transition_in": "cut_hard" | "slam_zoom" | "slide_left" | "fade" | "snap_cut" | "whoosh",
      "narration": "spoken text for this segment",
      "caption_emphasis": ["key", "words"],
      "text_overlay": "lower third text" | null,
      "text_style": "hook_dramatic" | "stat_callout" | "quote_highlight" | null,
      "sound_effect": "whoosh" | "pop" | "click" | "ding" | "boom" | null,
      "card_text": "display text (text_card only)" | null,
      "card_subtitle": "subtitle (text_card only)" | null{{#hasBRoll}},
      "b_roll_keywords": ["keyword1", "keyword2"] | null{{/hasBRoll}}
    }
  ],
  "total_duration": number,
  "full_script": "complete narration text concatenated",
  "segment_count": number
}

## RULES
- For "video" segments: source_start and source_end are REQUIRED (seconds in original video)
- For "text_card" segments: source_start=0, source_end=0, duration is REQUIRED (typically 2-3s)
- For "b_roll" segments: source_start=0, source_end=0, duration is REQUIRED (typically 2-3s)
- Segment IDs must be sequential: seg_001, seg_002, etc.
- source_start must be < source_end for video segments
- speed must be between 0.5 and 2.0
- Return ONLY valid JSON. No markdown, no code blocks, no commentary.

{{#brandVoice.tone}}Brand tone: {{brandVoice.tone}}{{/brandVoice.tone}}`,
    user: `Create a video edit decision list for an existing video.

## REWRITTEN NARRATION SCRIPT (use this for all narration text)
{{previousStageOutputs.rewrite.text}}

## ORIGINAL TRANSCRIPT WITH TIMESTAMPS
These timestamps tell you WHEN things were said in the original video — use them to determine source_start/source_end for each segment:
{{previousStageOutputs.transcribe.segments}}

## VIDEO METADATA
Total duration: {{previousStageOutputs.transcribe.duration_seconds}} seconds
Language: {{previousStageOutputs.transcribe.language}}
Frames extracted: {{previousStageOutputs.video_ingest.total_screenshots}}

## KEY FRAMES (for visual reference)
The video frame images are attached after this text, in chronological order.
Use them to understand what's happening visually at different points in the video.
Frame N ≈ time (N / {{previousStageOutputs.video_ingest.total_screenshots}}) × {{previousStageOutputs.transcribe.duration_seconds}} seconds.

{{#masterPrompt}}## BLUEPRINT GUIDANCE
{{masterPrompt}}{{/masterPrompt}}

{{#ideaContext}}## TOPIC / BRIEF
{{ideaContext}}{{/ideaContext}}

Generate the video edit decision list JSON now.`,
  },
  providerConfig: {
    model: 'anthropic/claude-sonnet-4',
    temperature: 0.7,
    maxTokens: 16000,
  },
  outputTransform: 'parseRemixDirectorOutput',
});

// ============= REMIX COMPOSITION STAGE (NEW) =============

/**
 * Video remix composition stage — uses the original video + edit segments
 * instead of the presenter pipeline's screenshot-based composition.
 */
export const REMIX_COMPOSITION_STAGE = defineStage({
  id: 'composition',
  type: 'composite',
  provider: 'remotion',
  requires: {
    previousStages: ['video_ingest', 'director'],
  },
  providerConfig: {},
  customHandler: 'executeRemixComposeStage',
  isAsync: true,
});

// ============= DYNAMIC STAGE RESOLUTION =============

/**
 * Resolve which stages to include in the video_remix pipeline
 * based on the remix configuration.
 */
export function resolveRemixStages(config: Record<string, any>): string[] {
  const stages: string[] = [];

  // Source: always video_ingest for remix
  stages.push('video_ingest');

  // Transcription: always runs
  stages.push('transcribe');

  // Rewrite: always runs
  stages.push('rewrite');

  // Director: always runs
  stages.push('director');

  // Optional B-roll
  const bRollEnabled: boolean = config.bRollEnabled ?? config.b_roll_enabled ?? false;
  if (bRollEnabled) {
    stages.push('b_roll');
  }

  // Voice: depends on config
  const voiceOption: string = config.voiceOption || config.voice_option || 'new_voice';
  if (voiceOption === 'avatar') {
    stages.push('voice_avatar');
  } else if (voiceOption === 'new_voice') {
    stages.push('voiceover');
  }
  // 'keep_original' — no voice stage needed, original audio is used

  // Composition: always runs
  stages.push('composition');

  return stages;
}

// ============= REGISTER ALL STAGES =============

export function registerVideoRemixStages(): void {
  // Reuse stages from presenter_video
  StageRegistry.register('video_remix', VIDEO_INGEST_STAGE);
  StageRegistry.register('video_remix', B_ROLL_STAGE);
  StageRegistry.register('video_remix', VOICE_AVATAR_STAGE);
  StageRegistry.register('video_remix', VOICEOVER_STAGE);

  // New stages specific to video_remix
  StageRegistry.register('video_remix', TRANSCRIBE_STAGE);
  StageRegistry.register('video_remix', REWRITE_STAGE);
  StageRegistry.register('video_remix', REMIX_DIRECTOR_STAGE);
  StageRegistry.register('video_remix', REMIX_COMPOSITION_STAGE);

  console.log('[StageDefinitions] Registered video_remix stages (8 stages, 4 new)');
}

// Auto-register on import
registerVideoRemixStages();

export default {
  TRANSCRIBE_STAGE,
  REWRITE_STAGE,
  REMIX_DIRECTOR_STAGE,
  REMIX_COMPOSITION_STAGE,
  resolveRemixStages,
};
