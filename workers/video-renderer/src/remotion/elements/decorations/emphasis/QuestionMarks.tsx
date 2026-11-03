/**
 * QuestionMarks — Three "?" characters with gentle floating/bobbing animation.
 *
 * Loops continuously using sin-wave vertical offset with per-character phase
 * offsets and varying sizes. Uses brand.accent_color for theming.
 */

import React from 'react';
import { interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types.js';

const MARKS = [
  { size: 40, phaseOffset: 0 },
  { size: 48, phaseOffset: (Math.PI * 2) / 3 },
  { size: 36, phaseOffset: (Math.PI * 4) / 3 },
];

export const QuestionMarks: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
}) => {
  const color = brand.accent_color;
  const floatCycle = fps * 1.5; // 1.5-second float period

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        width: 100,
        height: 64,
      }}
    >
      {MARKS.map((mark, i) => {
        // Gentle sin-wave bobbing
        const rawSin = Math.sin(
          ((frame / floatCycle) * Math.PI * 2) + mark.phaseOffset,
        );
        const translateY = interpolate(rawSin, [-1, 1], [-8, 8]);

        // Subtle scale breathing synced to bob
        const scale = interpolate(rawSin, [-1, 1], [0.92, 1.08]);

        return (
          <span
            key={i}
            style={{
              fontSize: mark.size,
              fontWeight: 800,
              lineHeight: 1,
              color,
              transform: `translateY(${translateY}px) scale(${scale})`,
              transformOrigin: 'center center',
              userSelect: 'none',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            ?
          </span>
        );
      })}
    </div>
  );
};
