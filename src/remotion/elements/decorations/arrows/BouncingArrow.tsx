/**
 * BouncingArrow — A downward arrow that bounces continuously.
 *
 * Loops on a 1-second cycle using spring-based translateY oscillation.
 * Uses brand.accent_color for theming. Base size ~48px.
 */

import React from 'react';
import { spring, interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types';

export const BouncingArrow: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
}) => {
  const cycleLength = fps; // 1 second
  const loopFrame = frame % cycleLength;

  // Spring drives the first half (bounce down), then we reverse it
  const springProgress = spring({
    frame: loopFrame,
    fps,
    config: {
      damping: 8,
      stiffness: 120,
      mass: 0.5,
    },
    durationInFrames: Math.round(cycleLength / 2),
  });

  // Map spring 0->1 to a down-and-back bounce: 0 -> 12px -> 0
  const translateY = interpolate(
    loopFrame,
    [0, cycleLength / 2, cycleLength],
    [0, 12, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Use spring for the first half, linear fallback for the second
  const smoothY = loopFrame < cycleLength / 2
    ? springProgress * 12
    : interpolate(loopFrame, [cycleLength / 2, cycleLength], [12, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });

  const color = brand.accent_color;

  return (
    <div
      style={{
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `translateY(${smoothY}px)`,
      }}
    >
      <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
        {/* Arrow shaft */}
        <line
          x1={24}
          y1={8}
          x2={24}
          y2={36}
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
        />
        {/* Arrow head */}
        <polyline
          points="14,28 24,38 34,28"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
};
