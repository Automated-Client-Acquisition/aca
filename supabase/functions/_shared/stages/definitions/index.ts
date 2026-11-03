/**
 * Stage Definitions Index
 *
 * Imports and registers all pipeline stage definitions.
 * Each definition file auto-registers its stages with StageRegistry on import.
 *
 * Registered pipelines:
 * - instagram_carousel  (3 stages: caption, carousel_content, carousel_slides)
 * - blog_article        (3 stages: outline, article, hero_image)
 * - presenter_video     (4 stages: web_capture, director, voice_avatar, composition)
 * - storyboard_video_longform (5 stages: outline, full_voiceover, scenes, storyboard, final)
 * - video_remix         (8 stages: video_ingest, transcribe, rewrite, director, b_roll, voice_avatar, voiceover, composition)
 * - video              (10 stages: unified pipeline replacing presenter/storyboard/remix)
 */

// Import all pipeline definitions (auto-registers on import)
export * from './instagram_carousel.ts';
export * from './instagram_carousel_ai.ts';
export * from './blog_article.ts';
export * from './presenter_video.ts';
export * from './storyboard_video_longform.ts';
export * from './video_remix.ts';
export * from './video.ts';

// Import custom handlers (auto-registers on import)
import '../handlers/index.ts';

// Export registry for convenience
export { StageRegistry } from '../../execution/StageRegistry.ts';
