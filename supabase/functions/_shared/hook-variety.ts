/**
 * Hooks that don't open like the account's last posts.
 *
 * Blueprints often use the idea's hook word for word as the first line, and
 * an autopilot recycles the same ideas, each with the few hooks written for it
 * once. Autopilot 3811e5d7's feed opened "I built X in Hermes Agent..." on 16
 * posts in a row. The caption writer can't change a verbatim hook, so the
 * variety has to happen when the autopilot picks one:
 *   1. skip stored hooks that open like the recent posts;
 *   2. if every stored hook does, write a fresh one that doesn't.
 * Any failure keeps the hook the rotation picked.
 */
import { decryptApiKey, isAlibabaModel, isOllamaModel, isOpencodeModel, llmChatCompletion } from './llm-client.ts';
import { resolveApiKey } from './resolve-api-key.ts';
import { DEFAULT_FREE_TEXT_MODEL } from './default-models.ts';
import { normalizeDashes } from './sanitize-ai-output.ts';
import { loadRecentOpenings } from './recent-pieces.ts';

export interface HookLike {
  text: string;
  type?: string;
  [key: string]: unknown;
}

/** At most this many of the recent openings may start with the hook's first word. */
const SAME_FIRST_WORD_LIMIT = 2;
const WRITER_TIMEOUT_MS = 20_000;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\-]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

/** The first two words, the part of an opening readers notice repeating. */
export function openerKey(text: string): string {
  return words(text).slice(0, 2).join(' ');
}

/**
 * Does this hook open like the recent posts? Same first two words as one of
 * them, or a first word that already starts SAME_FIRST_WORD_LIMIT of them.
 */
export function opensLikeRecent(hook: string, recentOpenings: string[]): boolean {
  const w = words(hook);
  if (w.length === 0 || recentOpenings.length === 0) return false;
  const key = w.slice(0, 2).join(' ');
  if (w.length >= 2 && recentOpenings.some((o) => openerKey(o) === key)) return true;
  const sameFirst = recentOpenings.filter((o) => words(o)[0] === w[0]).length;
  return sameFirst >= SAME_FIRST_WORD_LIMIT;
}

/** The first stored hook, from the rotation cursor on, that doesn't open like the recent posts. */
export function pickStoredHook<T extends HookLike>(hooks: T[], startIndex: number, recentOpenings: string[]): { hook: T; index: number } | null {
  for (let i = 0; i < hooks.length; i++) {
    const index = (startIndex + i) % hooks.length;
    const hook = hooks[index];
    if (hook?.text && !opensLikeRecent(hook.text, recentOpenings)) return { hook, index };
  }
  return null;
}

/** Does the prompt put the hook in the post? ({{ai_hook}}, {{hook}}, sections included) */
export function promptUsesHook(prompt: string | null | undefined): boolean {
  return /\{\{\s*[#^]?\s*(ai_hook|hook)\s*\}\}/.test(prompt ?? '');
}

export function freshHookPrompt(topic: string, facts: string[], storedHooks: string[], recentOpenings: string[], rejected?: string): string {
  const list = (items: string[]) => items.map((s) => `- ${s}`).join('\n');
  return `Write the opening line (the hook) of a social media post. It is used word for word as the post's first line.

Topic: ${topic}
${facts.length ? `\nFacts you can use (invent no other numbers, names or claims):\n${list(facts)}\n` : ''}
Hooks already written for this topic. Keep their voice, their claims and their emoji habits, but not their opening:
${list(storedHooks)}

This account's last posts opened like this:
${list(recentOpenings)}

Write ONE new hook that opens in a clearly different way from every line above: different first words and a different sentence shape. For example: a blunt observation about the reader's world, a surprising number from the facts, a question, a short contrarian claim, or the result before the method.${rejected ? `\nYour last attempt started "${openerKey(rejected)}", like the posts above. Start differently.` : ''}
Under 35 words. No hashtags, no quotes, no em dashes.
Output only the hook.`;
}

/** The hook alone: first non-empty line, without quotes or a "Hook:" label. */
export function cleanHook(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';
  return normalizeDashes(
    line
      .replace(/^\**\s*hook\s*\**\s*:\s*\**\s*/i, '')
      .replace(/\*\*/g, '')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .trim(),
  );
}

async function writeFreshHook(opts: {
  supabase: any;
  organizationId: string;
  model: string;
  topic: string;
  facts: string[];
  storedHooks: string[];
  recentOpenings: string[];
}): Promise<string | null> {
  const ownServer = isOllamaModel(opts.model) || isAlibabaModel(opts.model) || isOpencodeModel(opts.model);
  let openRouterApiKey: string | undefined;
  if (!ownServer) {
    const key = await resolveApiKey(opts.supabase, opts.organizationId, 'openrouter');
    if (!key) return null;
    openRouterApiKey = await decryptApiKey(key.key_encrypted);
  }

  let rejected: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await llmChatCompletion({
      model: opts.model,
      messages: [{ role: 'user', content: freshHookPrompt(opts.topic, opts.facts, opts.storedHooks, opts.recentOpenings, rejected) }],
      temperature: 0.9,
      // Reasoning models spend tokens before answering; a small cap returns nothing.
      max_tokens: 1500,
      openRouterApiKey,
      supabase: opts.supabase,
      organizationId: opts.organizationId,
      timeoutMs: WRITER_TIMEOUT_MS,
    });
    const hook = cleanHook(result.content ?? '');
    if (hook && !opensLikeRecent(hook, opts.recentOpenings)) return hook;
    rejected = hook || undefined;
  }
  return null;
}

export type HookSource = 'rotation' | 'stored_alternate' | 'fresh';

/**
 * The hook an autopilot run should use: the rotation's pick unless it opens
 * like the account's recent posts (only when the blueprint puts the hook in
 * the post). Never throws.
 */
export async function varyHook<T extends HookLike>(opts: {
  supabase: any;
  autopilotId: string;
  organizationId: string;
  blueprint: { master_prompt?: string | null; model_config?: any };
  hooks: T[];
  selected: T | null;
  selectedIndex: number;
  idea: { title: string; ai_analysis?: any };
}): Promise<{ hook: T | null; source: HookSource; recentOpenings: number }> {
  const keep = { hook: opts.selected, source: 'rotation' as HookSource, recentOpenings: 0 };
  try {
    if (!opts.selected?.text || !promptUsesHook(opts.blueprint.master_prompt)) return keep;
    const recentOpenings = await loadRecentOpenings(opts.supabase, opts.autopilotId);
    if (!opensLikeRecent(opts.selected.text, recentOpenings)) return { ...keep, recentOpenings: recentOpenings.length };

    const stored = pickStoredHook(opts.hooks, opts.selectedIndex, recentOpenings);
    if (stored) {
      console.log(`🪝 [Hook variety] Stored hook ${stored.index + 1} instead: "${stored.hook.text.slice(0, 60)}"`);
      return { hook: stored.hook, source: 'stored_alternate', recentOpenings: recentOpenings.length };
    }

    const facts = Array.isArray(opts.idea.ai_analysis?.talking_points)
      ? (opts.idea.ai_analysis.talking_points as unknown[]).filter((p): p is string => typeof p === 'string').slice(0, 5)
      : [];
    const fresh = await writeFreshHook({
      supabase: opts.supabase,
      organizationId: opts.organizationId,
      model: opts.blueprint.model_config?.text_llm?.model_id || DEFAULT_FREE_TEXT_MODEL,
      topic: opts.idea.title,
      facts,
      storedHooks: opts.hooks.map((h) => h.text).filter(Boolean).slice(0, 8),
      recentOpenings,
    });
    if (!fresh) {
      console.warn('🪝 [Hook variety] No usable fresh hook; keeping the rotation pick');
      return { ...keep, recentOpenings: recentOpenings.length };
    }
    console.log(`🪝 [Hook variety] Fresh hook: "${fresh.slice(0, 80)}"`);
    return { hook: { ...opts.selected, text: fresh, type: 'fresh' }, source: 'fresh', recentOpenings: recentOpenings.length };
  } catch (e) {
    console.warn('🪝 [Hook variety] Failed; keeping the rotation pick:', e instanceof Error ? e.message : e);
    return keep;
  }
}
