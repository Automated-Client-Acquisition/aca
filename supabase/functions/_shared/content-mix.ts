/**
 * Which content-mix entry an autopilot runs next.
 *
 * It used to be a weighted random draw, so a 50/50 mix could run the same
 * blueprint several times in a row. Now: the blueprint furthest below its
 * share of the recent runs goes next (ties: the one unused the longest, then
 * mix order). Over a window the mix converges on the weights; back-to-back
 * repeats only happen when the weights call for them.
 *
 * A run that finds no idea creates no job, so the history doesn't move: with
 * per-blueprint idea tags, callers must fall through to the next ranked entry
 * or they'd retry the same starved blueprint forever.
 */
export interface MixEntry {
  blueprint_id: string;
  weight: number;
  enabled: boolean;
}

export const MIX_HISTORY_WINDOW = 20;

/**
 * Auto-reload only brings back ideas last picked longer ago than this (a
 * Postgres interval for recycle_autopilot_pool's p_min_idle). With one approved
 * idea in a pool, recycling without it posted that idea every run. When
 * nothing has cooled down the run is skipped and logged as no_ideas_available.
 * The editor's recycle checkbox states the same number.
 */
export const IDEA_REPEAT_COOLDOWN = '14 days';

/**
 * Every enabled entry, best first: blueprints by how far below their share of
 * the recent runs they are (ties: unused the longest, then mix order); entries
 * sharing a blueprint in a weighted-random order. Callers try them in turn
 * when the first can't run (no ideas left for its tags).
 *
 * @param recentBlueprintIds blueprints of this autopilot's recent runs, most recent first
 * @param random injectable for tests; only used between entries that share a blueprint
 */
export function rankMixEntries<T extends MixEntry>(
  contentMix: T[],
  recentBlueprintIds: string[] = [],
  random: () => number = Math.random,
): T[] {
  const enabled = (contentMix ?? []).filter((m) => m?.enabled && m.blueprint_id);
  if (enabled.length === 0) return [];

  const allZero = enabled.every((m) => !(m.weight > 0));
  const weightOf = (m: T) => (allZero ? 1 : Math.max(0, m.weight || 0));

  // Weight per blueprint (the same blueprint can appear twice, e.g. with other idea tags).
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
  for (const id of order) {
    const pool = enabled.filter((m) => m.blueprint_id === id && weightOf(m) > 0);
    while (pool.length > 0) {
      const sum = pool.reduce((a, m) => a + weightOf(m), 0);
      let r = random() * sum;
      let at = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        r -= weightOf(pool[i]);
        if (r <= 0) {
          at = i;
          break;
        }
      }
      ranked.push(pool.splice(at, 1)[0]);
    }
  }
  return ranked;
}

/** The entry an autopilot runs next (the first of rankMixEntries). */
export function pickMixEntry<T extends MixEntry>(
  contentMix: T[],
  recentBlueprintIds: string[] = [],
  random: () => number = Math.random,
): T | null {
  return rankMixEntries(contentMix, recentBlueprintIds, random)[0] ?? null;
}
