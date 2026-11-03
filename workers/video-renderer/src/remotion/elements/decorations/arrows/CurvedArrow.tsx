/**
 * CurvedArrow — A curved arrow that draws itself using SVG strokeDashoffset.
 *
 * Non-looping: draws over ~20 frames then holds.
 * Arrow head appears after the line finishes drawing.
 * Uses brand.accent_color for theming. Base size ~48px.
 */

import React from 'react';
import { interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types.js';

const DRAW_FRAMES = 20;

// SVG curve path — a smooth arc from bottom-left to top-right
const CURVE_PATH = 'M 8 40 C 8 20, 24 8, 40 12';
// Measured path length (approximate for this cubic bezier)
const PATH_LENGTH = 55;

export const CurvedArrow: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
}) => {
  const color = brand.accent_color;

  // Draw progress: 0 to 1 over DRAW_FRAMES
  const drawProgress = interpolate(frame, [0, DRAW_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const dashOffset = PATH_LENGTH * (1 - drawProgress);

  // Arrow head fades in during last 25% of draw
  const headOpacity = interpolate(frame, [DRAW_FRAMES * 0.75, DRAW_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
        {/* Curved line with draw-on animation */}
        <path
          d={CURVE_PATH}
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={PATH_LENGTH}
          strokeDashoffset={dashOffset}
        />
        {/* Arrow head at the end of the curve */}
        <polyline
          points="34,6 40,12 34,18"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={headOpacity}
        />
      </svg>
    </div>
  );
};
