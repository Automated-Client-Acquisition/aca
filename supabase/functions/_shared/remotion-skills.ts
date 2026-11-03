/**
 * Shared Remotion skill knowledge for the video_director pipeline.
 * Extracts the code rules and skill content used by editor-chat into a
 * reusable module that both editor-chat and execute-stage can consume.
 */

import { SKILLS_MAP } from '../editor-chat/_skills.generated.ts';

export { SKILLS_MAP };

// Core skill keys to include in a video_director composition prompt
const CORE_SKILLS = [
  'remotion/animations',
  'remotion/videos',
  'remotion/sequencing',
  'remotion/transitions',
  'remotion/timing',
  'remotion/text-animations',
  'remotion/compositions',
] as const;

/**
 * Returns the combined skill knowledge for all core Remotion skills.
 * Used to inject into the system prompt for single-turn composition generation.
 */
export function getCoreSkillsContent(): string {
  return CORE_SKILLS
    .map(key => {
      const content = SKILLS_MAP[key];
      if (!content) return '';
      return `## ${key.replace('remotion/', '').toUpperCase()}\n${content}`;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
}

export type AspectRatioDirective = 'portrait' | 'landscape' | 'square';

/**
 * Build the Remotion code generation system prompt.
 * This is the single-turn equivalent of editor-chat's buildSystemPrompt,
 * focused on composition code output only (no interactive workflow).
 */
export function buildCompositionSystemPrompt(opts: {
  aspectRatio: AspectRatioDirective;
  brandColors?: { primary?: string; accent?: string };
  brandFont?: string;
}): string {
  const { aspectRatio, brandColors, brandFont } = opts;

  const aspectDirective =
    aspectRatio === 'portrait' ? 'portrait (9:16, 1080x1920)'
    : aspectRatio === 'landscape' ? 'landscape (16:9, 1920x1080)'
    : 'square (1:1, 1080x1080)';

  const brandBlock = (brandColors?.primary || brandColors?.accent || brandFont)
    ? `\nBRAND VISUAL IDENTITY:
- Primary color: ${brandColors?.primary || '#FFFFFF'}
- Accent color: ${brandColors?.accent || '#FFD700'}
- Font family: ${brandFont || 'Arial, sans-serif'}
Use these colors and fonts throughout the composition for brand consistency.\n`
    : '';

  const skillsContent = getCoreSkillsContent();

  return `You are an expert Remotion video compositor. Your ONLY job is to generate a complete, production-ready Remotion TSX composition based on the video brief provided.

TARGET FORMAT: ${aspectDirective}
${brandBlock}
REMOTION CODE RULES:
1. NO import statements -- all deps are pre-injected as globals
2. Available globals (use without any qualifier):
   AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Sequence, Series,
   Audio, Video, Img, Loop, freeze, random, OffthreadVideo, Easing, interpolateColors,
   TransitionSeries, linearTiming, springTiming, fade, slide, flip, wipe
3. Also accessible as remotion.X if preferred (e.g. remotion.useCurrentFrame())
4. ALWAYS include these metadata comments at the very top of the file:
   // @aspect ${aspectRatio}
   // @duration Xs   (e.g. // @duration 30s)
   // @fps 30
5. ALWAYS end with: export default ComponentName
6. Define all sub-components inline -- no separate files
7. For stock media URLs, use the RESOLVED URLs from the brief (STOCK_VIDEO[n] / STOCK_IMAGE[n] / AI_IMAGE[n] placeholders will be resolved before rendering)
8. For <Video src="..."> use loop and style={{ objectFit: "cover", width: "100%", height: "100%" }}
9. Frame-driven animations ONLY -- spring() and interpolate() -- no CSS transitions or Tailwind

CODE QUALITY BAR:
- Spring-in entrance for every major element (opacity + scale + translateY)
- Dark gradient backgrounds unless the brief specifies otherwise
- Bold, high-contrast typography with clear visual hierarchy
- Layout optimized specifically for ${aspectDirective}
- Cinematic pacing: intentional timing, professional color palette
- Every scene should have purposeful motion -- nothing should be static

MEDIA PLACEHOLDERS:
When the brief references visual content, use placeholder markers that will be resolved:
- STOCK_VIDEO("search query") -- will be replaced with a Pexels video URL
- STOCK_IMAGE("search query") -- will be replaced with a Pexels image URL
- AI_IMAGE("generation prompt") -- will be replaced with an AI-generated image URL

Write these as string literals in your src props: <Video src='STOCK_VIDEO("office team collaborating")' />
The pipeline will resolve them to real URLs before rendering.

Output ONLY the TSX code. No explanations, no markdown fences, no commentary.

---

REMOTION SKILL REFERENCE:

${skillsContent}`;
}
