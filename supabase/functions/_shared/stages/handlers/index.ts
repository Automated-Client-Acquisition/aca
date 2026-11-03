/**
 * Custom Handlers Index
 *
 * Exports all custom stage handlers and registers them with the ExecutionEngine.
 *
 * Handlers registered here:
 * - executeCarouselContentStage  — Carousel slide copy cut from the post (validated, one retry)
 * - executeCarouselSlidesStage  — Instagram carousel slide image generation (OpenRouter)
 * - executeSceneImagesStage     — YouTube Shorts / TikTok scene image generation (OpenRouter)
 * - executeHeroImageStage       — Blog article hero image generation (OpenRouter)
 * - executeWebCaptureStage      — Presenter pipeline web capture (Fly.io worker)
 * - executeVideoIngestStage     — Presenter pipeline uploaded video frame extraction (Fly.io worker)
 * - executeVoiceAvatarStage     — Presenter pipeline TTS + lip-sync avatar (ElevenLabs/HeyGen/Sync Labs)
 * - executeVoiceoverStage       — Presenter pipeline TTS-only voiceover (ElevenLabs)
 * - executeBRollStage           — Presenter pipeline B-roll stock footage / AI images (Pexels/OpenRouter)
 * - executePresenterComposeStage — Presenter pipeline Remotion composition (Fly.io worker)
 * - executeStoryboardVoiceoverStage — Storyboard voiceover with section segmentation (ElevenLabs + OpenRouter)
 * - executeStoryboardImagesStage — Storyboard scene image generation (OpenRouter)
 * - executeStoryboardComposeStage — Storyboard Remotion composition (Fly.io worker)
 */

import { registerCustomHandler } from '../../execution/ExecutionEngine.ts';

// ===== Existing handlers =====
import { executeCarouselSlidesHandler } from './CarouselSlidesHandler.ts';
import { executeOpenAICarouselSlidesHandler } from './OpenAICarouselSlidesHandler.ts';
import { executeAiCarouselSlidesStage } from './AiCarouselSlidesDispatch.ts';
import { executeCarouselContentStage } from './CarouselCopyHandlers.ts';
import { executeSceneImagesHandler } from './SceneImagesHandler.ts';
import { executeHeroImageHandler } from './HeroImageHandler.ts';

// ===== Presenter video pipeline handlers =====
import { executeWebCaptureStage } from './PresenterCaptureHandler.ts';
import { executeVideoIngestStage } from './VideoIngestHandler.ts';
import { executeVoiceAvatarStage } from './PresenterVoiceHandler.ts';
import { executeBRollStage } from './BRollHandler.ts';
import { executePresenterComposeStage } from './PresenterComposeHandler.ts';

// ===== Video remix pipeline handlers =====
import { executeTranscribeStage } from './TranscribeHandler.ts';
import { executeRemixComposeStage } from './RemixComposeHandler.ts';

// ===== Storyboard video pipeline handlers =====
import { executeStoryboardVoiceoverStage } from './StoryboardVoiceoverHandler.ts';
import { executeStoryboardImagesStage } from './StoryboardImagesHandler.ts';
import { executeStoryboardComposeStage } from './StoryboardComposeHandler.ts';

// ===== Unified video pipeline handlers =====
import { executeUnifiedVoiceStage } from './UnifiedVoiceHandler.ts';
import { executeVideoComposeStage } from './VideoComposeHandler.ts';

// ===== Register all handlers =====

// Existing
// Carousel slide copy (stage `carousel_content`). The caption is the legacy text path.
registerCustomHandler('executeCarouselContentStage', executeCarouselContentStage);
registerCustomHandler('executeCarouselSlidesStage', executeCarouselSlidesHandler);
registerCustomHandler('executeOpenAICarouselSlidesStage', executeOpenAICarouselSlidesHandler);
// AI-carousel dispatcher — routes to gpt-5.5 multiturn or Gemini by blueprint provider.
registerCustomHandler('executeAiCarouselSlidesStage', executeAiCarouselSlidesStage);
registerCustomHandler('executeSceneImagesStage', executeSceneImagesHandler);
registerCustomHandler('executeHeroImageStage', executeHeroImageHandler);

// Presenter video pipeline
registerCustomHandler('executeWebCaptureStage', executeWebCaptureStage);
registerCustomHandler('executeVideoIngestStage', executeVideoIngestStage);
registerCustomHandler('executeVoiceAvatarStage', executeVoiceAvatarStage);
// Voiceover-only mode reuses the same handler — it detects avatar_type: 'none' internally
registerCustomHandler('executeVoiceoverStage', executeVoiceAvatarStage);
registerCustomHandler('executeBRollStage', executeBRollStage);
registerCustomHandler('executePresenterComposeStage', executePresenterComposeStage);

// Video remix pipeline
registerCustomHandler('executeTranscribeStage', executeTranscribeStage);
registerCustomHandler('executeRemixComposeStage', executeRemixComposeStage);

// Storyboard video pipeline
registerCustomHandler('executeStoryboardVoiceoverStage', executeStoryboardVoiceoverStage);
registerCustomHandler('executeStoryboardImagesStage', executeStoryboardImagesStage);
registerCustomHandler('executeStoryboardComposeStage', executeStoryboardComposeStage);

// Unified video pipeline
registerCustomHandler('executeUnifiedVoiceStage', executeUnifiedVoiceStage);
registerCustomHandler('executeVideoComposeStage', executeVideoComposeStage);

// ===== Exports =====

// Existing handlers
export { executeCarouselSlidesHandler } from './CarouselSlidesHandler.ts';
export { executeSceneImagesHandler } from './SceneImagesHandler.ts';
export { executeHeroImageHandler } from './HeroImageHandler.ts';

// Presenter video pipeline
export { executeWebCaptureStage } from './PresenterCaptureHandler.ts';
export { executeVideoIngestStage } from './VideoIngestHandler.ts';
export { executeVoiceAvatarStage } from './PresenterVoiceHandler.ts';
export { executeBRollStage } from './BRollHandler.ts';
export { executePresenterComposeStage } from './PresenterComposeHandler.ts';

// Video remix pipeline
export { executeTranscribeStage } from './TranscribeHandler.ts';
export { executeRemixComposeStage } from './RemixComposeHandler.ts';

// Storyboard video pipeline
export { executeStoryboardVoiceoverStage } from './StoryboardVoiceoverHandler.ts';
export { executeStoryboardImagesStage } from './StoryboardImagesHandler.ts';
export { executeStoryboardComposeStage } from './StoryboardComposeHandler.ts';

// Unified video pipeline
export { executeUnifiedVoiceStage } from './UnifiedVoiceHandler.ts';
export { executeVideoComposeStage } from './VideoComposeHandler.ts';

console.log(
  '[CustomHandlers] Registered handlers: carousel_slides, scene_images, hero_image, ' +
  'web_capture, video_ingest, voice_avatar, b_roll, presenter_compose, transcribe, remix_compose, ' +
  'storyboard_voiceover, storyboard_images, storyboard_compose, unified_voice, video_compose'
);
