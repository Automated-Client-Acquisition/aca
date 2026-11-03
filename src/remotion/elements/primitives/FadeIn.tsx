/**
 * FadeIn — opacity entrance animation wrapper.
 *
 * Wraps children in a spring-eased opacity transition.
 */

import React from 'react';
import { useAnimationProgress } from './useAnimationProgress';
import type { SpringPreset } from './easing';

interface FadeInProps {
  children: React.ReactNode;
  /** Delay in frames before fade starts. */
  delay?: number;
  /** Spring preset. Default: 'smooth'. */
  preset?: SpringPreset;
  /** Pass-through styles on the wrapper div. */
  style?: React.CSSProperties;
}

export const FadeIn: React.FC<FadeInProps> = ({
  children,
  delay = 0,
  preset = 'smooth',
  style,
}) => {
  const progress = useAnimationProgress({ delay, preset });

  return (
    <div style={{ ...style, opacity: progress }}>
      {children}
    </div>
  );
};
