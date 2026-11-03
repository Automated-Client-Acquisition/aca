/**
 * Frontend mirror of supabase/functions/_shared/content-mix.ts (rankMixEntries),
 * so the Autopilots screens can show which blueprint each coming slot gets.
 * Keep the two in sync.
 */

export interface MixEntry {
  blueprint_id: string;
  weight: number;
  enabled: boolean;
}

export const MIX_HISTORY_WINDOW = 20;

/** Every enabled entry, best first (deterministic: entries sharing a blueprint keep mix order). */
export function rankMixEntries<T extends MixEntry>(contentMix: T[], recentBlueprintIds: string[] = []): T[] {
  const enabled = (contentMix ?? []).filter((m) => m?.enabled && m.blueprint_id);
  if (enabled.length === 0) return [];

  const allZero = enabled.every((m) => !(m.weight > 0));
  const weightOf = (m: T) => (allZero ? 1 : Math.max(0, m.weight || 0));

  const byBlueprint = new Map<string, number>();
  for (const m of enabled) byBlueprint.set(m.blueprint_id, (byBlueprint.get(m.blueprint_id) ?? 0) + weightOf(m));
  const total = [...byBlueprint.values()].reduce((a, b) => a + b, 0);
  const candidates = [...byBlueprint.keys()].filter((id) => (byBlueprint.get(id) ?? 0) > 0);
  if (total <= 0 || candidates.length === 0) return [enabled[0]];

  const recent = recentBlueprintIds.slice(0, MIX_HISTORY_WINDOW).filter((id) => byBlueprint.has(id));
  const n = recent.length;
  const deficit = (id: string) => ((byBlueprint.get(id) ?? 0) / total) * (n + 1) - recent.filter((r) => r === id).length;
  const age = (id: string) => {
    const at = recent.indexOf(id);
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };
  const order = [...candidates].sort((a, b) => {
    const d = deficit(b) - deficit(a);
    if (Math.abs(d) > 1e-9) return d;
    if (age(a) !== age(b)) return age(b) > age(a) ? 1 : -1;
    return candidates.indexOf(a) - candidates.indexOf(b);
  });

  const ranked: T[] = [];
  for (const id of order) ranked.push(...enabled.filter((m) => m.blueprint_id === id && weightOf(m) > 0));
  return ranked;
}

/**
 * Which blueprint each slot gets, in order: a pinned slot takes its blueprint
 * (when it's still in the mix), the rest take turns by share. Assumes every
 * blueprint has ideas left; the scheduler hands a starved one's turn on.
 */
export function predictBlueprints<T extends MixEntry>(
  contentMix: T[],
  slots: Array<{ blueprint_id: string | null }>,
  recentRotation: string[] = [],
): Array<{ blueprint_id: string | null; pinned: boolean }> {
  const history = [...recentRotation];
  const inMix = new Set((contentMix ?? []).filter((m) => m?.enabled).map((m) => m.blueprint_id));
  return slots.map((slot) => {
    if (slot.blueprint_id && inMix.has(slot.blueprint_id)) return { blueprint_id: slot.blueprint_id, pinned: true };
    const next = rankMixEntries(contentMix, history)[0]?.blueprint_id ?? null;
    if (next) history.unshift(next);
    return { blueprint_id: next, pinned: false };
  });
}
