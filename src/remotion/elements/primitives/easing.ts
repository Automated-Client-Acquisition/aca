/**
 * Named spring presets for consistent animation feel across elements.
 *
 * Codifies the scattered spring configs used in TextCard, StatCard,
 * GradientTitle, ListReveal, QuoteCard into a shared vocabulary.
 */

import type { SpringConfig } from 'remotion';

export const SPRING_PRESETS = {
  /** Smooth entrance — text reveals, general purpose. (TextCard-like) */
  smooth: { damping: 20, stiffness: 100, mass: 0.8 } satisfies SpringConfig,
  /** Snappy, responsive — UI elements, checkmarks. (ListReveal check) */
  snappy: { damping: 15, stiffness: 200, mass: 0.6 } satisfies SpringConfig,
  /** Bouncy overshoot — emphasis, pop effects. */
  bouncy: { damping: 10, stiffness: 150, mass: 0.5 } satisfies SpringConfig,
  /** Gentle reveal — backgrounds, overlays, counters. (StatCard counter) */
  gentle: { damping: 30, stiffness: 80, mass: 1.0 } satisfies SpringConfig,
  /** Heavy, cinematic — titles, hero text. (GradientTitle-like) */
  heavy: { damping: 18, stiffness: 100, mass: 1.2 } satisfies SpringConfig,
} as const;

export type SpringPreset = keyof typeof SPRING_PRESETS;
