/**
 * Named spring presets for consistent animation feel across elements.
 */

import type { SpringConfig } from 'remotion';

export const SPRING_PRESETS = {
  /** Smooth entrance — text reveals, general purpose. */
  smooth: { damping: 20, stiffness: 100, mass: 0.8, overshootClamping: false } satisfies SpringConfig,
  /** Snappy, responsive — UI elements, checkmarks. */
  snappy: { damping: 15, stiffness: 200, mass: 0.6, overshootClamping: false } satisfies SpringConfig,
  /** Bouncy overshoot — emphasis, pop effects. */
  bouncy: { damping: 10, stiffness: 150, mass: 0.5, overshootClamping: false } satisfies SpringConfig,
  /** Gentle reveal — backgrounds, overlays, counters. */
  gentle: { damping: 30, stiffness: 80, mass: 1.0, overshootClamping: false } satisfies SpringConfig,
  /** Heavy, cinematic — titles, hero text. */
  heavy: { damping: 18, stiffness: 100, mass: 1.2, overshootClamping: false } satisfies SpringConfig,
} as const;

export type SpringPreset = keyof typeof SPRING_PRESETS;
