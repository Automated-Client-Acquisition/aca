/**
 * Story detection for Signals, from posts by the accounts an org follows.
 *
 *   consensus  a name (not a phrase) that MIN_ACCOUNTS+ followed accounts post about
 *              within 3 hours, at 3x+ its own 72-hour baseline
 *   launch     a launch-worded post from an official account (see LAUNCH_RE); its own
 *              posts only, a repost of someone else's launch counts toward consensus
 *
 * Alerts about the same thing merge into one story: terms nested in each other
 * ("claude opus 5.5" ⊃ "opus"), or at least half of the posts shared. Pure logic,
 * no I/O, so the backtest replays it on saved posts (scratchpad replay.ts).
 */

import { extractTerms } from './pulse-terms.ts';
import { LAUNCH_RE, REPOST_RE } from './pulse-accounts.ts';

export const WINDOW_H = 3;
export const BASELINE_H = 72;
const HOUR = 3_600_000;

// Capitalised words that are never a story on their own. Umbrella names (OpenAI,
// Claude, Gemini) stay: they merge into the specific story or the LLM check drops them.
const NEVER_A_STORY = new Set(
  `ai ceo cto us u.s u.s. uk eu api apis llm llms agi asi saas gpu gpus ipo sota arr mrr plus pro max congrats try give put
  full build available open source frontier frontier labs super intelligence superintelligence san francisco bay area
  china chinese america american trump president trump today tomorrow breaking thread update wow lol omg yes new
  x twitter linkedin youtube github reddit hn tl;dr dm rt`
    .split(/\s+/)
    .filter(Boolean),
);

export interface StoryPost {
  id: number;
  t: number;
  author: string; // lowercase handle
  text: string;
  score: number;
}

export interface Story {
  id?: string;
  key_term: string;
  terms: string[];
  item_ids: number[];
  accounts: string[];
  official_accounts: string[];
  first_post_at: number;
  last_post_at: number;
  detected_at: number;
  peak_accounts: number;
  changed?: boolean;
}

export interface Detector {
  posts: StoryPost[];
  byId: Map<number, StoryPost>;
  /** lowercase term → display casing, for names only */
  display: Record<string, string>;
  /** post id → name terms */
  termsOf: Map<number, string[]>;
  byTerm: Map<string, StoryPost[]>;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nested = (a: string, b: string) => a !== b && new RegExp(`(^|\\s)${escapeRe(b)}(\\s|$)`).test(a);
const isSpecific = (t: string) => /\d/.test(t) || t.includes(' ');

/**
 * Index posts by name term. A term counts as a name everywhere once any post writes
 * it with a capital or a digit ("jev" is mostly written lowercase, "Jev" sometimes).
 */
export function buildDetector(posts: StoryPost[]): Detector {
  const display: Record<string, string> = {};
  const raw = new Map<number, string[]>();
  for (const p of posts) {
    const ex = extractTerms(p.text, new Set(), 40);
    raw.set(p.id, ex.terms);
    for (const k of ex.terms) {
      const d = ex.display[k];
      if (d !== d.toLowerCase() || /\d/.test(k)) {
        if (!display[k] || display[k] === display[k].toLowerCase()) display[k] = d;
      }
    }
  }
  const termsOf = new Map<number, string[]>();
  const byTerm = new Map<string, StoryPost[]>();
  const sorted = [...posts].sort((a, b) => a.t - b.t);
  for (const p of sorted) {
    const names = (raw.get(p.id) || []).filter(
      (k) => display[k] && !NEVER_A_STORY.has(k) && !/^[#$]?\d[\d.,%kmb]*$/i.test(k) && k.length > 1,
    );
    termsOf.set(p.id, names);
    for (const k of names) (byTerm.get(k) || byTerm.set(k, []).get(k)!).push(p);
  }
  return { posts: sorted, byId: new Map(sorted.map((p) => [p.id, p])), display, termsOf, byTerm };
}

interface Candidate {
  term: string;
  accounts: string[];
  ids: number[];
}

/** Terms taking off at time t among the followed accounts (posts after t are ignored). */
export function consensusAt(d: Detector, t: number, minAccounts: number): Candidate[] {
  const out: Candidate[] = [];
  for (const [term, ps] of d.byTerm) {
    if (ps.length < minAccounts) continue;
    const cur = ps.filter((p) => p.t <= t && p.t > t - WINDOW_H * HOUR);
    const accounts = [...new Set(cur.map((p) => p.author))];
    if (accounts.length < minAccounts) continue;
    const prior = ps.filter((p) => p.t <= t - WINDOW_H * HOUR && p.t > t - BASELINE_H * HOUR);
    // account-windows before this one, as an average per 3h window
    const priorRate = new Set(prior.map((p) => `${p.author}:${Math.floor(p.t / HOUR / WINDOW_H)}`)).size / ((BASELINE_H - WINDOW_H) / WINDOW_H);
    if ((accounts.length + 0.5) / (priorRate + 0.5) < 3) continue;
    out.push({ term, accounts, ids: cur.map((p) => p.id) });
  }
  // biggest first, so the umbrella/fragment terms of a story merge into it
  return out.sort((a, b) => b.accounts.length - a.accounts.length || Number(isSpecific(b.term)) - Number(isSpecific(a.term)));
}

function addToStory(s: Story, d: Detector, ids: number[], term: string | null, official: string | null) {
  s.item_ids = [...new Set([...s.item_ids, ...ids])];
  const members = s.item_ids.map((id) => d.byId.get(id)).filter(Boolean) as StoryPost[];
  s.accounts = [...new Set([...s.accounts, ...members.map((p) => p.author)])];
  if (term && !s.terms.includes(term)) s.terms.push(term);
  if (official && !s.official_accounts.includes(official)) s.official_accounts.push(official);
  if (members.length) {
    s.first_post_at = Math.min(s.first_post_at, ...members.map((p) => p.t));
    s.last_post_at = Math.max(s.last_post_at, ...members.map((p) => p.t));
  }
  // key = the name most of its posts carry, specific names first ("claude opus 5.5" over "opus")
  const count = (x: string) => members.filter((p) => d.termsOf.get(p.id)?.includes(x)).length;
  const ranked = [...s.terms].sort((a, b) => Number(isSpecific(b)) - Number(isSpecific(a)) || count(b) - count(a));
  if (ranked.length && count(ranked[0]) > 0) s.key_term = ranked[0];
  s.changed = true;
}

function findStory(stories: Story[], term: string, ids: number[], t: number): Story | undefined {
  // already part of a story from the last 24h: same story, keep growing it
  const own = stories.find((s) => s.terms.includes(term) && s.detected_at > t - 24 * HOUR);
  if (own) return own;
  return stories.find((s) => {
    if (s.detected_at < t - 24 * HOUR) return false;
    const shared = ids.filter((id) => s.item_ids.includes(id)).length;
    if (ids.length && shared / ids.length >= 0.5) return true;
    // nested names only merge around the same moment: "Claude" a day after the Opus launch is its own story
    return Math.abs(s.detected_at - t) <= 6 * HOUR && s.terms.some((x) => nested(x, term) || nested(term, x));
  });
}

/** Run consensus detection at t and fold the alerts into stories (mutates `stories`). */
export function detectConsensus(d: Detector, stories: Story[], t: number, minAccounts: number) {
  for (const c of consensusAt(d, t, minAccounts)) {
    const s = findStory(stories, c.term, c.ids, t);
    if (s) {
      addToStory(s, d, c.ids, c.term, null);
      s.peak_accounts = Math.max(s.peak_accounts, c.accounts.length);
      continue;
    }
    const story: Story = {
      key_term: c.term, terms: [c.term], item_ids: [], accounts: [], official_accounts: [],
      first_post_at: t, last_post_at: 0, detected_at: t, peak_accounts: c.accounts.length,
    };
    addToStory(story, d, c.ids, c.term, null);
    stories.push(story);
  }
}

/** Launch posts from official accounts: attach to a story about the same thing, else start one. */
export function detectLaunches(d: Detector, stories: Story[], candidates: StoryPost[], official: Set<string>) {
  for (const p of candidates) {
    if (!official.has(p.author) || REPOST_RE.test(p.text) || !LAUNCH_RE.test(p.text)) continue;
    if (stories.some((s) => s.item_ids.includes(p.id))) continue;
    const names = d.termsOf.get(p.id) || [];
    const specific = names.filter(isSpecific);
    const s = stories.find(
      (x) => x.detected_at > p.t - 24 * HOUR && x.detected_at < p.t + 24 * HOUR &&
        specific.some((n) => x.terms.includes(n) || x.terms.some((xt) => isSpecific(xt) && (nested(xt, n) || nested(n, xt)))),
    );
    if (s) {
      addToStory(s, d, [p.id], null, p.author);
      continue;
    }
    // key: the most specific name in the post ("claude opus 5.5" over "claude"), else the post itself
    const key = [...specific].sort((a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a)) || b.length - a.length)[0] || names[0] || `post:${p.id}`;
    const story: Story = {
      key_term: key, terms: specific.length ? specific.slice(0, 6) : [key], item_ids: [], accounts: [], official_accounts: [],
      first_post_at: p.t, last_post_at: p.t, detected_at: p.t, peak_accounts: 1,
    };
    addToStory(story, d, [p.id], null, p.author);
    stories.push(story);
  }
}

/** Posts that also carry one of the story's terms after it was detected, so counts keep growing. */
export function refreshStory(d: Detector, s: Story, upTo: number) {
  const ids = new Set(s.item_ids);
  const extra: number[] = [];
  // specific names only: an umbrella that merged in ("claude") would pull in every Claude post
  for (const term of s.terms.filter((x) => x === s.key_term || isSpecific(x))) {
    for (const p of d.byTerm.get(term) || []) {
      if (!ids.has(p.id) && p.t >= s.first_post_at && p.t <= upTo && p.t <= s.detected_at + 24 * HOUR) extra.push(p.id);
    }
  }
  if (extra.length) addToStory(s, d, extra, null, null);
}
