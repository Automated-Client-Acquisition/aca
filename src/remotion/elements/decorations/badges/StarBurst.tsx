/**
 * StarBurst — SVG star shape with slow continuous rotation.
 *
 * Uses brand.accent_color for fill.
 * Looping: rotation = (frame / fps) * 60 degrees (one full rotation per 6 seconds).
 * Entrance: spring scale from 0 to 1.
 */

import React from 'react';
import { spring } from 'remotion';
import type { DecorationComponentProps } from '../types';

/**
 * Generate an 8-point star polygon as SVG points string.
 * Alternates between outer and inner radii.
 */
function starPoints(cx: number, cy: number, outerR: number, innerR: number, points: number): string {
  const coords: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI / points) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    coords.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return coords.join(' ');
}

const SIZE = 56;
const CENTER = SIZE / 2;

export const StarBurst: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
}) => {
  const fillColor = brand.accent_color || '#F59E0B';

  // ── Entrance: spring scale 0 -> 1 ──
  const entranceScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100, mass: 0.8 },
  });

  // ── Continuous rotation: 60 degrees per second -> full rotation in 6s ──
  const rotation = (frame / fps) * 60;

  const points = starPoints(CENTER, CENTER, CENTER - 2, (CENTER - 2) * 0.45, 8);

  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        transform: `scale(${entranceScale}) rotate(${rotation}deg)`,
        transformOrigin: 'center center',
      }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <polygon
          points={points}
          fill={fillColor}
          stroke="none"
        />
      </svg>
    </div>
  );
};
