/**
 * MeshGradient — animated multi-point gradient background.
 *
 * Creates an "Apple keynote" style flowing color field by blurring
 * 3-4 drifting radial gradients into a smooth mesh.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { noise2D } from '@remotion/noise';
import type { BrandConfig } from '@/remotion/presenter/types';

interface MeshGradientProps {
  brand: BrandConfig;
  /** Drift speed multiplier. Default: 1. */
  speed?: number;
  /** Gradient intensity (0-1). Default: 0.5. */
  intensity?: number;
}

/**
 * Lighten a hex color by mixing with white.
 */
function lightenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
}

interface GradientPoint {
  seed: string;
  color: string;
  size: number; // % of container
}

export const MeshGradient: React.FC<MeshGradientProps> = ({
  brand,
  speed = 1,
  intensity = 0.5,
}) => {
  const frame = useCurrentFrame();

  const points: GradientPoint[] = [
    { seed: 'mg-a', color: brand.accent_color, size: 60 },
    { seed: 'mg-b', color: brand.primary_color, size: 50 },
    { seed: 'mg-c', color: lightenColor(brand.accent_color, 0.4), size: 55 },
    { seed: 'mg-d', color: lightenColor(brand.primary_color, 0.3), size: 45 },
  ];

  const alpha = Math.round(intensity * 0.6 * 255).toString(16).padStart(2, '0');

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: '-20%', // Extend beyond bounds to prevent edge artifacts
          filter: 'blur(80px)',
        }}
      >
        {points.map((point, i) => {
          const drift = speed * 0.008;
          const x = 30 + noise2D(point.seed + '-x', frame * drift, i) * 40; // 30-70%
          const y = 20 + noise2D(point.seed + '-y', i, frame * drift) * 50; // 20-70%

          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${x}%`,
                top: `${y}%`,
                width: `${point.size}%`,
                height: `${point.size}%`,
                borderRadius: '50%',
                background: `radial-gradient(circle, ${point.color}${alpha} 0%, transparent 70%)`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
