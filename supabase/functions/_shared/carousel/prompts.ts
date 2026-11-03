/**
 * Carousel slide prompts (Mustache-style, rendered by PromptBuilder).
 *
 * The caption is NOT written here: it is the blueprint prompt, run exactly like a
 * social_media_post caption (legacy executeTextStage in execute-stage). These
 * prompts only turn that finished post into slides, and they carry nothing but
 * the format the renderer needs (deck shape, fields, length limits, JSON). Copy
 * rules (tone, hashtags, CTA style, hooks) belong in the blueprint prompt.
 *
 * Template rules that matter here (see builders/PromptBuilder.ts):
 * - a {{#x}}...{{/x}} block must not contain another {{#y}}...{{/y}} block, and
 *   a {{^x}}...{{/x}} block must not contain another {{^y}}...{{/y}} block
 *   (nested blocks of the same kind are left unrendered); mixing kinds is fine
 * - no double braces in examples: write JSON with spaces after "{"
 *
 * Extra context the content handler adds under `carousel.*`:
 *   slideCount, valueSlideCount, lastValueSlide, post, ctaInstruction, instructions
 * (retry notes are appended to the rendered user prompt by the handler)
 */

import type { PromptTemplate } from '../execution/types.ts';

// ============= SHARED BLOCKS =============

const BLUEPRINT_BLOCK = `{{#masterPrompt}}## THE BLUEPRINT PROMPT THE POST WAS WRITTEN FROM
The post already follows it. Apply anything it says about the slides or the carousel.
{{masterPrompt}}{{/masterPrompt}}`;

const CTA_INSTRUCTION_BLOCK = `{{#carousel.ctaInstruction}}## CALL TO ACTION SET ON THE BLUEPRINT
"{{carousel.ctaInstruction}}". Use it for the last slide. Never paste it into the button as is unless it is already 5 words or fewer.{{/carousel.ctaInstruction}}`;

const USER_INSTRUCTIONS_BLOCK = `{{#carousel.instructions}}## EXTRA INSTRUCTIONS FROM THE USER FOR THIS REWRITE
{{carousel.instructions}}{{/carousel.instructions}}`;

const FIELD_SPEC = `## FIELDS PER SLIDE
Cover (slide 1): "type": "cover", "headline", "body" (the subline, may be empty), optional "kicker" (a 2 to 3 word uppercase label taken from the post, never repeating the headline) and "highlight" (1 to 3 words copied exactly from the headline, drawn in color).
Value slides: "type": "content", "layout", "headline", plus the fields of that layout:
- "point": "body" (one or two short sentences, 140 characters or fewer)
- "list": "items" (3 or 4 strings, same grammatical form, 8 words or fewer each so every item fits on ONE line, no trailing periods, never a marker like "-" or a number). Optional "lead" (one line of 12 words or fewer that sets the list up) and "footnote" (one short line after it). Never put prose paragraphs on a list slide.
- "stat": "stat_value" (the number, 8 characters or fewer, like "47%", "$5K", "3x"), "stat_label" (10 words or fewer, what the number counts), "body" (optional one line)
- "compare": "before" (12 words or fewer), "after" (12 words or fewer)
- "statement": nothing but "headline" (one line, 14 words or fewer)
Call to action (last slide): "type": "cta", "headline", "cta_button_text" (5 words or fewer), "cta_reason" (12 words or fewer), "cta_keyword" (the word the post asks people to comment, or empty), optional "kicker" (8 words or fewer).

Hard limits (the text is drawn at a fixed size, so long copy breaks the slide):
- Cover headline: 8 words or fewer. Content headline: 7 words or fewer.
- No markdown (no asterisks, hashes or backticks), no emojis.
- Never write a list into one line with commas, pipes, middots or arrows, and never put list markers inside "body": use "items".
- A slide is either a list or prose, never both.
- Inside JSON text values never use double quotes; use single quotes when you need to quote something.`;

const OUTPUT_EXAMPLE = `## OUTPUT (valid JSON only, no code fences, no commentary)
{
  "slides": [
    { "slide_number": 1, "type": "cover", "kicker": "...", "headline": "...", "highlight": "...", "body": "..." },
    { "slide_number": 2, "type": "content", "layout": "point", "headline": "...", "<the fields of that layout>": "..." },
    ... one object per value slide, up to slide {{carousel.lastValueSlide}} ...
    { "slide_number": {{carousel.slideCount}}, "type": "cta", "headline": "...", "cta_keyword": "", "cta_button_text": "...", "cta_reason": "..." }
  ]
}
Write exactly {{carousel.slideCount}} slide objects (no "..." lines in the real output).`;

const CONTENT_SYSTEM_HEAD = `You turn a finished social media post into the slides of the carousel published with it. The post is written and approved: your job is layout, not writing. Someone who only swipes the slides should get what the post says.

## THE POST IS THE ONLY SOURCE
- Every slide says something the post says, in the post's words, cut down to the slide limits below. A sentence from the post that is too long for its field gets shortened, never copied whole (a list item is one line of 8 words or fewer).
- Add nothing the post does not contain: no new facts, numbers, names, examples, claims, offers, hashtags or calls to action.
- Keep the post's order.

## DECK SHAPE (exact)
{{carousel.slideCount}} slides: slide 1 is the cover, slides 2 to {{carousel.lastValueSlide}} are the {{carousel.valueSlideCount}} value slides, slide {{carousel.slideCount}} is the call to action.
- Cover: the post's opening line, shortened to fit when it is too long. Keep its meaning and its key words.
- Value slides: the post's points in the order the post makes them, one per slide. If the post has more points than value slides, combine the closest ones; if it has fewer, split the longest one. Never fill a slide with something the post does not say.
- Call to action: the post's own call to action, shortened to fit.
- If the cover headline names a count ("3 steps"), it must equal {{carousel.valueSlideCount}}.

## LAYOUTS
Pick each value slide's layout from the shape of the post's point: "point" by default; "list" only when the point is 3 or 4 parallel items; "stat" only for a number the post states; "compare" only when the post itself contrasts two ways of doing something; "statement" for one line that stands on its own.`;

const CONTENT_USER = `Turn this post into the {{carousel.slideCount}} slides of its carousel.

## THE POST
{{carousel.post}}

${BLUEPRINT_BLOCK}

${CTA_INSTRUCTION_BLOCK}

${USER_INSTRUCTIONS_BLOCK}

Return the JSON now with exactly {{carousel.slideCount}} slides.`;

export const CONTENT_PROMPT: PromptTemplate = {
  system: `${CONTENT_SYSTEM_HEAD}

${FIELD_SPEC}

${OUTPUT_EXAMPLE}`,
  user: CONTENT_USER,
};

// ============= AI-image variant: slide copy plus an image prompt per slide =============

const AI_IMAGE_RULES = `## IMAGE_PROMPT RULES (critical)
Each slide is drawn by an AI image model, so the image IS the slide. Every slide needs a non-empty "image_prompt" that describes a finished, post-ready slide.
- The image_prompt must tell the model to render the slide's own text legibly. Wrap the exact words in quotes so they are drawn verbatim: the headline, and the supporting text or CTA button label where the slide has them.
- Describe the composition for the layout: a "stat" slide has one giant numeral, a "compare" slide has two columns, a "list" slide has clearly separated rows, a "statement" slide is one huge line, a "point" slide is a headline over a short block of text. The cover is a big poster-like hook, the CTA slide has a clear button.
- Keep ONE consistent visual style, layout system and color treatment across all slides so the deck reads as one set.
- One clear focal idea per slide. No clutter, no filler graphics.
{{#imagePromptTemplate}}- BRAND VISUAL STYLE (apply it to every slide's image_prompt):
{{imagePromptTemplate}}{{/imagePromptTemplate}}
{{^imagePromptTemplate}}{{#brandVoice.colorPalette}}- Use the brand color palette in every slide.{{/brandVoice.colorPalette}}{{/imagePromptTemplate}}`;

export const CONTENT_AI_PROMPT: PromptTemplate = {
  system: `${CONTENT_SYSTEM_HEAD}

${FIELD_SPEC}
- Every slide also has "image_prompt" (see below).

${AI_IMAGE_RULES}

${OUTPUT_EXAMPLE}
Every slide object also carries "image_prompt".`,
  user: CONTENT_USER,
};
