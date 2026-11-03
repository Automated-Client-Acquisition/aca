/**
 * Editor-side spam check for sequence emails.
 *
 * Scores with the exact same heuristic the send path uses to block risky
 * content (supabase/functions/_shared/content-scorer.ts), imported directly
 * rather than copied so the number the author sees can't drift from the gate.
 * That file is dependency-free TS — keep it that way, or this import breaks
 * the Vite build.
 *
 * Spintax-aware: a recipient gets ONE resolved variation, so we score the
 * variations themselves (all of them when there are few, otherwise a sample
 * that covers every option) and report the worst, rather than scoring the raw
 * template or a mash of every branch.
 */
import {
  scoreContent,
  DEFAULT_BLOCK_THRESHOLD,
  type ContentScoreResult,
  type ContentScoreWarning,
} from "../../supabase/functions/_shared/content-scorer";
import { previewMessage } from "@/lib/message-variables";
import {
  EMAIL_VARIABLES,
  EMAIL_MAILBOX_VARIABLES,
  EMAIL_COMPLIANCE_VARIABLES,
  EMAIL_DELIVERABLE_VARIABLES,
} from "@/lib/email-sequence-utils";

export { DEFAULT_BLOCK_THRESHOLD };
export type { ContentScoreResult, ContentScoreWarning };

/** Same group pattern resolveSpintax() uses at send time: flat `{a|b|c}`. */
const SPINTAX_GROUP_RE = /\{([^{}]*\|[^{}]*)\}/g;
/** Enumerate every variation up to this many; sample beyond it. */
const MAX_VARIATIONS = 64;

// Email-only variables previewMessage() has no sample for. They resolve at
// send time, so leaving them raw would trip the scorer's "unresolved merge
// var" check on every template. Link-valued ones become a URL so the link
// count matches what actually ships — {{unsubscribe_link}} included, since
// filters see it as a link like any other.
const LINK_VARIABLES = new Set(["{{unsubscribe_link}}", "{{notion_preview_url}}"]);
const SEND_TIME_VARIABLES = new Set<string>(
  [
    ...EMAIL_VARIABLES,
    ...EMAIL_MAILBOX_VARIABLES,
    ...EMAIL_COMPLIANCE_VARIABLES,
    ...EMAIL_DELIVERABLE_VARIABLES,
  ].map((v) => v.variable),
);

function fillSendTimeVariables(text: string): string {
  return text.replace(/\{\{[^{}]+\}\}/g, (token) => {
    if (LINK_VARIABLES.has(token)) return "https://example.com/link";
    if (token === "{{signature}}") return "";
    if (SEND_TIME_VARIABLES.has(token) || token.startsWith("{{custom_")) return "sample";
    return token; // unknown variable (typo?) stays raw and gets flagged
  });
}

/**
 * Fill variables but leave spintax unresolved, mirroring send-time order
 * (variables first, then spintax — so `{Hi {{first_name}}|Hey}` works).
 * previewMessage() resolves spintax randomly at the end; hiding `|` makes
 * that a no-op so we can enumerate the groups ourselves.
 */
const PIPE_SENTINEL = "";
function fillVariablesKeepSpintax(text: string): string {
  const hidden = (text || "").split("|").join(PIPE_SENTINEL);
  return fillSendTimeVariables(previewMessage(hidden)).split(PIPE_SENTINEL).join("|");
}

function spintaxGroups(text: string): string[][] {
  return Array.from(text.matchAll(SPINTAX_GROUP_RE), (m) => m[1].split("|"));
}

/** Resolve groups in order using `choices`, starting at `offset`. */
function renderVariation(text: string, choices: number[], offset: number): string {
  let i = offset;
  return text.replace(SPINTAX_GROUP_RE, (_, group: string) => group.split("|")[choices[i++]]);
}

/** Deterministic PRNG so the sample (and the score) is stable per keystroke. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickVariations(sizes: number[]): number[][] {
  const total = sizes.reduce((n, s) => n * s, 1);
  if (total <= MAX_VARIATIONS) {
    // Mixed-radix enumeration of every combination.
    return Array.from({ length: total }, (_, k) =>
      sizes.map((s, g) => {
        const div = sizes.slice(g + 1).reduce((n, x) => n * x, 1);
        return Math.floor(k / div) % s;
      }),
    );
  }
  // Too many to enumerate: first make sure every option of every group is
  // rendered at least once, then top up with seeded random combinations.
  const seen = new Set<string>();
  const out: number[][] = [];
  const add = (c: number[]) => {
    const key = c.join(",");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };
  const maxOptions = Math.max(...sizes);
  for (let k = 0; k < maxOptions; k++) add(sizes.map((s) => k % s));
  const rand = mulberry32(sizes.length * 7919 + total);
  for (let tries = 0; out.length < MAX_VARIATIONS && tries < MAX_VARIATIONS * 4; tries++) {
    add(sizes.map((s) => Math.floor(rand() * s)));
  }
  return out;
}

/**
 * Braces left after resolution ship literally — nested groups (`{a|{b|c}}`
 * only resolves the inner one) or a missing `}`. Ignores `{{variable}}`
 * tokens, which the scorer already flags on its own.
 */
function hasLiteralBraces(text: string): boolean {
  return /[{}]/.test(text.replace(/\{\{[^{}]+\}\}/g, ""));
}

export interface TriggerHit {
  phrase: string;
  /** How many of the checked variations contain it. */
  variations: number;
}

export interface SequenceEmailSpamCheckResult {
  /** The worst-scoring variation — what the headline number reflects. */
  worst: ContentScoreResult;
  bestScore: number;
  /** Number of spintax groups across subject + body. */
  spintaxGroups: number;
  /** Total distinct variations the template can produce. */
  totalVariations: number;
  /** How many of them were actually scored. */
  checkedVariations: number;
  /** Every trigger phrase found in any variation, deduped ("click" inside "click here"). */
  triggers: TriggerHit[];
}

export interface SequenceEmailSpamCheckInput {
  subject: string;
  body: string;
  bodyFormat?: "html" | "text";
  /** Opener emails are held to a stricter link/image policy. */
  isFirstStep: boolean;
}

export function checkSequenceEmailSpam(
  input: SequenceEmailSpamCheckInput,
): SequenceEmailSpamCheckResult {
  const subjectTpl = fillVariablesKeepSpintax(input.subject);
  const bodyTpl = fillVariablesKeepSpintax(input.body);
  const subjectGroups = spintaxGroups(subjectTpl);
  const sizes = [...subjectGroups, ...spintaxGroups(bodyTpl)].map((g) => g.length);
  const totalVariations = sizes.reduce((n, s) => n * s, 1);

  const results = pickVariations(sizes).map((choices) => {
    const subject = renderVariation(subjectTpl, choices, 0);
    const body = renderVariation(bodyTpl, choices, subjectGroups.length);
    const r = scoreContent({
      subject,
      body,
      isHtml: input.bodyFormat === "html",
      isFirstStep: input.isFirstStep,
    });
    if (hasLiteralBraces(subject) || hasLiteralBraces(body)) {
      const delta = 30;
      r.warnings.push({
        code: "spintax_literal_braces",
        message:
          "Spintax won't resolve — nested {a|{b|c}} groups or a missing brace will send literal { } to the lead.",
        severity: "critical",
        delta,
      });
      r.score = Math.max(0, r.score - delta);
    }
    return r;
  });

  const worst = results.reduce((a, b) => (b.score < a.score ? b : a));
  const bestScore = Math.max(...results.map((r) => r.score));

  const counts = new Map<string, number>();
  for (const r of results) {
    for (const t of r.metrics.spam_triggers) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const phrases = [...counts.keys()];
  const triggers = phrases
    .filter((t) => !phrases.some((other) => other !== t && other.includes(t)))
    .map((phrase) => ({ phrase, variations: counts.get(phrase)! }))
    .sort((a, b) => b.variations - a.variations);

  return {
    worst,
    bestScore,
    spintaxGroups: sizes.length,
    totalVariations,
    checkedVariations: results.length,
    triggers,
  };
}
