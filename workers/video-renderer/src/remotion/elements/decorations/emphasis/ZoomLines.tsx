/**
 * ZoomLines — Radial lines emanating from center outward (manga action lines).
 *
 * 14 lines at equal angles animate outward from a small radius to the edge,
 * then reset. Uses modulo-based looping with interpolate for extension and fade.
 * Semi-transparent brand.accent_color.
 */

import React from 'react';
import { interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types.js';

const LINE_COUNT = 14;
const INNER_RADIUS = 8;
const OUTER_RADIUS = 52;

export const ZoomLines: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
  width: compWidth,
  height: compHeight,
}) => {
  const color = brand.accent_color;
  const cycleLength = Math.round(fps * 0.8); // 0.8-second loop
  const size = 108;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        {Array.from({ length: LINE_COUNT }).map((_, i) => {
          const angle = (i / LINE_COUNT) * Math.PI * 2;

          // Stagger each line slightly so they don't all fire at once
          const stagger = (i / LINE_COUNT) * cycleLength * 0.4;
          const loopFrame = (frame + stagger) % cycleLength;
          const progress = loopFrame / cycleLength;

          // Line extends from inner to outer radius based on progress
          const currentInner = interpolate(
            progress,
            [0, 0.3, 1],
            [INNER_RADIUS, INNER_RADIUS, OUTER_RADIUS * 0.6],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          const currentOuter = interpolate(
            progress,
            [0, 1],
            [INNER_RADIUS + 4, OUTER_RADIUS],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );

          // Fade in then out
          const opacity = interpolate(
            progress,
            [0, 0.15, 0.6, 1],
            [0, 0.55, 0.45, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );

          const x1 = cx + Math.cos(angle) * currentInner;
          const y1 = cy + Math.sin(angle) * currentInner;
          const x2 = cx + Math.cos(angle) * currentOuter;
          const y2 = cy + Math.sin(angle) * currentOuter;

          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              opacity={opacity}
            />
          );
        })}
      </svg>
    </div>
  );
};
