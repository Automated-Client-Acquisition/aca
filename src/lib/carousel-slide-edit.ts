/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Copy of supabase/functions/_shared/carousel/slide-edit.ts.
 * Regenerate with: node scripts/generate-carousel-ports.mjs
 */

/**
 * Applying a text edit to a stored carousel slide without losing its structure.
 *
 * Slides carry more than headline and body now (layout, list items, stat, compare,
 * CTA parts). The slide editor only edits headline, body and the CTA button, so a
 * save must MERGE into the stored slide, and keep the structured fields in step
 * with what was typed:
 *   - a list slide: editing the body re-derives items, lead-in and footnote from it
 *     (the body of a list is "lead\n\n- item\n- item\n\nfootnote"). If the edited
 *     text is no longer a list of 3 or more items, the slide becomes a plain point,
 *     so the text the person typed is what gets drawn.
 *   - a compare slide: its before/after are the content; editing the body turns it
 *     into a point for the same reason.
 *   - the CTA button is stored as cta_button_text (the renderer reads that field first).
 *
 * Source of truth is this file; the frontend gets a generated copy
 * (node scripts/generate-carousel-ports.mjs).
 */

import { parseListBody } from '@/lib/carousel-list-parse';

export interface SlideTextEdit {
  headline?: string;
  body?: string;
  ctaText?: string;
}

const MIN_LIST_ITEMS = 3;

/** Returns a new slide: every field of `slide` kept, the edit applied, structure re-derived. */
export function applySlideTextEdit<T extends object>(slide: T, edit: SlideTextEdit): T {
  const current = slide as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };

  if (edit.headline !== undefined) next.headline = edit.headline;

  if (edit.ctaText !== undefined) {
    next.ctaText = edit.ctaText;
    if (current.type === 'cta' || current.cta_button_text !== undefined) next.cta_button_text = edit.ctaText;
  }

  if (edit.body !== undefined && edit.body !== current.body) {
    next.body = edit.body;
    const wasList = Array.isArray(current.items) || current.layout === 'list';
    if (wasList) {
      const parsed = parseListBody(edit.body);
      if (parsed && parsed.items.length >= MIN_LIST_ITEMS) {
        next.layout = 'list';
        next.items = parsed.items;
        if (parsed.lead) next.lead = parsed.lead; else delete next.lead;
        if (parsed.footnote) next.footnote = parsed.footnote; else delete next.footnote;
      } else {
        next.layout = 'point';
        delete next.items;
        delete next.lead;
        delete next.footnote;
      }
    } else if (current.layout === 'compare') {
      next.layout = 'point';
      delete next.before;
      delete next.after;
    }
  }

  return next as T;
}

// ============= STRUCTURED EDITING (the layout-aware slide editor) =============
//
// The editor shows the fields each slide actually draws: a compare slide edits
// "Instead of" and "Do this", a stat slide edits its number, a list edits its
// items, the cover its label and highlighted words, the CTA its keyword and
// button. readSlideFields fills the form, convertLayout carries the text over
// when the layout is switched, applySlideEdit writes it back.

export type EditableLayout = 'point' | 'list' | 'stat' | 'compare' | 'statement';
export const EDITABLE_LAYOUTS: EditableLayout[] = ['point', 'list', 'stat', 'compare', 'statement'];

export interface SlideFields {
  type: 'cover' | 'content' | 'cta';
  /** Content slides only; 'point' for the cover and the CTA. */
  layout: EditableLayout;
  kicker: string;
  headline: string;
  highlight: string;
  /** Point, stat and statement text; the cover's subline. Derived for list, compare and CTA. */
  body: string;
  items: string[];
  lead: string;
  footnote: string;
  stat_value: string;
  stat_label: string;
  before: string;
  after: string;
  cta_keyword: string;
  cta_button_text: string;
  cta_reason: string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const isLayout = (v: unknown): v is EditableLayout => EDITABLE_LAYOUTS.includes(v as EditableLayout);

// How a compare slide's body reads ("Instead of: ...\nDo this: ...").
const COMPARE_BODY = /^\s*instead of:\s*([\s\S]*?)\n\s*do this:\s*([\s\S]*)$/i;
const STAT_TOKEN = /[$€£]?\d[\d,.]*\s?(?:%|x|k|m|bn|\+)?/i;

function sentences(s: string): string[] {
  return (s.match(/[^.!?\n]+[.!?]?/g) ?? []).map((x) => x.trim()).filter(Boolean);
}

function withPeriod(s: string): string {
  const t = s.trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
}

const KEYWORD_STOPWORDS = new Set([
  'below', 'here', 'down', 'me', 'us', 'yes', 'the', 'a', 'an', 'your', 'now', 'if', 'and', 'for', 'to', 'in', 'this', 'that',
  'word', 'it', 'link', 'bio', 'post', 'more',
]);

/** A comment keyword as typed: letters, digits and single spaces, uppercased. Same rule as cleanKeyword in plan.ts. */
export function cleanKeyword(input: string): string {
  return input.replace(/[^A-Za-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** The comment keyword a button asks for ("Comment GUIDE" -> GUIDE, Comment "GMAPS AGENT" -> GMAPS AGENT), or null. Same rule as extractCtaKeyword in plan.ts. */
export function buttonKeyword(button: string): string | null {
  const quoted = button.match(/(?<![A-Za-z])['"]([A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+){0,2})['"]/);
  if (quoted && quoted[1].length >= 2 && quoted[1].length <= 24 && !KEYWORD_STOPWORDS.has(quoted[1].toLowerCase())) {
    return quoted[1].toUpperCase();
  }
  const verb = button.match(/\b(?:comment|drop|type|reply(?:\s+with)?|dm(?:\s+me)?|write)\s+(?:the\s+word\s+)?['"]?([A-Za-z][A-Za-z0-9]{1,19})\b/i);
  if (!verb || KEYWORD_STOPWORDS.has(verb[1].toLowerCase())) return null;
  const words = [verb[1]];
  if (/^[A-Z][A-Z0-9]+$/.test(verb[1])) {
    const rest = button.slice((verb.index ?? 0) + verb[0].length).match(/^(?: [A-Z][A-Z0-9]+){1,2}\b/);
    for (const w of rest ? rest[0].trim().split(' ') : []) {
      if (KEYWORD_STOPWORDS.has(w.toLowerCase())) break;
      words.push(w);
    }
  }
  return words.join(' ').toUpperCase();
}

/** The editable fields of a stored slide. Older slides get their layout inferred. */
export function readSlideFields(slide: object): SlideFields {
  const c = slide as Record<string, unknown>;
  const type = c.type === 'cover' || c.type === 'cta' ? c.type : 'content';
  const body = text(c.body);
  let layout: EditableLayout = isLayout(c.layout) ? c.layout : 'point';
  let items = Array.isArray(c.items) ? c.items.map(text).filter(Boolean) : [];
  let lead = text(c.lead);
  let footnote = text(c.footnote);
  let before = text(c.before);
  let after = text(c.after);

  if (type === 'content') {
    if ((layout === 'list' || !isLayout(c.layout)) && items.length === 0) {
      const parsed = parseListBody(body);
      if (parsed && parsed.items.length >= MIN_LIST_ITEMS) {
        layout = 'list';
        items = parsed.items;
        lead = parsed.lead;
        footnote = parsed.footnote;
      }
    }
    if (layout === 'compare' && !(before && after)) {
      const m = body.match(COMPARE_BODY);
      if (m) {
        before = m[1].trim();
        after = m[2].trim();
      }
    }
  }

  return {
    type,
    layout: type === 'content' ? layout : 'point',
    kicker: text(c.kicker),
    headline: text(c.headline),
    highlight: text(c.highlight),
    body: type === 'cta' || layout === 'list' || layout === 'compare' ? '' : body,
    items,
    lead,
    footnote,
    stat_value: text(c.stat_value),
    stat_label: text(c.stat_label),
    before,
    after,
    cta_keyword: text(c.cta_keyword),
    cta_button_text: text(c.cta_button_text ?? c.ctaText),
    cta_reason: text(c.cta_reason) || (type === 'cta' ? body : ''),
  };
}

/** The body text that goes with the fields. Older readers, exports and text previews use it. */
export function bodyFromFields(f: SlideFields): string {
  if (f.type === 'cta') return f.cta_reason.trim();
  if (f.type === 'content' && f.layout === 'list') {
    const list = f.items.map((i) => i.trim()).filter(Boolean).map((i) => `- ${i}`).join('\n');
    return [f.lead.trim(), list, f.footnote.trim()].filter(Boolean).join('\n\n');
  }
  if (f.type === 'content' && f.layout === 'compare') {
    return f.before.trim() || f.after.trim() ? `Instead of: ${f.before.trim()}\nDo this: ${f.after.trim()}` : '';
  }
  return f.body.trim();
}

/** Switch a content slide's layout, carrying its text over so nothing typed is lost. */
export function convertLayout(f: SlideFields, to: EditableLayout): SlideFields {
  if (f.type !== 'content' || f.layout === to) return f;
  // the slide's current text as prose, whatever layout it had
  const prose =
    f.layout === 'list'
      ? [f.lead, ...f.items, f.footnote].map(withPeriod).filter(Boolean).join(' ')
      : f.layout === 'compare'
        ? [f.before, f.after].map(withPeriod).filter(Boolean).join(' ')
        : f.body.trim();
  const next: SlideFields = { ...f, layout: to };

  if (to === 'list') {
    if (f.layout === 'compare') {
      next.items = [f.before, f.after].map((s) => s.trim()).filter(Boolean);
      next.lead = '';
      next.footnote = '';
    } else {
      const parsed = parseListBody(f.body);
      const fromBody = parsed && parsed.items.length >= 2 ? parsed.items : sentences(prose).map((s) => s.replace(/[.!?]+$/, ''));
      next.items = fromBody.slice(0, 4);
      next.lead = parsed && parsed.items.length >= 2 ? parsed.lead : '';
      next.footnote = parsed && parsed.items.length >= 2 ? parsed.footnote : '';
    }
  } else if (to === 'compare') {
    const parts = f.layout === 'list' ? f.items : sentences(prose);
    next.before = f.before || parts[0] || '';
    next.after = f.after || parts[1] || '';
  } else {
    next.body = prose;
    if (to === 'stat' && !next.stat_value) {
      next.stat_value = (f.headline.match(STAT_TOKEN) ?? prose.match(STAT_TOKEN))?.[0]?.trim() ?? '';
    }
  }
  return next;
}

/**
 * Write the editor's fields into a stored slide. Every other field is kept, fields
 * that belong to another layout are cleared (the renderer must never draw a stale
 * one), the body stays in step, and the CTA keyword and button stay consistent:
 * renaming the keyword renames it in the button, and a new button decides the
 * keyword, so the big keyword chip never contradicts the button.
 */
export function applySlideEdit<T extends object>(slide: T, f: SlideFields): T {
  const current = slide as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  const set = (key: string, value: string) => {
    if (value.trim()) next[key] = value.trim();
    else delete next[key];
  };

  next.headline = f.headline.trim();
  set('kicker', f.kicker);
  if (f.type === 'cover') set('highlight', f.highlight);

  if (f.type === 'content') {
    next.layout = f.layout;
    for (const key of ['items', 'lead', 'footnote', 'stat_value', 'stat_label', 'before', 'after']) delete next[key];
    if (f.layout === 'list') {
      next.items = f.items.map((i) => i.trim()).filter(Boolean);
      set('lead', f.lead);
      set('footnote', f.footnote);
    } else if (f.layout === 'stat') {
      set('stat_value', f.stat_value);
      set('stat_label', f.stat_label);
    } else if (f.layout === 'compare') {
      set('before', f.before);
      set('after', f.after);
    }
  }

  if (f.type === 'cta') {
    const oldKeyword = cleanKeyword(text(current.cta_keyword));
    const oldButton = text(current.cta_button_text ?? current.ctaText).trim();
    let keyword = cleanKeyword(f.cta_keyword);
    let button = f.cta_button_text.trim();
    const buttonChanged = button !== oldButton;
    const keywordChanged = keyword !== oldKeyword;
    if (keywordChanged && !buttonChanged && oldKeyword && keyword && button) {
      button = button.replace(new RegExp(`\\b${oldKeyword}\\b`, 'gi'), keyword);
    } else if (buttonChanged && !keywordChanged) {
      keyword = buttonKeyword(button) ?? '';
    }
    set('cta_keyword', keyword);
    set('cta_button_text', button);
    if (current.ctaText !== undefined) next.ctaText = button;
    set('cta_reason', f.cta_reason);
  }

  next.body = bodyFromFields(f);

  // AI-image slides quote their text inside the image prompt. After a text edit that
  // prompt would redraw the old words, so drop it: the slide handler rebuilds it from
  // the new text and the blueprint's style.
  if ((current.image_prompt || current.prompt) && visibleText(readSlideFields(current)) !== visibleText(f)) {
    delete next.image_prompt;
    delete next.prompt;
  }
  return next as T;
}

function visibleText(f: SlideFields): string {
  return JSON.stringify([
    f.layout, f.kicker, f.headline, f.highlight, bodyFromFields(f), f.stat_value, f.stat_label,
    f.cta_keyword.toUpperCase(), f.cta_button_text,
  ].map((v) => v.trim()));
}
