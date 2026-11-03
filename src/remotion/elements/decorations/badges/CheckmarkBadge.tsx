/**
 * CheckmarkBadge — Circle draws on first, then checkmark draws inside.
 *
 * Non-looping: circle draws frames 0-15, checkmark draws frames 15-25.
 * Green (#22C55E) circle and checkmark stroke.
 * Uses interpolate with clamp extrapolation for each phase.
 */

import React from 'react';
import { interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types';

const SIZE = 56;
const CENTER = SIZE / 2;
const RADIUS = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Checkmark path length (approximate for the specific path below)
const CHECKMARK_LENGTH = 32;

export const CheckmarkBadge: React.FC<DecorationComponentProps> = ({
  frame,
}) => {
  // ── Phase 1: Circle draw-on, frames 0-15 ──
  const circleProgress = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const circleDashOffset = CIRCUMFERENCE * (1 - circleProgress);

  // ── Phase 2: Checkmark draw-on, frames 15-25 ──
  const checkProgress = interpolate(frame, [15, 25], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const checkDashOffset = CHECKMARK_LENGTH * (1 - checkProgress);

  // ── Overall opacity: fade in at start ──
  const opacity = interpolate(frame, [0, 3], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        opacity,
      }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Circle */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="#22C55E"
          strokeWidth={3}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={circleDashOffset}
          strokeLinecap="round"
          transform={`rotate(-90, ${CENTER}, ${CENTER})`}
        />
        {/* Checkmark */}
        <path
          d="M18 28 L24 34 L38 20"
          fill="none"
          stroke="#22C55E"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={CHECKMARK_LENGTH}
          strokeDashoffset={checkDashOffset}
        />
      </svg>
    </div>
  );
};
