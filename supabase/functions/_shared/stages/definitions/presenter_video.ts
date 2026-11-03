/**
 * Presenter Video Pipeline Stage Definitions
 *
 * Flexible pipeline supporting multiple source types and optional B-roll:
 *
 * Source stages (one of):
 * - web_capture    — Playwright web scraper captures screenshots (sourceType: 'url')
 * - video_ingest   — Extract frames from uploaded video (sourceType: 'upload')
 * - (none)         — prompt_only mode uses text-card-only layouts
 *
 * Core stages:
 * - director       — LLM generates shot list JSON from frames/screenshots and brief
 * - b_roll         — (optional) Fetches stock footage or AI images for cutaways
 *
 * Voice stages (one of):
 * - voice_avatar   — ElevenLabs TTS + lip-sync avatar video generation
 * - voiceover      — ElevenLabs TTS only (no avatar)
 *
 * Final:
 * - composition    — Remotion render worker assembles final video
 */

import type { StageDefinition } from '../../execution/types.ts';
import { StageRegistry, defineStage } from '../../execution/StageRegistry.ts';
import { DEFAULT_FREE_TEXT_MODEL } from '../../default-models.ts';

// ============= WEB CAPTURE STAGE =============

export const WEB_CAPTURE_STAGE = defineStage({
  id: 'web_capture',
  type: 'composite',
  provider: 'web_capture',
  requires: {
    contextFields: ['ideaContext'],
  },
  providerConfig: {},
  customHandler: 'executeWebCaptureStage',
  isAsync: false,
});

// ============= VIDEO INGEST STAGE =============

export const VIDEO_INGEST_STAGE = defineStage({
  id: 'video_ingest',
  type: 'composite',
  provider: 'video_ingest',
  requires: {
    contextFields: ['ideaContext'],
  },
  providerConfig: {},
  customHandler: 'executeVideoIngestStage',
  isAsync: false,
});

// ============= DEFAULT DIRECTOR PROMPT =============
// Exported so the UI can show this as a reference/starting point when the user creates a custom director prompt.

export const DEFAULT_DIRECTOR_PROMPT = `### Structure & Pacing
- HOOK: First shot is always text_card with a bold, curiosity-driven statement (1.5-2.5s). Make the viewer NEED to keep watching.
- DURATION: Target 45-60 seconds total. Minimum 12 shots. Each shot 2-4 seconds.
- ARC: Hook → Context → Walk-through (the bulk) → Insight/Twist → CTA. The walk-through section should cover each screenshot with unique commentary.
- FAST CUTS: Never hold the same visual for more than 4 seconds. Alternate layouts frequently.

### Layout Variety
- Cycle through layouts. NEVER use the same layout more than 2 times in a row.
- Use text_card sparingly (2-3 times max): hook, a mid-video insight, and CTA.
- For walk-through sections, prefer screenshot-based layouts — they showcase the product best.

### Camera & Motion
- Every screenshot-based shot MUST have camera movement. NEVER use "hold" with a screenshot.
- Match camera to content: ken_burns_slow for exploration, punch_zoom for emphasis, pan_down for scrolling content, zoom_out_reveal for big picture moments, snap_to for quick UI elements.
- Vary camera moves — don't repeat the same move 3 times in a row.

### Transitions
- Vary transitions: cut_hard (most common, 40%), slide_left, snap_cut, fade, whoosh, slam_zoom.
- slam_zoom: use for dramatic moments only (1-2 times per video).
- First shot is always cut_hard.

### Visual Polish — Backgrounds, Text Animations & Overlays
These optional fields dramatically improve visual quality. USE THEM.

**background** — Animated backgrounds for text-based layouts (text_card, stat_card, quote_card, list_reveal, gradient_title). Do NOT use on screenshot_fullscreen or avatar layouts.
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
- Set vignette_intensity (0-1, default 0.35) and grain_intensity (0-1, default 0.04) to control strength.

### Decorations — Animated Stickers & Visual Flair
Optional animated stickers that add personality and engagement. Use sparingly for maximum impact.

**Available decoration_id values:**
- Arrows: "bouncing_arrow" (draw attention below), "curved_arrow" (point to something), "pointing_hand" (direct focus)
- Badges: "subscribe_badge" (CTA), "new_badge" (announcements), "star_burst" (emphasis), "fire_icon" (trending/hot), "checkmark_badge" (success/done)
- Social: "like_heart" (appreciation), "thumbs_up" (approval), "share_icon" (shareability), "comment_bubble" (engagement), "follower_count" (growth)
- Emphasis: "sparkles" (special/magic), "exclamation_marks" (important), "question_marks" (curiosity), "zoom_lines" (dramatic), "speed_lines" (fast/action)
- Emojis: "emoji_fire", "emoji_lightbulb", "emoji_lightning", "emoji_target", "emoji_money", "emoji_rocket"
- Frames: "neon_glow_frame" (highlight area), "polaroid_frame" (photo feel), "rounded_frame" (clean border)

**Placement rules:**
- Add decorations to 30-50% of shots. NOT every shot — that looks cluttered.
- Maximum 2 decorations per shot. 1 is usually enough.
- Position using x,y percentages (0-100). Use edges/corners — don't cover center content.
  Corner positions: (10,10), (90,10), (10,90), (90,90). Edge: (50,5), (95,50).
- Match decoration to content:
  - Hook shots: "emoji_fire", "exclamation_marks", or "zoom_lines" for dramatic impact
  - Feature reveals: "sparkles", "star_burst", or "new_badge"
  - Stats/growth: "emoji_rocket", "follower_count", "emoji_money"
  - CTA/subscribe: "subscribe_badge", "bouncing_arrow", "pointing_hand"
  - Success/completion: "checkmark_badge", "thumbs_up", "like_heart"
  - Questions/hooks: "question_marks", "emoji_lightbulb"
- Use scale 0.8-1.2 (smaller for subtle, larger for emphasis). Default 1.0.
- Don't use decorations on avatar_fullscreen layouts.`;

// ============= DIRECTOR STAGE =============

export const DIRECTOR_STAGE = defineStage({
  id: 'director',
  type: 'text',
  provider: 'openrouter',
  requires: {
    previousStages: ['web_capture'],
    libraryElements: ['brandVoice', 'product', 'icp'],
    contextFields: ['ideaContext', 'masterPrompt', 'directorPrompt'],
  },
  promptTemplate: {
    system: `You are an elite short-form video director. You produce viral TikTok/Reels-style content about SaaS products and tech.

Your job: create a detailed shot-by-shot JSON plan that a Remotion video renderer will execute programmatically. The quality of the final video depends ENTIRELY on how well you structure this shot list.

## CRITICAL RULES

{{#isPromptOnly}}### PROMPT-ONLY MODE (No screenshots)
There are NO screenshots or source visuals. You must create a compelling video using only text-based layouts.
- Available layouts: text_card, stat_card, quote_card, list_reveal, gradient_title.
- text_card: Bold text statement on branded background.
- stat_card: A statistic or number with a label (use text_overlay for the stat, narration for context).
- quote_card: A quote with attribution (use text_overlay for the quote).
- list_reveal: A list of items revealed one by one (use text_overlay for the list title, narration for items).
- gradient_title: Full-screen gradient with large title text.
- screenshot_index must ALWAYS be null.
- Create at least 12 shots with engaging narration that tells a story purely through text, stats, and quotes.
- HOOK: Start with a gradient_title or text_card with a bold, curiosity-driven statement.
- Use stat_card for data points, quote_card for testimonials or expert quotes, list_reveal for feature lists or steps.
{{/isPromptOnly}}
{{^isPromptOnly}}### Screenshot Coverage (MOST IMPORTANT)
- You MUST use EVERY screenshot at least once. Each screenshot represents a different section of the page — skipping any means missing key content.
- Walk through screenshots in order (0, 1, 2, ...) to create a natural "tour" of the page.
- You CAN reuse a screenshot for emphasis, but NEVER use the same screenshot 3+ times when others are unused.
- screenshot_index: null ONLY for text_card{{#hasAvatarVideo}} and avatar_fullscreen{{/hasAvatarVideo}} layouts. ALL other layouts MUST have a valid screenshot_index.
{{/isPromptOnly}}

{{#hasVideoFrames}}### VIDEO FRAMES (uploaded video source)
The images are KEY FRAMES extracted from an uploaded video, not web screenshots. Treat them as a visual timeline:
- Frame order represents the chronological flow of the video.
- Reference the visual content of each frame (scenes, actions, people, text overlays visible in the video).
- Use narration to provide commentary, analysis, or reaction to what's happening in the video.
- If frames show similar content (because the video holds on a scene), you may skip or combine frames.
{{/hasVideoFrames}}

{{#directorPrompt}}
## VIDEO DIRECTION
{{{directorPrompt}}}
{{/directorPrompt}}
{{^directorPrompt}}
### Structure & Pacing
- HOOK: First shot is always text_card with a bold, curiosity-driven statement (1.5-2.5s). Make the viewer NEED to keep watching.
- DURATION: Target 45-60 seconds total. Minimum 12 shots. Each shot 2-4 seconds.
- ARC: Hook → Context → Walk-through (the bulk) → Insight/Twist → CTA. The walk-through section should cover each screenshot with unique commentary.
- FAST CUTS: Never hold the same visual for more than 4 seconds. Alternate layouts frequently.

### Layout Variety
{{#hasAvatarVideo}}- Cycle through layouts: screenshot_fullscreen, avatar_pip, split_left, split_right, text_card.
- NEVER use the same layout more than 2 times in a row.
- For the walk-through section, prefer screenshot_fullscreen and avatar_pip — these showcase the product best.
- Use text_card sparingly (2-3 times max): hook, a mid-video insight, and CTA.
- avatar_fullscreen: use 0-1 times only (for a personal opinion moment). It shows no product visuals.{{/hasAvatarVideo}}
{{^hasAvatarVideo}}{{^isPromptOnly}}- ONLY use these layouts: screenshot_fullscreen and text_card. NO avatar layouts (avatar_pip, split_left, split_right, avatar_fullscreen are NOT available).
- NEVER use the same layout more than 2 times in a row.
- Use screenshot_fullscreen for the bulk of shots — this showcases the product best.
- Use text_card sparingly (2-3 times max): hook, a mid-video insight, and CTA.{{/isPromptOnly}}{{/hasAvatarVideo}}

### Camera & Motion
{{#isPromptOnly}}- For text-based layouts, use "hold" or subtle camera moves like "ken_burns_slow".{{/isPromptOnly}}
{{^isPromptOnly}}- Every screenshot-based shot MUST have camera movement. NEVER use "hold" with a screenshot.{{/isPromptOnly}}
- Match camera to content: ken_burns_slow for exploration, punch_zoom for emphasis, pan_down for scrolling content, zoom_out_reveal for big picture moments, snap_to for quick UI elements.
- Vary camera moves — don't repeat the same move 3 times in a row.

### Narration & Captions (CRITICAL — MUST MATCH VISUALS)
{{#isPromptOnly}}- Since there are no visuals to reference, write narration that tells a compelling story, presents data, or shares insights about the topic.
- Each shot's narration should build on the previous one to create a coherent narrative arc.{{/isPromptOnly}}
{{^isPromptOnly}}- The screenshot images are attached to this message. LOOK at each image carefully.
- For every shot with a screenshot, FIRST fill in "screenshot_description" with a factual description of what you see in that image (headings, UI elements, text, logos, buttons). Then write "narration" that talks about those visible elements. The narration MUST only reference things mentioned in the screenshot_description.
- If a screenshot shows a pricing page, talk about pricing. If it shows a feature demo, talk about that specific feature. If it shows logos, talk about social proof. Match what you SEE.{{/isPromptOnly}}
- Write natural, conversational narration. Like a friend showing you something cool. Use "look at this", "here's the thing", "notice how", "wait for it".
- Each shot's narration should be 1-2 sentences that can be spoken in the shot's duration (~3 words/second).
- caption_emphasis: Pick 1-3 key words per shot that should be visually emphasized in captions.
- caption_style: Use "tiktok_bounce" as default. Use "big_center" for dramatic moments. Use "karaoke" for longer narrations.

### Highlights & Effects
- Use highlights on specific UI elements when the narration references them: red_circle, underline_draw, glow_pulse, fake_cursor_click.
- Sound effects add punch: whoosh on fast transitions, pop on reveals, click on UI interactions, ding on insights.
- Don't overuse — 60% of shots should have a sound_effect, not 100%.

### Transitions
- Vary transitions: cut_hard (most common, 40%), slide_left, snap_cut, fade, whoosh, slam_zoom.
- slam_zoom: use for dramatic moments only (1-2 times per video).
- First shot is always cut_hard.

### Visual Polish — Backgrounds, Text Animations & Overlays
These optional fields dramatically improve visual quality. USE THEM.

**background** — Animated backgrounds for text-based layouts (text_card, stat_card, quote_card, list_reveal, gradient_title). Do NOT use on screenshot_fullscreen or avatar layouts.
- "particles": Floating particles with depth parallax. Great for tech/modern feel. Use intensity 0.3-0.7.
- "mesh_gradient": Flowing gradient color field, Apple-keynote style. Great for premium/elegant feel. Use intensity 0.3-0.6.
- "gradient_orbs": Subtle animated gradient orb. Good for minimal/clean feel.
- Use a background on at LEAST 50% of text-based shots. Vary between types. Without backgrounds, text shots look flat and boring.

**text_animation** — How text enters the shot. ONLY for text-based layouts.
- "spring_fade": Default smooth fade+scale (use when not specified).
- "typewriter": Character-by-character typing with cursor. Perfect for hook shots, code-like content, or dramatic reveals.
- "glitch": Random character scramble that resolves. Great for tech/hacker aesthetic, bold statements.
- "wave": Per-character sine wave motion. Fun, playful energy.
- "bounce": Per-character bounce entrance. Energetic, attention-grabbing.
- "gradient_sweep": Animated gradient color on text. Premium, eye-catching for titles.
- Use typewriter for hooks, glitch for bold statements, gradient_sweep for CTAs. Don't use the same animation on consecutive shots.

**overlay_config** — Cinematic overlays applied on top of the entire shot.
- vignette: true/false — Darkens edges, draws eye to center. Use on 60-80% of shots for cinematic feel.
- grain: true/false — Subtle film grain texture. Use on 30-50% of shots for premium organic feel.
- letterbox: true/false — Subtle top/bottom gradient bars. Use sparingly (1-3 shots) for dramatic moments.
- Set vignette_intensity (0-1, default 0.35) and grain_intensity (0-1, default 0.04) to control strength.

### Decorations — Animated Stickers & Visual Flair
Optional animated stickers that add personality and engagement. Use sparingly for maximum impact.

**Available decoration_id values:**
- Arrows: "bouncing_arrow" (draw attention below), "curved_arrow" (point to something), "pointing_hand" (direct focus)
- Badges: "subscribe_badge" (CTA), "new_badge" (announcements), "star_burst" (emphasis), "fire_icon" (trending/hot), "checkmark_badge" (success/done)
- Social: "like_heart" (appreciation), "thumbs_up" (approval), "share_icon" (shareability), "comment_bubble" (engagement), "follower_count" (growth)
- Emphasis: "sparkles" (special/magic), "exclamation_marks" (important), "question_marks" (curiosity), "zoom_lines" (dramatic), "speed_lines" (fast/action)
- Emojis: "emoji_fire", "emoji_lightbulb", "emoji_lightning", "emoji_target", "emoji_money", "emoji_rocket"
- Frames: "neon_glow_frame" (highlight area), "polaroid_frame" (photo feel), "rounded_frame" (clean border)

**Placement rules:**
- Add decorations to 30-50% of shots. NOT every shot — that looks cluttered.
- Maximum 2 decorations per shot. 1 is usually enough.
- Position using x,y percentages (0-100). Use edges/corners — don't cover center content.
  Corner positions: (10,10), (90,10), (10,90), (90,90). Edge: (50,5), (95,50).
- Match decoration to content:
  - Hook shots: "emoji_fire", "exclamation_marks", or "zoom_lines" for dramatic impact
  - Feature reveals: "sparkles", "star_burst", or "new_badge"
  - Stats/growth: "emoji_rocket", "follower_count", "emoji_money"
  - CTA/subscribe: "subscribe_badge", "bouncing_arrow", "pointing_hand"
  - Success/completion: "checkmark_badge", "thumbs_up", "like_heart"
  - Questions/hooks: "question_marks", "emoji_lightbulb"
- Use scale 0.8-1.2 (smaller for subtle, larger for emphasis). Default 1.0.
- Don't use decorations on avatar_fullscreen layouts.
{{/directorPrompt}}

{{#hasBRoll}}### B-ROLL KEYWORDS
For shots where a visual cutaway would enhance the video (e.g., abstract concepts, emotional moments, transitions between topics), include a "b_roll_keywords" array with 2-4 descriptive keywords for finding stock footage or generating imagery.
Examples:
- Talking about growth? b_roll_keywords: ["business growth", "chart going up", "success"]
- Talking about security? b_roll_keywords: ["cybersecurity", "digital lock", "data protection"]
- Only add b_roll_keywords to 3-5 shots max. Don't add them to every shot.
- B-roll cutaways will be automatically inserted AFTER the shot with keywords.
{{/hasBRoll}}

## OUTPUT FORMAT
Return a JSON object with this exact structure:
{
  "shots": [
    {
      "duration": number,
      "layout": {{#isPromptOnly}}"text_card" | "stat_card" | "quote_card" | "list_reveal" | "gradient_title"{{/isPromptOnly}}{{^isPromptOnly}}"text_card" | "screenshot_fullscreen"{{#hasAvatarVideo}} | "avatar_pip" | "split_left" | "split_right" | "avatar_fullscreen"{{/hasAvatarVideo}}{{/isPromptOnly}},
      "screenshot_index": number | null,
      "screenshot_description": string | null,
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
      "overlay_config": { "vignette": boolean, "vignette_intensity": number, "grain": boolean, "grain_intensity": number, "letterbox": boolean } | null,
      "decorations": [{ "decoration_id": string, "position": { "x": number, "y": number }, "scale": number }] | null{{#hasBRoll}},
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
    user: `Create a shot list for a presenter video.

## TOPIC / BRIEF
{{ideaContext}}

{{#isPromptOnly}}## MODE: PROMPT ONLY
No screenshots or source URL. Create the video entirely from text-based layouts using the topic/brief above.
{{/isPromptOnly}}
{{^isPromptOnly}}## PAGE METADATA
{{#previousStageOutputs.web_capture.page_metadata}}
Title: {{previousStageOutputs.web_capture.page_metadata.title}}
Description: {{previousStageOutputs.web_capture.page_metadata.description}}
URL: {{previousStageOutputs.web_capture.page_metadata.url}}
{{/previousStageOutputs.web_capture.page_metadata}}
{{#previousStageOutputs.video_ingest.page_metadata}}
Title: {{previousStageOutputs.video_ingest.page_metadata.title}}
Description: {{previousStageOutputs.video_ingest.page_metadata.description}}
URL: {{previousStageOutputs.video_ingest.page_metadata.url}}
{{/previousStageOutputs.video_ingest.page_metadata}}

## SCREENSHOTS ({{previousStageOutputs.web_capture.total_screenshots}}{{previousStageOutputs.video_ingest.total_screenshots}} images attached below — you MUST use ALL of them)
The screenshot images are attached after this text, in order. Map them as: first image = screenshot_index 0, second image = screenshot_index 1, etc.

For EACH shot that references a screenshot, you MUST:
1. Look at the actual image for that screenshot_index
2. Describe ONLY what is visible in that image (text, UI elements, sections, buttons, logos)
3. NEVER mention features, pricing, or UI elements that are not shown in that specific screenshot
{{/isPromptOnly}}

{{#masterPrompt}}## BLUEPRINT GUIDANCE
{{masterPrompt}}{{/masterPrompt}}

Generate the shot list JSON now.`,
  },
  providerConfig: {
    // Vision-capable model for accurate screenshot-to-narration alignment
    model: 'anthropic/claude-sonnet-4',
    temperature: 0.7,
    maxTokens: 6000,
  },
  outputTransform: 'parseDirectorOutput',
});

// ============= B-ROLL STAGE =============

export const B_ROLL_STAGE = defineStage({
  id: 'b_roll',
  type: 'composite',
  provider: 'pexels',
  requires: {
    previousStages: ['director'],
  },
  providerConfig: {},
  customHandler: 'executeBRollStage',
  isAsync: false,
});

// ============= VOICE AVATAR STAGE =============

export const VOICE_AVATAR_STAGE = defineStage({
  id: 'voice_avatar',
  type: 'audio',
  provider: 'elevenlabs',
  requires: {
    previousStages: ['director'],
    libraryElements: ['character'],
  },
  providerConfig: {
    model: 'eleven_multilingual_v2',
  },
  customHandler: 'executeVoiceAvatarStage',
  isAsync: false,
});

// ============= VOICEOVER STAGE =============

export const VOICEOVER_STAGE = defineStage({
  id: 'voiceover',
  type: 'audio',
  provider: 'elevenlabs',
  requires: {
    previousStages: ['director'],
    libraryElements: ['character'],
  },
  providerConfig: {
    model: 'eleven_multilingual_v2',
  },
  customHandler: 'executeVoiceoverStage',
  isAsync: false,
});

// ============= COMPOSITION STAGE =============

export const PRESENTER_COMPOSITION_STAGE = defineStage({
  id: 'composition',
  type: 'video',
  provider: 'remotion',
  requires: {
    previousStages: ['web_capture', 'director', 'voice_avatar'],
    libraryElements: ['brandVoice'],
  },
  providerConfig: {},
  customHandler: 'executePresenterComposeStage',
  isAsync: false,
});

// ============= DYNAMIC STAGE RESOLUTION =============

/**
 * Resolve which stages to include in the presenter_video pipeline
 * based on the presenter configuration.
 *
 * @param config - The presenter config from generation params or configuration
 * @returns Ordered array of stage IDs to execute
 */
export function resolvePresenterStages(config: Record<string, any>): string[] {
  const stages: string[] = [];

  // Source stage (or none for prompt_only)
  const sourceType: string = config.sourceType || config.source_type || 'url';
  if (sourceType === 'url') {
    stages.push('web_capture');
  } else if (sourceType === 'upload') {
    stages.push('video_ingest');
  }
  // sourceType === 'prompt_only' — no source stage

  // Director always runs
  stages.push('director');

  // Optional B-roll
  const bRollEnabled: boolean = config.bRollEnabled ?? config.b_roll_enabled ?? false;
  if (bRollEnabled) {
    stages.push('b_roll');
  }

  // Voice stage
  const voiceType: string = config.voiceType || config.voice_type || 'heygen_avatar';
  if (voiceType === 'heygen_avatar' || voiceType === 'avatar') {
    stages.push('voice_avatar');
  } else if (voiceType === 'voiceover') {
    stages.push('voiceover');
  }
  // voiceType === 'none' — no voice stage

  // Composition always runs
  stages.push('composition');

  return stages;
}

// ============= REGISTER ALL STAGES =============

export function registerPresenterVideoStages(): void {
  StageRegistry.register('presenter_video', WEB_CAPTURE_STAGE);
  StageRegistry.register('presenter_video', VIDEO_INGEST_STAGE);
  StageRegistry.register('presenter_video', DIRECTOR_STAGE);
  StageRegistry.register('presenter_video', B_ROLL_STAGE);
  StageRegistry.register('presenter_video', VOICE_AVATAR_STAGE);
  StageRegistry.register('presenter_video', VOICEOVER_STAGE);
  StageRegistry.register('presenter_video', PRESENTER_COMPOSITION_STAGE);

  console.log('[StageDefinitions] Registered presenter_video stages (flexible pipeline)');
}

// Auto-register on import
registerPresenterVideoStages();

export default {
  WEB_CAPTURE_STAGE,
  VIDEO_INGEST_STAGE,
  DIRECTOR_STAGE,
  B_ROLL_STAGE,
  VOICE_AVATAR_STAGE,
  VOICEOVER_STAGE,
  PRESENTER_COMPOSITION_STAGE,
  resolvePresenterStages,
};
