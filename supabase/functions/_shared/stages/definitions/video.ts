/**
 * Unified Video Pipeline Stage Definitions
 *
 * Replaces presenter_video, storyboard_video_longform, and video_remix with a single
 * configurable pipeline that supports ALL video creation modes through VideoConfig.
 *
 * 11 possible stages (dynamically resolved by resolveVideoStages):
 *
 * Source stages (one of, or none):
 * - web_capture    — Playwright captures screenshots (source: 'url')
 * - video_ingest   — Extract frames from uploaded video (source: 'upload_video')
 * - (none)         — prompt_only or upload_images mode
 *
 * Narration stages (one of):
 * - outline        — LLM generates narration from scratch (narrationMode: 'generate')
 * - transcribe     — Speech-to-text from uploaded video (source: 'upload_video')
 * - rewrite        — LLM rewrites transcript (narrationMode: 'rewrite')
 *
 * Voice stage (optional):
 * - voiceover      — TTS + optional avatar (voiceMode: 'voiceover' | 'avatar')
 *
 * Visual stages:
 * - director       — LLM generates unified shot list (always runs)
 * - b_roll         — Stock footage / AI cutaways (bRollEnabled: true)
 * - images         — AI scene image generation (imageMode: 'ai_generated')
 *
 * Final:
 * - composition    — Remotion render worker assembles video (always runs)
 *
 * Post-production (optional):
 * - post_caption   — LLM generates social media caption (generatePostCaption: true)
 */

import type { StageDefinition } from '../../execution/types.ts';
import { StageRegistry, defineStage } from '../../execution/StageRegistry.ts';
import { DEFAULT_FREE_TEXT_MODEL, DEFAULT_TEXT_STAGE_MAX_TOKENS } from '../../default-models.ts';

// Import reusable stage definitions
import { WEB_CAPTURE_STAGE, VIDEO_INGEST_STAGE, B_ROLL_STAGE } from './presenter_video.ts';
import { TRANSCRIBE_STAGE, REWRITE_STAGE } from './video_remix.ts';

// ============= VideoConfig Interface =============

export interface VideoConfig {
  // Post-production
  generatePostCaption?: boolean;

  // Source material
  source: 'url' | 'upload_video' | 'upload_images' | 'prompt_only';
  sourceUrl?: string;
  uploadedVideoUrl?: string;
  uploadedImageUrls?: string[];

  // Narration
  narrationMode: 'generate' | 'rewrite';
  rewriteStyle?: 'polish' | 'shorten' | 'expand' | 'react' | 'translate' | 'custom';
  targetLanguage?: string;
  customRewriteInstructions?: string;
  targetDuration?: number;

  // Voice
  voiceMode: 'voiceover' | 'avatar' | 'keep_original' | 'none';
  lipSyncProvider?: 'elevenlabs' | 'heygen' | 'sync_labs';
  avatarPhotoUrl?: string;
  heygenAvatarId?: string;

  // Images
  imageMode: 'ai_generated' | 'none';

  // B-Roll
  bRollEnabled: boolean;
  bRollStyle?: 'stock' | 'ai_generated';

  // Presentation
  orientation: 'portrait' | 'landscape';
  aspectRatio?: '9:16' | '16:9' | '1:1' | '4:5';
  subtitleStyle: string;
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number;
  transitionType?: string;
}

// ============= Dynamic Stage Resolver =============

/**
 * Resolve which stages to include in the unified video pipeline
 * based on the VideoConfig.
 *
 * @param config - The video config from generation params or configuration
 * @returns Ordered array of stage IDs to execute
 */
export function resolveVideoStages(config: VideoConfig | Record<string, any>): string[] {
  const stages: string[] = [];

  // Source stages
  const source = config.source || 'prompt_only';
  if (source === 'url') {
    stages.push('web_capture');
  } else if (source === 'upload_video') {
    stages.push('video_ingest', 'transcribe');
  }
  // 'upload_images' and 'prompt_only' — no source stage

  // Narration stages
  let narrationMode = config.narrationMode || config.narration_mode || 'generate';
  // Smart default: uploaded video has a transcript → rewrite it, don't generate from scratch
  if (source === 'upload_video' && narrationMode === 'generate') {
    narrationMode = 'rewrite';
  }
  if (narrationMode === 'rewrite') {
    stages.push('rewrite');
  } else {
    stages.push('outline');
  }

  // Voice stage
  const voiceMode = config.voiceMode || config.voice_mode || 'voiceover';
  if (voiceMode === 'voiceover' || voiceMode === 'avatar') {
    stages.push('voiceover');
  }
  // 'keep_original' and 'none' — no voice stage

  // Director always runs
  stages.push('director');

  // Optional B-roll
  const bRollEnabled = config.bRollEnabled ?? config.b_roll_enabled ?? false;
  if (bRollEnabled) {
    stages.push('b_roll');
  }

  // Optional AI images
  const imageMode = config.imageMode || config.image_mode || 'none';
  if (imageMode === 'ai_generated') {
    stages.push('images');
  }

  // Composition always runs
  stages.push('composition');

  // Optional post caption for social media publishing
  const generateCaption = config.generatePostCaption ?? config.generate_post_caption ?? false;
  if (generateCaption) {
    stages.push('post_caption');
  }

  return stages;
}

// ============= OUTLINE STAGE (for narrationMode: 'generate') =============

export const VIDEO_OUTLINE_STAGE = defineStage({
  id: 'outline',
  type: 'text',
  provider: 'openrouter',
  requires: {
    libraryElements: ['brandVoice', 'product'],
    contextFields: ['ideaContext', 'masterPrompt'],
  },
  promptTemplate: {
    system: `You generate video outlines as JSON. The BLUEPRINT GUIDANCE in the user message defines the structure, tone, and style — follow it exactly.

## DURATION MATH
- Target: {{outputConfig.duration}} seconds.
- Word count: ~3 words per spoken second (180 wpm). So {{outputConfig.duration}}s ≈ {{outputConfig.duration}} × 3 words total.
- Per section: duration_seconds × 3 = word count for that section's narration.
- The sum of all section duration_seconds MUST equal {{outputConfig.duration}}.
- Write MORE words rather than fewer — short narration = awkward silence.

## NARRATION FORMAT
- Plain spoken text only. No markdown, no bullet points, no headers, no section headings.
- Each section's narration flows into the next.

{{#brandVoice.tone}}Tone: {{brandVoice.tone}}{{/brandVoice.tone}}
{{#brandVoice.writingStyle}}Style: {{brandVoice.writingStyle}}{{/brandVoice.writingStyle}}

## OUTPUT FORMAT (strict JSON)
{
  "title": "string",
  "hook": "string — opening line",
  "total_duration_seconds": {{outputConfig.duration}},
  "sections": [
    {
      "section_number": 1,
      "heading": "string",
      "duration_seconds": number,
      "key_points": ["string"],
      "narrative_role": "string",
      "narration": "string — the full spoken voiceover for this section"
    }
  ]
}

Return ONLY valid JSON. No markdown, no code fences. Start with { and end with }.`,
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
    maxTokens: DEFAULT_TEXT_STAGE_MAX_TOKENS,
  },
  outputTransform: 'parseOutlineContent',
});

// ============= VOICEOVER STAGE (unified voice handler) =============

export const VIDEO_VOICEOVER_STAGE = defineStage({
  id: 'voiceover',
  type: 'audio',
  provider: 'elevenlabs',
  requires: {
    libraryElements: ['character'],
    contextFields: ['ideaContext'],
  },
  providerConfig: {
    model: 'eleven_multilingual_v2',
  },
  customHandler: 'executeUnifiedVoiceStage',
  isAsync: false,
});

// ============= UNIFIED DIRECTOR STAGE =============

/**
 * The unified director supports ALL source types:
 * - Screenshots from URL (hasScreenshots)
 * - Video frames from upload (hasVideoFrames)
 * - Uploaded images (hasUploadedImages)
 * - AI-generated images mode (imageMode_ai_generated)
 * - Prompt-only / text-card mode (isPromptOnly)
 * - Avatar availability (hasAvatarVideo)
 * - Transcript/rewrite availability (hasTranscript, hasRewrite)
 *
 * Output is always { shots: UnifiedShot[] } with a superset of all fields.
 */

export const DEFAULT_UNIFIED_DIRECTOR_PROMPT = `### Pacing
- DURATION: Match the narration script duration. Calculate total_duration from the narration source. Each shot 2-4 seconds for short videos, 4-8 seconds for longer content (3+ minutes).
- FAST CUTS: Never hold the same visual for more than 4 seconds (short videos) or 8 seconds (long videos). Alternate layouts frequently.
- Follow the narrative structure from the outline sections — map each section to shots faithfully. Do NOT invent your own story arc.

### Layout Variety
- Cycle through layouts. NEVER use the same layout more than 2 times in a row.
- Choose layouts that match the content of each section — stats get stat_card, quotes get quote_card, features get list_reveal, etc.

### Camera & Motion
- Every visual-based shot MUST have camera movement. NEVER use "hold" with a screenshot or image.
- Match camera to content: ken_burns_slow for exploration, punch_zoom for emphasis, pan_down for scrolling content, zoom_out_reveal for big picture moments, snap_to for quick UI elements.
- Vary camera moves — don't repeat the same move 3 times in a row.

### Transitions
- Vary transitions: cut_hard (most common, 40%), slide_left, snap_cut, fade, whoosh, slam_zoom.
- slam_zoom: use for dramatic moments only (1-2 times per video).
- First shot is always cut_hard.

### Visual Polish — Backgrounds, Text Animations & Overlays
These optional fields dramatically improve visual quality. USE THEM.

**background** — Animated backgrounds for text-based layouts (text_card, stat_card, quote_card, list_reveal, gradient_title). Do NOT use on screenshot_fullscreen, scene_image, video_clip or avatar layouts.
- "particles": Floating particles with depth parallax. Great for tech/modern feel. Use intensity 0.3-0.7.
- "mesh_gradient": Flowing gradient color field, Apple-keynote style. Great for premium/elegant feel. Use intensity 0.3-0.6.
- "gradient_orbs": Subtle animated gradient orb. Good for minimal/clean feel.
- Use a background on at LEAST 50% of text-based shots. Vary between types.

**text_animation** — How text enters the shot. ONLY for text-based layouts.
- "spring_fade": Default smooth fade+scale (use when not specified).
- "typewriter": Character-by-character typing with cursor. Perfect for hook shots, code-like content, or dramatic reveals.
- "glitch": Random character scramble that resolves. Great for tech/hacker aesthetic, bold statements.
- "wave": Per-character sine wave motion. Fun, playful energy.
- "bounce": Per-character bounce entrance. Energetic, attention-grabbing.
- "gradient_sweep": Animated gradient color on text. Premium, eye-catching for titles.
- Don't use the same animation on consecutive shots.

**overlay_config** — Cinematic overlays applied on top of the entire shot.
- vignette: true/false — Darkens edges, draws eye to center. Use on 60-80% of shots for cinematic feel.
- grain: true/false — Subtle film grain texture. Use on 30-50% of shots for premium organic feel.
- letterbox: true/false — Subtle top/bottom gradient bars. Use sparingly (1-3 shots) for dramatic moments.
- Set vignette_intensity (0-1, default 0.35) and grain_intensity (0-1, default 0.04) to control strength.`;

export const UNIFIED_DIRECTOR_STAGE = defineStage({
  id: 'director',
  type: 'text',
  provider: 'openrouter',
  requires: {
    libraryElements: ['brandVoice', 'product', 'icp'],
    contextFields: ['ideaContext', 'masterPrompt', 'directorPrompt'],
  },
  promptTemplate: {
    system: `You are an elite video director. You produce professional, engaging video content.

Your job: create a detailed shot-by-shot JSON plan that a Remotion video renderer will execute programmatically. The quality of the final video depends ENTIRELY on how well you structure this shot list.

## CRITICAL RULES

{{#isPromptOnly}}### PROMPT-ONLY MODE (No source visuals)
There are NO screenshots, video frames, or uploaded images. You must create a compelling video using only text-based layouts.
- Available layouts: text_card, stat_card, quote_card, list_reveal, gradient_title.
- text_card: Bold text statement on branded background.
- stat_card: A statistic or number with a label (use text_overlay for the stat, narration for context).
- quote_card: A quote with attribution (use text_overlay for the quote).
- list_reveal: A list of items revealed one by one (use text_overlay for the list title, narration for items).
- gradient_title: Full-screen gradient with large title text.
- screenshot_index must ALWAYS be null. source_start/source_end must ALWAYS be null.
- Minimum shots: 12 for short videos, 25+ for 5-minute+, 40+ for 10-minute+ videos.
- Match each layout to what the narration section contains: stat_card for numbers/data, quote_card for quotes/testimonials, list_reveal for lists/steps, text_card for statements, gradient_title for titles or transitions.
- Keep shots 3-5 seconds each for punchy rhythm. Vary layouts — NEVER use the same layout 3x in a row.
- Follow the narrative structure from the outline — the blueprint's master prompt defines the structure, not you.
{{/isPromptOnly}}

{{#hasScreenshots}}### URL SCREENSHOTS
You have screenshots captured from a web page. Each screenshot shows a different section of the page.
- You MUST use EVERY screenshot at least once. Each screenshot represents a different section of the page — skipping any means missing key content.
- Walk through screenshots in order (0, 1, 2, ...) to create a natural "tour" of the page.
- You CAN reuse a screenshot for emphasis, but NEVER use the same screenshot 3+ times when others are unused.
- screenshot_index: null ONLY for text_card{{#hasAvatarVideo}} and avatar_fullscreen{{/hasAvatarVideo}} layouts. ALL other screenshot-based layouts MUST have a valid screenshot_index.
- Use layout "screenshot_fullscreen" for screenshot-based shots.
{{/hasScreenshots}}

{{#hasVideoFrames}}### VIDEO FRAMES (uploaded video source)
The images are KEY FRAMES extracted from an uploaded video, not web screenshots. Treat them as a visual timeline.
- Use layout "video_clip" for segments of the original video.
- Each video_clip shot MUST have source_start and source_end (in seconds from the original video).
- source_start must be < source_end.
- Frame N corresponds approximately to time: (N / total_frames) × video_duration.
- Use the original transcript timestamps to determine which time ranges correspond to which content.
- You can also use text_card layouts for hooks, transitions, and CTAs.
{{/hasVideoFrames}}

{{#hasUploadedImages}}### UPLOADED IMAGES
The user has provided images to use as visual material.
- Use layout "scene_image" for shots showing these images.
- Set screenshot_index to the image index (0-based).
- Walk through images in order to create a natural flow.
- You CAN reuse an image but prioritize covering all images.
{{/hasUploadedImages}}

{{#imageMode_ai_generated}}### AI-GENERATED IMAGES MODE
Each shot can include an "image_prompt" field — a detailed description for AI image generation.
- Use layout "scene_image" for shots with AI-generated images.
- Write image prompts that are 50-100 words, cinematic quality, NO text in images.
- Maintain visual coherence across all shots — consistent art style, color palette, mood.
- screenshot_index must be null (images are generated, not indexed).
{{/imageMode_ai_generated}}

{{#hasAvatarVideo}}### AVATAR AVAILABLE
A talking-head avatar video is available. You can use avatar-based layouts:
- avatar_pip: Screenshot/image as main visual, avatar in small corner overlay.
- split_left: Avatar on left, screenshot/image on right.
- split_right: Avatar on right, screenshot/image on left.
- avatar_fullscreen: Full-screen avatar, no other visuals (use 0-1 times only).
- Cycle through layouts. NEVER use the same layout more than 2 times in a row.
{{/hasAvatarVideo}}
{{^hasAvatarVideo}}{{^isPromptOnly}}{{^imageMode_ai_generated}}### NO AVATAR
- ONLY use these layouts: screenshot_fullscreen, video_clip, scene_image, text_card, stat_card, quote_card, list_reveal, gradient_title.
- NO avatar layouts (avatar_pip, split_left, split_right, avatar_fullscreen are NOT available).
{{/imageMode_ai_generated}}{{/isPromptOnly}}{{/hasAvatarVideo}}

{{#hasTranscript}}### ORIGINAL TRANSCRIPT
The original video has been transcribed. The transcript with timestamps is available to help you:
- Map narration to the correct time ranges in the original video.
- Identify key moments, quotes, and insights.
- Understand the original video's structure and flow.
{{/hasTranscript}}

{{#directorPrompt}}
## VIDEO DIRECTION
{{{directorPrompt}}}
{{/directorPrompt}}
{{^directorPrompt}}
${DEFAULT_UNIFIED_DIRECTOR_PROMPT}

### Narration & Captions (CRITICAL — MUST MATCH VISUALS)
{{#isPromptOnly}}- Since there are no visuals to reference, use the narration from the outline sections directly.
- Each shot's narration should follow the outline order to maintain the narrative flow.{{/isPromptOnly}}
{{#hasScreenshots}}- The screenshot images are attached to this message. LOOK at each image carefully.
- For every shot with a screenshot, FIRST fill in "screenshot_description" with a factual description of what you see in that image. Then write "narration" that talks about those visible elements.
- Match what you SEE in each screenshot.{{/hasScreenshots}}
{{#hasVideoFrames}}- The frame images are attached. Use them to understand the visual content at different points.
- For video_clip shots, narration should complement what's happening in that time range.{{/hasVideoFrames}}
{{#hasUploadedImages}}- The uploaded images are attached. Reference what you see in each image.{{/hasUploadedImages}}
{{#imageMode_ai_generated}}- Write narration that describes or comments on what the AI-generated image will depict.
- The image_prompt and narration should be complementary — image shows, narration explains.{{/imageMode_ai_generated}}
- Write narration that matches the tone and style from the outline and brand voice.
- Each shot's narration should be 1-2 sentences that can be spoken in the shot's duration (~3 words/second).
- caption_emphasis: Pick 1-3 key words per shot that should be visually emphasized in captions.
- caption_style: Use "tiktok_bounce" as default. Use "big_center" for dramatic moments. Use "karaoke" for longer narrations.

### Highlights & Effects
- Use highlights on specific UI elements when the narration references them: red_circle, underline_draw, glow_pulse, fake_cursor_click.
- Sound effects add punch: whoosh on fast transitions, pop on reveals, click on UI interactions, ding on insights.
- Don't overuse — 60% of shots should have a sound_effect, not 100%.
{{/directorPrompt}}

{{#isLandscape}}### LANDSCAPE ORIENTATION (16:9)
This is a LANDSCAPE video (16:9 widescreen). Think YouTube tutorials, Trupeer-style screencasts, or professional explainers.
- Favor wide layouts: screenshot_fullscreen, video_clip, scene_image — these look great in landscape.
- text_card layouts still work but should be used sparingly (hook + CTA only).
- For tutorial/screencast content: let the screen recordings breathe. Use longer shots (4-8s) so viewers can follow the UI.
- Avoid rapid-fire cuts for tutorial content — smooth, steady pacing with clear transitions.
- Camera moves should be subtle: ken_burns_slow, pan_down for scrolling content, zoom_out_reveal. Avoid shake/punch_zoom on UI content.
- caption_style: Use "minimal" or "karaoke" for landscape — "tiktok_bounce" feels too mobile-native.
{{/isLandscape}}
{{#isPortrait}}### PORTRAIT ORIENTATION (9:16)
This is a PORTRAIT video (9:16 vertical). Think TikTok, Reels, Shorts.
- Fast cuts, dynamic camera moves, punchy transitions.
- caption_style: "tiktok_bounce" is the default — bold, mobile-native.
- Use the full range of layouts including avatar layouts when available.
{{/isPortrait}}

{{#hasBRoll}}### B-ROLL KEYWORDS
For shots where a visual cutaway would enhance the video (e.g., abstract concepts, emotional moments, transitions between topics), include a "b_roll_keywords" array with 2-4 descriptive keywords for finding stock footage or generating imagery.
- Only add b_roll_keywords to 3-5 shots max. Don't add them to every shot.
{{/hasBRoll}}

## NARRATION SOURCE
{{#hasOutline}}The narration script has been generated. Use the sections below as the basis for your shot narrations.
You MUST cover ALL the narration content — split it across shots appropriately.{{/hasOutline}}
{{#hasRewrite}}The narration script has been rewritten from the original transcript. Use the rewritten text below as the basis for your shot narrations.
Split it into natural segments across shots.{{/hasRewrite}}

## OUTPUT FORMAT
Return a JSON object with this exact structure:
{
  "shots": [
    {
      "duration": number,
      "layout": {{#isPromptOnly}}"text_card" | "stat_card" | "quote_card" | "list_reveal" | "gradient_title"{{/isPromptOnly}}{{^isPromptOnly}}"text_card" | "screenshot_fullscreen" | "scene_image" | "video_clip"{{#hasAvatarVideo}} | "avatar_pip" | "split_left" | "split_right" | "avatar_fullscreen"{{/hasAvatarVideo}} | "stat_card" | "quote_card" | "list_reveal" | "gradient_title"{{/isPromptOnly}},
      "screenshot_index": number | null,
      "screenshot_description": string | null,
      "source_start": number | null,
      "source_end": number | null,
      "speed": number | null,
      "scene_image_url": string | null,
      "image_prompt": string | null,
      "camera": {
        "move": "ken_burns_slow" | "punch_zoom" | "pan_left" | "pan_right" | "pan_down" | "zoom_out_reveal" | "shake" | "tilt_3d" | "snap_to" | "hold",
        "target_element": string | null,
        "start_scale": number | null,
        "end_scale": number | null
      },
      "narration": string,
      "caption_emphasis": string[],
      "caption_style": "tiktok_bounce" | "big_center" | "karaoke" | "minimal" | null,
      "highlight": {
        "type": "red_circle" | "underline_draw" | "blur_except" | "glow_pulse" | "arrow" | "fake_cursor_click" | "magnify",
        "target_element": string
      } | null,
      "text_overlay": string | null,
      "text_style": "hook_dramatic" | "stat_callout" | "quote_highlight" | null,
      "transition_in": "cut_hard" | "slam_zoom" | "slide_left" | "fade" | "snap_cut" | "whoosh",
      "sound_effect": "whoosh" | "pop" | "click" | "ding" | "record_scratch" | "boom" | "cash_register" | "typing" | null,
      "text_animation": "spring_fade" | "typewriter" | "glitch" | "wave" | "bounce" | "gradient_sweep" | null,
      "background": { "type": "particles" | "mesh_gradient" | "gradient_orbs", "intensity": number } | null,
      "overlay_config": { "vignette": boolean, "vignette_intensity": number, "grain": boolean, "grain_intensity": number, "letterbox": boolean } | null{{#hasBRoll}},
      "b_roll_keywords": string[] | null{{/hasBRoll}}
    }
  ],
  "total_duration": number,
  "full_script": string,
  "shot_count": number,
  "template_type": string
}

Return ONLY valid JSON. No markdown, no code blocks, no commentary.

{{#brandVoice.tone}}Brand tone: {{brandVoice.tone}}{{/brandVoice.tone}}`,
    user: `Create a shot list for a video.

## TOPIC / BRIEF
{{ideaContext}}

{{#isPromptOnly}}## MODE: PROMPT ONLY
No screenshots, video frames, or images. Create the video entirely from text-based layouts using the topic/brief above.
{{/isPromptOnly}}

{{#hasScreenshots}}## PAGE METADATA
{{#previousStageOutputs.web_capture.page_metadata}}
Title: {{previousStageOutputs.web_capture.page_metadata.title}}
Description: {{previousStageOutputs.web_capture.page_metadata.description}}
URL: {{previousStageOutputs.web_capture.page_metadata.url}}
{{/previousStageOutputs.web_capture.page_metadata}}

## SCREENSHOTS ({{previousStageOutputs.web_capture.total_screenshots}} images attached below — you MUST use ALL of them)
The screenshot images are attached after this text, in order. Map them as: first image = screenshot_index 0, second image = screenshot_index 1, etc.

For EACH shot that references a screenshot, you MUST:
1. Look at the actual image for that screenshot_index
2. Describe ONLY what is visible in that image (text, UI elements, sections, buttons, logos)
3. NEVER mention features, pricing, or UI elements that are not shown in that specific screenshot
{{/hasScreenshots}}

{{#hasVideoFrames}}## VIDEO METADATA
{{#previousStageOutputs.video_ingest.page_metadata}}
Title: {{previousStageOutputs.video_ingest.page_metadata.title}}
Description: {{previousStageOutputs.video_ingest.page_metadata.description}}
{{/previousStageOutputs.video_ingest.page_metadata}}
Total duration: {{previousStageOutputs.transcribe.duration_seconds}} seconds
Frames extracted: {{previousStageOutputs.video_ingest.total_screenshots}}

## KEY FRAMES
The video frame images are attached in chronological order.
Frame N ≈ time (N / {{previousStageOutputs.video_ingest.total_screenshots}}) × {{previousStageOutputs.transcribe.duration_seconds}} seconds.

## ORIGINAL TRANSCRIPT WITH TIMESTAMPS
{{previousStageOutputs.transcribe.segments}}
{{/hasVideoFrames}}

{{#hasUploadedImages}}## UPLOADED IMAGES
{{previousStageOutputs.upload_images.total_images}} images provided. They are attached in order (index 0, 1, 2, ...).
{{/hasUploadedImages}}

{{#hasOutline}}## NARRATION SCRIPT (from outline stage — use this for all narration)
{{#previousStageOutputs.outline.sections}}
Section {{section_number}}: {{heading}}
Duration: {{duration_seconds}}s
Narration: {{narration}}

{{/previousStageOutputs.outline.sections}}
{{/hasOutline}}

{{#hasRewrite}}## REWRITTEN NARRATION (from rewrite stage — use this for all narration)
{{previousStageOutputs.rewrite.text}}
{{/hasRewrite}}

{{#masterPrompt}}## BLUEPRINT GUIDANCE
{{masterPrompt}}{{/masterPrompt}}

Generate the shot list JSON now.`,
  },
  providerConfig: {
    // Vision-capable model for accurate visual-to-narration alignment
    model: 'anthropic/claude-sonnet-4',
    temperature: 0.7,
    maxTokens: 16000,
  },
  outputTransform: 'parseUnifiedDirectorOutput',
});

// ============= IMAGES STAGE (AI-generated scene images) =============

export const VIDEO_IMAGES_STAGE = defineStage({
  id: 'images',
  type: 'image',
  provider: 'openrouter',
  requires: {
    previousStages: ['director'],
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

// ============= POST CAPTION STAGE (social media caption for publishing) =============

export const VIDEO_POST_CAPTION_STAGE = defineStage({
  id: 'post_caption',
  type: 'text',
  provider: 'openrouter',
  requires: {
    previousStages: ['composition'],
    libraryElements: ['brandVoice', 'product', 'icp'],
    contextFields: ['ideaContext'],
  },
  promptTemplate: {
    system: `You are a social media caption expert. Generate engaging captions for video content that will be published to LinkedIn, TikTok, Instagram Reels, and YouTube Shorts.

## Video Context
The video has already been produced. Use the outline/narration below to understand what the video covers, then write a caption that makes people want to watch it.

{{#brandVoice.tone}}## Brand Voice
Tone: {{brandVoice.tone}}
{{#brandVoice.writingStyle}}Style: {{brandVoice.writingStyle}}{{/brandVoice.writingStyle}}{{/brandVoice.tone}}

{{#product.name}}## Product/Service
Name: {{product.name}}
{{#product.description}}Description: {{product.description}}{{/product.description}}{{/product.name}}

{{#icp.name}}## Target Audience
{{icp.name}}{{#icp.description}}: {{icp.description}}{{/icp.description}}{{/icp.name}}

## Caption Requirements
1. **Hook First** - Open with a pattern-interrupt that stops scrolling (question, bold statement, or curiosity gap)
2. **Match the Brand Voice** - Use the tone and style described above
3. **Keep it Punchy** - Primary message in first 150 characters (visible without "more")
4. **Include CTAs** - End with engagement prompt (comment, share, follow)
5. **Strategic Hashtags** - Add 3-5 relevant hashtags at the end

## Output Format
Return ONLY the caption text with hashtags. No labels, explanations, or metadata. The caption should be ready to copy-paste directly to social media.`,
    user: `Generate a viral-worthy caption for this video.

## Topic
{{ideaContext}}

{{#previousStageOutputs.outline}}## Video Narration Script
{{#previousStageOutputs.outline.sections}}
Section {{section_number}}: {{heading}}
Narration: {{narration}}
{{/previousStageOutputs.outline.sections}}{{/previousStageOutputs.outline}}

{{#previousStageOutputs.rewrite}}## Video Script (Rewritten)
{{previousStageOutputs.rewrite.text}}{{/previousStageOutputs.rewrite}}

{{#previousStageOutputs.director}}## Video Shot Summary
{{previousStageOutputs.director.shot_count}} shots, {{previousStageOutputs.director.total_duration}} seconds total.
Template: {{previousStageOutputs.director.template_type}}{{/previousStageOutputs.director}}

Make it scroll-stopping, on-brand, and engagement-focused.`,
  },
  providerConfig: {
    model: DEFAULT_FREE_TEXT_MODEL,
    temperature: 0.8,
    // The prompt sets the caption's length; this only has to leave a reasoning
    // model room to think first (600 came back empty).
    maxTokens: DEFAULT_TEXT_STAGE_MAX_TOKENS,
  },
});

// ============= COMPOSITION STAGE =============

export const VIDEO_COMPOSITION_STAGE = defineStage({
  id: 'composition',
  type: 'video',
  provider: 'remotion',
  requires: {
    previousStages: ['director'],
    libraryElements: ['brandVoice'],
  },
  providerConfig: {},
  customHandler: 'executeVideoComposeStage',
  isAsync: false,
});

// ============= REGISTER ALL STAGES =============

export function registerVideoStages(): void {
  // Reuse stages from existing pipelines
  StageRegistry.register('video', WEB_CAPTURE_STAGE);
  StageRegistry.register('video', VIDEO_INGEST_STAGE);
  StageRegistry.register('video', TRANSCRIBE_STAGE);
  StageRegistry.register('video', REWRITE_STAGE);
  StageRegistry.register('video', B_ROLL_STAGE);

  // New unified stages
  StageRegistry.register('video', VIDEO_OUTLINE_STAGE);
  StageRegistry.register('video', VIDEO_VOICEOVER_STAGE);
  StageRegistry.register('video', UNIFIED_DIRECTOR_STAGE);
  StageRegistry.register('video', VIDEO_IMAGES_STAGE);
  StageRegistry.register('video', VIDEO_COMPOSITION_STAGE);
  StageRegistry.register('video', VIDEO_POST_CAPTION_STAGE);

  console.log('[StageDefinitions] Registered video pipeline stages (unified, 11 possible)');
}

// Auto-register on import
registerVideoStages();

export default {
  VIDEO_OUTLINE_STAGE,
  VIDEO_VOICEOVER_STAGE,
  UNIFIED_DIRECTOR_STAGE,
  VIDEO_IMAGES_STAGE,
  VIDEO_POST_CAPTION_STAGE,
  VIDEO_COMPOSITION_STAGE,
  resolveVideoStages,
};
