/**
 * Carousel text helpers (pure, no Deno or network APIs so they are unit-testable).
 *
 * Everything the carousel plan and slide-copy stages need to clean up model
 * output: loose JSON parsing, copy sanitizing, word counting.
 */

import { normalizeDashes } from '../sanitize-ai-output.ts';

/**
 * Parse JSON out of a model reply. Tolerates code fences, chatter before or
 * after the object, and trailing commas. Returns null when nothing parses.
 */
export function parseJsonLoose(raw: unknown): any | null {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;

  const attempts: string[] = [text];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) attempts.push(fenced[1]);

  const firstObj = text.indexOf('{');
  const lastObj = text.lastIndexOf('}');
  if (firstObj !== -1 && lastObj > firstObj) attempts.push(text.slice(firstObj, lastObj + 1));

  const firstArr = text.indexOf('[');
  const lastArr = text.lastIndexOf(']');
  if (firstArr !== -1 && lastArr > firstArr) attempts.push(text.slice(firstArr, lastArr + 1));

  for (const candidate of attempts) {
    for (const variant of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        return JSON.parse(variant);
      } catch {
        // try the next variant
      }
    }
  }
  return null;
}

/** Remove every emoji (slide text is drawn in fonts that have none, and they read as clutter). */
export function stripAllEmoji(text: string): string {
  return text
    .replace(/(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*\uFE0F?)+/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Number of whitespace-separated words. */
export function wordCount(text: string | undefined | null): number {
  if (!text) return 0;
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Clean one piece of slide or caption copy: dashes, smart quotes, markdown.
 * Line breaks and a leading "- " bullet marker are kept (callers parse bullets).
 */
export function cleanCopy(input: unknown): string {
  if (input === null || input === undefined) return '';
  let text = typeof input === 'string' ? input : String(input);
  text = normalizeDashes(text)
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/…/g, '...')
    // markdown artifacts that would render literally on a slide
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)\*([^*\s][^*]*?)\*(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)_([^_\s][^_]*?)_(?=\s|$)/g, '$1$2')
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n');
  return text.trim();
}

/** cleanCopy for a single-line field (headline, label, button). */
export function cleanLine(input: unknown): string {
  return cleanCopy(input).replace(/\s*\n+\s*/g, ' ').trim();
}

/** Split a body into bullet items: "- a\n- b" or "1. a\n2. b" or "a\nb" (2+ lines). */
export function bulletLines(body: string | undefined | null): string[] {
  if (!body) return [];
  const lines = body
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•●]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines;
}

/** True when the body is written as a bullet list (every line has a marker, 2+ lines). */
export function looksLikeBulletList(body: string | undefined | null): boolean {
  if (!body) return false;
  const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  return lines.every((l) => /^(?:[-*•●]|\d+[.)])\s+/.test(l));
}
