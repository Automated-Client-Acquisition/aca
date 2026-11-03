/**
 * SlideIn — directional slide + fade entrance animation wrapper.
 *
 * Slides content in from a configurable direction with spring physics.
 */

import React from 'react';
import { interpolate } from 'remotion';
import { interpolateStyles, makeTransform, translateX, translateY } from '@remotion/animation-utils';
import { useAnimationProgress } from './useAnimationProgress';
import type { SpringPreset } from './easing';

type Direction = 'up' | 'down' | 'left' | 'right';

interface SlideInProps {
  children: React.ReactNode;
  /** Slide direction. Default: 'up'. */
  direction?: Direction;
  /** Slide distance in pixels. Default: 30. */
  distance?: number;
  /** Delay in frames. */
  delay?: number;
  /** Spring preset. Default: 'smooth'. */
  preset?: SpringPreset;
  /** Pass-through styles. */
  style?: React.CSSProperties;
}

function getTranslate(direction: Direction, distance: number) {
  switch (direction) {
    case 'up': return translateY(distance);
    case 'down': return translateY(-distance);
    case 'left': return translateX(distance);
    case 'right': return translateX(-distance);
  }
}

export const SlideIn: React.FC<SlideInProps> = ({
  children,
  direction = 'up',
  distance = 30,
  delay = 0,
  preset = 'smooth',
  style,
}) => {
  const progress = useAnimationProgress({ delay, preset });

  const animatedStyles = interpolateStyles(progress, [0, 1], [
    { opacity: 0, transform: makeTransform([getTranslate(direction, distance)]) },
    { opacity: 1, transform: makeTransform([getTranslate(direction, 0)]) },
  ]);

  return (
    <div style={{ ...style, ...animatedStyles }}>
      {children}
    </div>
  );
};
