/**
 * Idea guidelines in the app: what a post from an idea may say.
 *
 * ai_analysis.talking_points      the points to make
 * ai_analysis.talking_points_ai   points the AI wrote that nobody reviewed yet
 * ai_analysis.avoid               things posts must not mention
 * guidelines_approved_at          a person approved them (autopilots can require it)
 *
 * Mirrors supabase/functions/_shared/idea-guidelines.ts. Keep the number check in sync.
 */

export interface IdeaGuidelines {
  points: string[];
  /** Points nobody has reviewed yet (AI drafts). */
  drafts: string[];
  avoid: string[];
}

export function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : v && typeof v === "object" && "text" in v ? String((v as { text: unknown }).text) : ""))
    .map((v) => v.trim())
    .filter(Boolean);
}

export type IdeaAnalysis = Record<string, unknown>;

export function parseAnalysis(raw: unknown): IdeaAnalysis {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as IdeaAnalysis) : {};
}

/**
 * Approving writes talking_points_ai as [], so an idea without the key predates
 * guidelines: all its points count as unreviewed drafts.
 */
export function readGuidelines(analysis: IdeaAnalysis): IdeaGuidelines {
  // Keep empty rows while someone is typing; the writer only ever gets cleanList().
  const points: string[] = Array.isArray(analysis.talking_points)
    ? analysis.talking_points.map((p: unknown) => (typeof p === "string" ? p : String((p as { text?: unknown } | null)?.text ?? "")))
    : [];
  const ai = analysis.talking_points_ai;
  const draftSet = new Set(Array.isArray(ai) ? cleanList(ai) : cleanList(points));
  return {
    points,
    drafts: points.map((p) => p.trim()).filter((p) => p && draftSet.has(p)),
    avoid: cleanList(analysis.avoid),
  };
}

// ---------------------------------------------------------------------------
// Text the writer gets (same wording as the server)
// ---------------------------------------------------------------------------

/** Every fact the writer uses must come from what the prompt gives it. */
const FACTS_RULE =
  "Only state facts, numbers, names, news or results that this prompt gives you (the points, notes, sources, product or brand details). If a detail isn't there, leave it out instead of guessing.";

/** "Don't mention" plus the facts rule, for prompts that already list the points (or shouldn't). */
export function guardrailsText(avoid: string[]): string {
  const lines: string[] = [];
  if (avoid.length) lines.push(`Don't mention: ${avoid.join("; ")}.`);
  lines.push(FACTS_RULE);
  return lines.join("\n");
}

export function guidelinesText(points: string[], avoid: string[]): string {
  if (points.length === 0 && avoid.length === 0) return "";
  const parts: string[] = [];
  if (points.length) {
    parts.push(`Points to make (cover each one, in your own words):\n${points.map((p) => `• ${p}`).join("\n")}`);
  }
  parts.push(guardrailsText(avoid));
  return parts.join("\n");
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
  const n = num.replace(/,/g, "");
  const s = suffix.trim().toLowerCase();
  const mult = s === "k" ? 1e3 : s === "m" ? 1e6 : s === "b" ? 1e9 : 1;
  if (mult === 1) return n;
  const v = parseFloat(n) * mult;
  return Number.isFinite(v) ? String(v) : n;
}

function scanNumbers(text: string): NumberMatch[] {
  const out: NumberMatch[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const idx = m.index ?? 0;
    const before = idx > 0 ? text[idx - 1] : "";
    const after = text[idx + m[0].length] || "";
    // Part of a word or version ("B2B", "GPT4", "v2", "Q3"), or "24/7": not a claim.
    if (/[\p{L}\d_./]/u.test(before) && !m[1]) continue;
    if (after === "/") continue;
    const currency = m[1] || "";
    const num = m[2];
    const suffix = m[3] || "";
    const value = parseFloat(num.replace(/,/g, ""));
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

/** Everything a point's facts may come from: the topic, the notes, the links and the product. */
export function guidelineSources(parts: Array<string | null | undefined | Record<string, unknown>>): string {
  return parts
    .map((p) => (p == null ? "" : typeof p === "string" ? p : JSON.stringify(p)))
    .filter(Boolean)
    .join("\n");
}
