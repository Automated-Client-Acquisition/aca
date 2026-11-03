/**
 * TransitionEffect — Transition presentation factory for TransitionSeries.
 *
 * Maps transition names to Remotion transition presentations.
 * This is a convenience wrapper used by compositions to insert
 * TransitionSeries.Transition elements.
 *
 * Pure React — no Node.js-specific code.
 */

import React from 'react';
import { linearTiming } from '@remotion/transitions';
import { TransitionSeries } from '@remotion/transitions';
import {
  getTransitionPresentation,
  getDefaultTransitionDuration,
} from '../animations/transitions.js';
import type { TransitionType } from '../types.js';

interface TransitionEffectProps {
  type: TransitionType;
  durationInFrames?: number;
}

/**
 * Renders a TransitionSeries.Transition element with the correct
 * presentation and timing for the given transition type.
 *
 * Returns null for 'cut_hard' (no transition needed).
 *
 * Usage:
 * ```tsx
 * <TransitionSeries>
 *   <TransitionSeries.Sequence durationInFrames={90}>
 *     <SceneA />
 *   </TransitionSeries.Sequence>
 *   <TransitionEffect type="crossfade" durationInFrames={10} />
 *   <TransitionSeries.Sequence durationInFrames={90}>
 *     <SceneB />
 *   </TransitionSeries.Sequence>
 * </TransitionSeries>
 * ```
 *
 * Note: This component must be used as a direct child of TransitionSeries.
 */
export const TransitionEffect: React.FC<TransitionEffectProps> = ({
  type,
  durationInFrames,
}) => {
  const presentation = getTransitionPresentation(type);

  if (!presentation) {
    // 'cut_hard' — no transition element needed
    return null;
  }

  const duration = durationInFrames ?? getDefaultTransitionDuration(type);

  return (
    <TransitionSeries.Transition
      presentation={presentation}
      timing={linearTiming({ durationInFrames: duration })}
    />
  );
};

/**
 * Helper function to create transition props for use in map() iterations.
 * Returns the props needed for a TransitionSeries.Transition, or null
 * if the transition type doesn't require a visual transition.
 */
export function createTransitionProps(
  type: TransitionType,
  durationInFrames?: number,
): {
  presentation: ReturnType<typeof getTransitionPresentation>;
  timing: ReturnType<typeof linearTiming>;
} | null {
  const presentation = getTransitionPresentation(type);
  if (!presentation) return null;

  const duration = durationInFrames ?? getDefaultTransitionDuration(type);

  return {
    presentation,
    timing: linearTiming({ durationInFrames: duration }),
  };
}
