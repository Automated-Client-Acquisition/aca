/**
 * Idea guidelines: what a post from an idea may say.
 *
 * ai_analysis.talking_points  the points to make (source of truth)
 * ai_analysis.talking_points_ai  points the AI wrote that nobody reviewed yet
 * ai_analysis.avoid  things the post must not mention
 * content_ideas.guidelines_approved_at  a person approved them
 *
 * Mirrored for the app in src/lib/idea-guidelines.ts. Keep the number check in sync.
 */

/** Rules every talking-point writer gets, so points don't invent facts. */
export const GROUNDING_RULES = `FACTS RULES (strict):
- Only state facts, numbers, names, dates, product features, launches, news, quotes or client results that appear in the material above.
- Never invent statistics, percentages, prices, timeframes, studies, product releases, news events, customer stories or quotes.
- If the material has no facts for a point, write it as an argument, opinion or piece of advice, without numbers.
- A number is allowed only if that same number appears in the material.`;

/** How many points a suggestion adds. Short lists get covered; long ones get cherry-picked. */
export const SUGGESTED_POINT_COUNT = 4;

export function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v : typeof v === 'object' && v && 'text' in v ? String((v as any).text) : ''))
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * The points nobody has reviewed yet. Approving always writes
 * talking_points_ai (as []), so an idea without the key predates guidelines
 * and all of its points count as unreviewed AI drafts.
 */
export function draftPoints(analysis: Record<string, any> | null | undefined, points: string[]): string[] {
  const ai = analysis?.talking_points_ai;
  if (!Array.isArray(ai)) return [...points];
  const set = new Set(cleanList(ai));
  return points.filter((p) => set.has(p));
}

/**
 * ai_analysis written by an agent (MCP, API) on a new idea: every point is an
 * unreviewed draft, whatever the caller claims.
 */
export function withDraftPoints(analysis: unknown): Record<string, any> | null {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return null;
  const out: Record<string, any> = { ...(analysis as Record<string, any>) };
  const points = cleanList(out.talking_points);
  out.talking_points = points;
  out.talking_points_ai = points;
  if ('avoid' in out) out.avoid = cleanList(out.avoid);
  return out;
}

/**
 * An agent's ai_analysis update, merged into the idea's (it used to replace the
 * whole object, wiping points it didn't mention). Points it adds or rewrites
 * become drafts; points it keeps keep their review state. The draft list itself
 * can't be set from outside.
 */
export function mergeAgentAnalysis(existing: Record<string, any> | null | undefined, incoming: Record<string, any>): Record<string, any> {
  const base = existing && typeof existing === 'object' ? existing : {};
  const merged: Record<string, any> = { ...base, ...incoming };
  if ('talking_points' in incoming) {
    const before = cleanList(base.talking_points);
    const stillDraft = new Set(draftPoints(base, before));
    const points = cleanList(incoming.talking_points);
    merged.talking_points = points;
    merged.talking_points_ai = points.filter((p) => stillDraft.has(p) || !before.includes(p));
  } else if ('talking_points_ai' in base) {
    merged.talking_points_ai = base.talking_points_ai;
  } else {
    delete merged.talking_points_ai;
  }
  if ('avoid' in incoming) merged.avoid = cleanList(incoming.avoid);
  return merged;
}

/** Append new points after the existing ones, skipping duplicates. */
export function appendPoints(existing: string[], added: string[]): string[] {
  const seen = new Set(existing.map((p) => p.toLowerCase()));
  const out = [...existing];
  for (const p of added) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Number check: numbers in a point that no source contains
// ---------------------------------------------------------------------------

const NUMBER_RE = /(?:([$€£])\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?%|\s?percent\b|x\b|[kmb]\b|\+)?/gi;

interface NumberMatch {
  raw: string;
  key: string;
  isClaim: boolean;
}

function numberKey(num: string, suffix: string): string {
  const n = num.replace(/,/g, '');
  const s = suffix.trim().toLowerCase();
  const mult = s === 'k' ? 1e3 : s === 'm' ? 1e6 : s === 'b' ? 1e9 : 1;
  if (mult === 1) return n;
  const v = parseFloat(n) * mult;
  return Number.isFinite(v) ? String(v) : n;
}

function scanNumbers(text: string): NumberMatch[] {
  const out: NumberMatch[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const idx = m.index ?? 0;
    const before = idx > 0 ? text[idx - 1] : '';
    const after = text[idx + m[0].length] || '';
    // Part of a word or version ("B2B", "GPT4", "v2", "Q3"), or "24/7": not a claim.
    if (/[\p{L}\d_./]/u.test(before) && !m[1]) continue;
    if (after === '/') continue;
    const currency = m[1] || '';
    const num = m[2];
    const suffix = m[3] || '';
    const value = parseFloat(num.replace(/,/g, ''));
    const isYear = !currency && !suffix && /^(19|20)\d{2}$/.test(num);
    const isClaim = !!currency || !!suffix.trim() || (!isYear && Number.isInteger(value) && value >= 10);
    out.push({ raw: `${currency}${num}${suffix}`.trim(), key: numberKey(num, suffix), isClaim });
  }
  return out;
}

/** Numbers in `point` that read as claims and don't appear anywhere in `sources`. */
export function findUnsupportedNumbers(point: string, sources: string): string[] {
  const claims = scanNumbers(point).filter((n) => n.isClaim);
  if (claims.length === 0) return [];
  const known = new Set(scanNumbers(sources).map((n) => n.key));
  const out: string[] = [];
  for (const c of claims) {
    if (!known.has(c.key) && !out.includes(c.raw)) out.push(c.raw);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text the writer gets
// ---------------------------------------------------------------------------

/** Every fact the writer uses must come from what the prompt gives it. */
const FACTS_RULE =
  "Only state facts, numbers, names, news or results that this prompt gives you (the points, notes, sources, product or brand details). If a detail isn't there, leave it out instead of guessing.";

/** "Don't mention" plus the facts rule, for prompts that already list the points (or shouldn't). */
export function guardrailsText(avoid: string[]): string {
  const lines: string[] = [];
  if (avoid.length) lines.push(`Don't mention: ${avoid.join('; ')}.`);
  lines.push(FACTS_RULE);
  return lines.join('\n');
}

/** The whole guidelines block: points to make, what to avoid, the facts rule. */
export function guidelinesText(points: string[], avoid: string[]): string {
  if (points.length === 0 && avoid.length === 0) return '';
  const parts: string[] = [];
  if (points.length) {
    parts.push(`Points to make (cover each one, in your own words):\n${points.map((p) => `• ${p}`).join('\n')}`);
  }
  parts.push(guardrailsText(avoid));
  return parts.join('\n');
}
