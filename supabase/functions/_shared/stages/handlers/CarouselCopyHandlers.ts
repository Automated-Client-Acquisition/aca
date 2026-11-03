/**
 * Carousel slide-copy handler (template carousel and AI-image carousel).
 *
 * The caption stage is not here: it is the blueprint prompt run exactly like a
 * social_media_post caption (legacy executeTextStage in execute-stage), so the
 * blueprint prompt alone decides the post.
 *
 * Stage `carousel_content` -> executeCarouselContentStage
 *   Cuts that finished post into slides: cover = the post's hook, one slide per
 *   point in the post's order, CTA = the post's call to action. A validating
 *   normalizer enforces the deck (exact count, cover first, CTA last, layouts,
 *   button-sized CTA) with at most one retry.
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { renderPromptTemplate } from '../../builders/PromptBuilder.ts';
import { cleanLine, parseJsonLoose } from '../../carousel/text.ts';
import { resolveSlideCount, valueSlideCountFor } from '../../carousel/plan.ts';
import { ensureImagePrompts, normalizeCarouselSlides, type NormalizeResult } from '../../carousel/slides.ts';
import { CONTENT_AI_PROMPT, CONTENT_PROMPT } from '../../carousel/prompts.ts';
import { splitFollowUpComment } from '../../follow-up-comment.ts';

// ============= HELPERS =============

type Prompts = { system: string; user: string };

function addUsage(total: Record<string, number>, usage?: Record<string, number>): void {
  for (const [k, v] of Object.entries(usage ?? {})) total[k] = (total[k] ?? 0) + (Number(v) || 0);
}

/** Context plus the `carousel.*` variables the templates use. */
export function carouselContext(context: ExecutionContext, extra: Record<string, unknown> = {}): ExecutionContext {
  const slideCount = resolveSlideCount(context.outputConfig?.slideCount);
  const valueSlideCount = valueSlideCountFor(slideCount);
  return {
    ...context,
    outputConfig: { ...context.outputConfig, slideCount, valueSlideCount },
    carousel: {
      slideCount,
      valueSlideCount,
      lastValueSlide: slideCount - 1,
      ctaInstruction: cleanLine(context.outputConfig?.ctaButtonText),
      instructions: typeof context.instructions === 'string' ? context.instructions.trim() : '',
      ...extra,
    },
  } as ExecutionContext;
}

/** The post the slides are cut from: the stored caption without its first-comment part. */
export function postForSlides(captionStage: any): string {
  const text = String(captionStage?.text ?? captionStage?.content ?? '').trim();
  return splitFollowUpComment(text).caption.trim();
}

/** Append validation problems (and the previous answer) to the user prompt for a retry. */
function withRetryNotes(prompts: Prompts, problems: string[], previous: string): Prompts {
  const notes = problems.map((p) => `- ${p}`).join('\n');
  const prior = previous.length > 7000 ? `${previous.slice(0, 7000)}...` : previous;
  return {
    system: prompts.system,
    user:
      `${prompts.user}\n\n## FIX THESE PROBLEMS FROM YOUR PREVIOUS ANSWER\n${notes}\n\n` +
      `## YOUR PREVIOUS ANSWER\n${prior}\n\nReturn the corrected, complete JSON.`,
  };
}

function rawText(result: StageResult): string {
  if (typeof result.text === 'string' && result.text) return result.text;
  return typeof result.content === 'string' ? result.content : '';
}

// ============= SLIDE COPY =============

export async function executeCarouselContentStage(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine,
): Promise<StageResult> {
  const isAi = context.pipeline === 'instagram_carousel_ai';
  const slideCount = resolveSlideCount(context.outputConfig?.slideCount);
  const ctaInstruction = cleanLine(context.outputConfig?.ctaButtonText);

  const post = postForSlides(context.previousStageOutputs?.caption);
  if (!post) {
    throw new Error('Carousel slides need the post: the caption stage has no text yet.');
  }

  const ctx = carouselContext(context, { post });
  const template = stageDef.promptTemplate ?? (isAi ? CONTENT_AI_PROMPT : CONTENT_PROMPT);
  let prompts: Prompts = renderPromptTemplate(template, ctx);

  const usage: Record<string, number> = {};
  let cost = 0;
  let model: string | undefined;
  let best: NormalizeResult | null = null;
  let bestRaw = '';
  const score = (r: NormalizeResult) => (r.slides.length === 0 ? 1000 : 0) + r.problems.length;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await engine.executeTextStage(ctx, stageDef, prompts);
    addUsage(usage, result.usage);
    cost += result.cost ?? 0;
    model = result.model ?? model;
    const raw = rawText(result);
    const budget = stageDef.providerConfig.maxTokens;
    const outOfBudget = !raw.trim() && result.finishReason === 'length';

    const parsed = parseJsonLoose(raw);
    const normalized = parsed
      ? normalizeCarouselSlides(parsed, { slideCount, ctaInstruction, requireImagePrompt: isAi })
      : {
          slides: [],
          problems: [
            outOfBudget
              ? `The model used its whole ${budget}-token budget thinking and never answered. Try again, or pick a writing model that doesn't reason first.`
              : 'The reply was not valid JSON with a "slides" array.',
          ],
          warnings: [],
        };

    if (!best || score(normalized) < score(best)) {
      best = normalized;
      bestRaw = raw;
    }
    if (normalized.problems.length === 0) break;
    console.log(`[CarouselContent] attempt ${attempt} problems: ${normalized.problems.join(' | ')}`);
    // An empty answer has nothing to correct: retry the same prompt.
    if (raw.trim()) prompts = withRetryNotes(prompts, normalized.problems, raw);
  }

  if (!best || best.slides.length === 0) {
    throw new Error(`Carousel content stage produced no slides: ${best?.problems.join(' ') ?? 'no response'}`);
  }

  const warnings = [...best.warnings, ...best.problems.map((p) => `Unresolved after retry: ${p}`)];
  if (isAi) warnings.push(...ensureImagePrompts(best.slides));

  console.log(`[CarouselContent] ${best.slides.length}/${slideCount} slides from a ${post.length}-char post, ${warnings.length} warning(s)`);

  return {
    // execute-stage flattens this object into stage_data.carousel_content, so
    // stage_data.carousel_content.slides is what the renderer reads.
    content: {
      slides: best.slides,
      visual_story_summary: '',
      raw_text: bestRaw,
      ...(warnings.length ? { quality_warnings: warnings } : {}),
    },
    text: bestRaw,
    model,
    usage,
    cost,
    status: 'completed',
  };
}

export default { executeCarouselContentStage };
