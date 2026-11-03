/**
 * Reusable spring-based animation progress hook.
 *
 * Returns 0→1 with spring physics. The fundamental building block
 * for all element animations — replaces inline spring() calls.
 */

import { useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { SPRING_PRESETS, type SpringPreset } from './easing';
import type { SpringConfig } from 'remotion';

interface UseAnimationProgressOptions {
  /** Delay in frames before animation starts. */
  delay?: number;
  /** Named spring preset. Default: 'smooth'. */
  preset?: SpringPreset;
  /** Custom spring config (overrides preset). */
  config?: SpringConfig;
}

/**
 * Returns a 0→1 spring-eased progress value.
 *
 * @example
 * const progress = useAnimationProgress({ delay: 10, preset: 'bouncy' });
 * // Use progress for opacity, scale, translateY, etc.
 */
export function useAnimationProgress(options: UseAnimationProgressOptions = {}): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { delay = 0, preset = 'smooth', config } = options;

  return spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: config ?? SPRING_PRESETS[preset],
  });
}
