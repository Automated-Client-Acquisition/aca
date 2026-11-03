/**
 * ExclamationMarks — Three "!" characters side by side with staggered bounce.
 *
 * Loops on a 1-second cycle: each character bounces up/down with spring-based
 * timing, staggered by ~5 frames. Uses brand.accent_color or fallback red.
 */

import React from 'react';
import { spring, interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types';

const MARK_COUNT = 3;
const STAGGER_FRAMES = 5;

export const ExclamationMarks: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
}) => {
  const color = brand.accent_color || '#EF4444';
  const cycleLength = fps; // 1-second loop

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: 4,
        width: 80,
        height: 56,
      }}
    >
      {Array.from({ length: MARK_COUNT }).map((_, i) => {
        const staggeredFrame = Math.max(0, (frame % cycleLength) - i * STAGGER_FRAMES);

        // Spring for upward bounce in first half of cycle
        const halfCycle = Math.round(cycleLength / 2);
        const bounceSpring = spring({
          frame: staggeredFrame,
          fps,
          config: {
            damping: 7,
            stiffness: 150,
            mass: 0.4,
          },
          durationInFrames: halfCycle,
        });

        // Bounce up then return: 0 -> -14px -> 0
        const loopFrame = frame % cycleLength;
        const adjustedLoop = Math.max(0, loopFrame - i * STAGGER_FRAMES);
        const translateY =
          adjustedLoop < halfCycle
            ? bounceSpring * -14
            : interpolate(
                adjustedLoop,
                [halfCycle, cycleLength - i * STAGGER_FRAMES],
                [-14, 0],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
              );

        // Slight vertical offset per character for visual variety
        const baseOffset = [0, -3, 1][i];

        return (
          <span
            key={i}
            style={{
              fontSize: 40,
              fontWeight: 900,
              lineHeight: 1,
              color,
              transform: `translateY(${translateY + baseOffset}px)`,
              userSelect: 'none',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            !
          </span>
        );
      })}
    </div>
  );
};
