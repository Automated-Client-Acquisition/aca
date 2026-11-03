/**
 * Sparkles — 5 four-pointed sparkle stars arranged in a circle (~60px diameter).
 *
 * Loops continuously: each sparkle orbits the center with staggered scale pulsing
 * driven by sin-wave math. Uses brand.accent_color for theming.
 */

import React from 'react';
import { interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types.js';

/** SVG path for a 4-pointed star centered at origin, fitting a 10x10 box. */
const STAR_PATH = 'M5 0 L6.2 3.8 L10 5 L6.2 6.2 L5 10 L3.8 6.2 L0 5 L3.8 3.8 Z';

const SPARKLE_COUNT = 5;
const ORBIT_RADIUS = 28;
const CYCLE_FRAMES_BASE = 90; // ~3s at 30fps for full orbit

export const Sparkles: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
}) => {
  const color = brand.accent_color;
  const cycleLength = Math.round(fps * 3); // 3-second orbit loop

  return (
    <div
      style={{
        width: 72,
        height: 72,
        position: 'relative',
      }}
    >
      {Array.from({ length: SPARKLE_COUNT }).map((_, i) => {
        const phaseOffset = (i / SPARKLE_COUNT) * Math.PI * 2;

        // Continuous rotation: angle advances with frame
        const angle =
          phaseOffset + ((frame / cycleLength) * Math.PI * 2);

        const x = 36 + Math.cos(angle) * ORBIT_RADIUS;
        const y = 36 + Math.sin(angle) * ORBIT_RADIUS;

        // Staggered scale pulse via sin wave
        const pulseCycle = fps * 0.8; // ~0.8s per pulse
        const pulsePhase = (i / SPARKLE_COUNT) * Math.PI * 2;
        const rawPulse = Math.sin(
          ((frame / pulseCycle) * Math.PI * 2) + pulsePhase,
        );
        const scale = interpolate(rawPulse, [-1, 1], [0.5, 1.2]);

        // Slight opacity variation tied to pulse
        const opacity = interpolate(rawPulse, [-1, 1], [0.6, 1.0]);

        return (
          <svg
            key={i}
            width={12}
            height={12}
            viewBox="0 0 10 10"
            style={{
              position: 'absolute',
              left: x - 6,
              top: y - 6,
              transform: `scale(${scale})`,
              opacity,
              transformOrigin: 'center center',
            }}
          >
            <path d={STAR_PATH} fill={color} />
          </svg>
        );
      })}
    </div>
  );
};
