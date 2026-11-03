/**
 * ScaleIn — scale + fade entrance animation wrapper.
 *
 * Scales content up from a configurable initial scale with spring physics.
 * Matches the TextCard entry pattern but as a reusable primitive.
 */

import React from 'react';
import { interpolateStyles, makeTransform, scale, translateY } from '@remotion/animation-utils';
import { useAnimationProgress } from './useAnimationProgress';
import type { SpringPreset } from './easing';

interface ScaleInProps {
  children: React.ReactNode;
  /** Initial scale. Default: 0.7. */
  from?: number;
  /** Optional vertical offset in px. Default: 20. */
  offsetY?: number;
  /** Delay in frames. */
  delay?: number;
  /** Spring preset. Default: 'smooth'. */
  preset?: SpringPreset;
  /** Pass-through styles. */
  style?: React.CSSProperties;
}

export const ScaleIn: React.FC<ScaleInProps> = ({
  children,
  from = 0.7,
  offsetY = 20,
  delay = 0,
  preset = 'smooth',
  style,
}) => {
  const progress = useAnimationProgress({ delay, preset });

  const animatedStyles = interpolateStyles(progress, [0, 1], [
    { opacity: 0, transform: makeTransform([translateY(offsetY), scale(from)]) },
    { opacity: 1, transform: makeTransform([translateY(0), scale(1)]) },
  ]);

  return (
    <div style={{ ...style, ...animatedStyles }}>
      {children}
    </div>
  );
};
