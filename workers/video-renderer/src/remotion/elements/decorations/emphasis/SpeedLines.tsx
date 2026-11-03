/**
 * SpeedLines — Horizontal parallel lines moving left to right.
 *
 * 10 lines at different Y positions with varying lengths, looping via
 * modulo-based translateX animation. Semi-transparent brand.accent_color.
 */

import React from 'react';
import { interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types.js';

/** Deterministic line configs: yPercent (0-1), length (px), thickness, speed multiplier. */
const LINES = [
  { yPct: 0.08, length: 40, thickness: 2.5, speed: 1.0 },
  { yPct: 0.18, length: 55, thickness: 2.0, speed: 1.2 },
  { yPct: 0.28, length: 35, thickness: 3.0, speed: 0.9 },
  { yPct: 0.38, length: 60, thickness: 2.0, speed: 1.3 },
  { yPct: 0.48, length: 45, thickness: 2.5, speed: 1.0 },
  { yPct: 0.58, length: 50, thickness: 2.0, speed: 1.1 },
  { yPct: 0.68, length: 38, thickness: 3.0, speed: 0.85 },
  { yPct: 0.78, length: 58, thickness: 2.0, speed: 1.25 },
  { yPct: 0.88, length: 42, thickness: 2.5, speed: 0.95 },
  { yPct: 0.95, length: 48, thickness: 2.0, speed: 1.15 },
];

const CONTAINER_WIDTH = 120;
const CONTAINER_HEIGHT = 80;

export const SpeedLines: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
}) => {
  const color = brand.accent_color;
  const cycleLength = Math.round(fps * 0.6); // 0.6-second loop

  return (
    <div
      style={{
        width: CONTAINER_WIDTH,
        height: CONTAINER_HEIGHT,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {LINES.map((line, i) => {
        // Each line travels the full container width then resets
        const travelDistance = CONTAINER_WIDTH + line.length;
        const adjustedCycle = cycleLength / line.speed;
        const loopFrame = frame % adjustedCycle;
        const progress = loopFrame / adjustedCycle;

        // Start off-screen left, move to off-screen right
        const translateX = interpolate(
          progress,
          [0, 1],
          [-line.length, CONTAINER_WIDTH],
        );

        // Fade: fully visible in middle, transparent at edges
        const opacity = interpolate(
          progress,
          [0, 0.15, 0.7, 1],
          [0, 0.5, 0.5, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        );

        const y = line.yPct * CONTAINER_HEIGHT;

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              top: y - line.thickness / 2,
              width: line.length,
              height: line.thickness,
              borderRadius: line.thickness / 2,
              backgroundColor: color,
              opacity,
              transform: `translateX(${translateX}px)`,
            }}
          />
        );
      })}
    </div>
  );
};
