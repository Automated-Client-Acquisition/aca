/**
 * Taking turns without randomness: the item unused the longest. Never-used
 * items come first, in list order; then the one whose last use is furthest
 * back. `recentKeys` is the key of each recent use, most recent first; keys
 * not in `items` (deleted looks, removed photos) are ignored.
 *
 * Used by Looks (image-looks.ts) and rotating reference photos
 * (image-references.ts). A random pick repeats: the trap the idea pool fell into.
 */
export function leastRecent<T>(items: T[], keyOf: (item: T) => string, recentKeys: string[]): T {
  let best = items[0];
  let bestAge = -1;
  for (const item of items) {
    const at = recentKeys.indexOf(keyOf(item));
    const age = at === -1 ? Number.POSITIVE_INFINITY : at;
    if (age > bestAge) {
      best = item;
      bestAge = age;
    }
  }
  return best;
}
