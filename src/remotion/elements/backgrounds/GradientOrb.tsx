/**
 * GradientOrb — single animated gradient orb.
 *
 * Generalized from the gradient animation in GradientTitle layout.
 * Multiple orbs can be composed for richer backgrounds.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';
import type { BrandConfig } from '@/remotion/presenter/types';

interface GradientOrbProps {
  brand: BrandConfig;
  /** Orb color. Defaults to brand.accent_color. */
  color?: string;
  /** Orb size as % of container. Default: 60. */
  size?: number;
  /** Animation speed multiplier. Default: 1. */
  speed?: number;
  /** Starting position as [x%, y%]. Default: [50, 50]. */
  position?: [number, number];
  /** Enable hue rotation animation. Default: true. */
  hueRotate?: boolean;
}

export const GradientOrb: React.FC<GradientOrbProps> = ({
  brand,
  color,
  size = 60,
  speed = 1,
  position = [50, 50],
  hueRotate = true,
}) => {
  const frame = useCurrentFrame();

  const orbColor = color || brand.accent_color;

  // Animate position drift
  const driftFrames = 120 / speed;
  const x = interpolate(frame, [0, driftFrames], [position[0] - 15, position[0] + 15], {
    extrapolateRight: 'clamp',
  });
  const y = interpolate(frame, [0, driftFrames], [position[1] - 10, position[1] + 10], {
    extrapolateRight: 'clamp',
  });

  // Hue rotation for color variation
  const hueShift = hueRotate
    ? interpolate(frame, [0, driftFrames * 2], [0, 30], { extrapolateRight: 'clamp' })
    : 0;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${y}%`,
          width: `${size}%`,
          height: `${size}%`,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, ${orbColor}50 0%, ${brand.primary_color}25 35%, transparent 70%)`,
          filter: hueShift > 0 ? `hue-rotate(${hueShift}deg)` : undefined,
        }}
      />
    </AbsoluteFill>
  );
};
