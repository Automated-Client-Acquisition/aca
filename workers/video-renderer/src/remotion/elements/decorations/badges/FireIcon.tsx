/**
 * FireIcon — Animated fire flame SVG with 2-3 flickering layers.
 *
 * Looping: layers oscillate using sin(frame) for organic flicker.
 * Colors: orange (#FF6B35) outer, yellow (#FFC107) middle, bright yellow (#FFE082) inner.
 * Each layer shifts slightly in scale and position per frame.
 */

import React from 'react';
import { spring } from 'remotion';
import type { DecorationComponentProps } from '../types.js';

const SIZE = 48;

export const FireIcon: React.FC<DecorationComponentProps> = ({
  frame,
  fps,
}) => {
  // ── Entrance: spring scale 0 -> 1 ──
  const entranceScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 120, mass: 0.8 },
  });

  // ── Organic flicker offsets using sin ──
  const flicker1 = Math.sin(frame * 0.25) * 0.06;
  const flicker2 = Math.sin(frame * 0.35 + 1.2) * 0.08;
  const flicker3 = Math.sin(frame * 0.45 + 2.5) * 0.05;

  // Slight vertical oscillation for each layer
  const yShift1 = Math.sin(frame * 0.2) * 1.5;
  const yShift2 = Math.sin(frame * 0.3 + 0.8) * 2;
  const yShift3 = Math.sin(frame * 0.4 + 1.6) * 1;

  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        transform: `scale(${entranceScale})`,
        transformOrigin: 'center bottom',
      }}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox="0 0 48 48"
        style={{ overflow: 'visible' }}
      >
        {/* Outer flame — orange */}
        <path
          d="M24 4 C24 4, 12 18, 12 28 C12 34.6, 17.4 40, 24 40 C30.6 40, 36 34.6, 36 28 C36 18, 24 4, 24 4Z"
          fill="#FF6B35"
          transform={`translate(0, ${yShift1}) scale(${1 + flicker1})`}
          style={{ transformOrigin: '24px 40px' }}
        />
        {/* Middle flame — yellow-orange */}
        <path
          d="M24 14 C24 14, 16 24, 16 30 C16 34.4, 19.6 38, 24 38 C28.4 38, 32 34.4, 32 30 C32 24, 24 14, 24 14Z"
          fill="#FFC107"
          transform={`translate(0, ${yShift2}) scale(${1 + flicker2})`}
          style={{ transformOrigin: '24px 38px' }}
        />
        {/* Inner flame — bright yellow */}
        <path
          d="M24 22 C24 22, 20 28, 20 32 C20 34.2, 21.8 36, 24 36 C26.2 36, 28 34.2, 28 32 C28 28, 24 22, 24 22Z"
          fill="#FFE082"
          transform={`translate(0, ${yShift3}) scale(${1 + flicker3})`}
          style={{ transformOrigin: '24px 36px' }}
        />
      </svg>
    </div>
  );
};
