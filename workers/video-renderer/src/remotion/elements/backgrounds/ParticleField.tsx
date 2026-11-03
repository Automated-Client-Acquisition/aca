/**
 * ParticleField — floating particles with Perlin noise + parallax depth.
 *
 * Renders as a background layer (z-index 0) behind content.
 * Creates organic, living depth that transforms static backgrounds.
 */

import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { noise2D } from '@remotion/noise';
import type { BrandConfig } from '../../types.js';

interface ParticleFieldProps {
  brand: BrandConfig;
  /** Number of particles. Default: 40. */
  particleCount?: number;
  /** Overall intensity (0-1). Controls alpha range. Default: 0.5. */
  intensity?: number;
}

interface Particle {
  /** Initial x position (0-1). */
  baseX: number;
  /** Initial y position (0-1). */
  baseY: number;
  /** Particle size in px. */
  size: number;
  /** Base opacity. */
  alpha: number;
  /** Depth layer (0-2) — lower = farther = slower. */
  depth: number;
  /** Unique seed for noise. */
  seed: number;
}

function generateParticles(count: number, intensity: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random via golden ratio hash
    const hash = (i * 2654435761) >>> 0;
    const r1 = (hash % 1000) / 1000;
    const r2 = ((hash * 7) % 1000) / 1000;
    const r3 = ((hash * 13) % 1000) / 1000;

    const depth = i % 3; // 0=far, 1=mid, 2=near
    const alphaRange = depth === 0 ? 0.08 : depth === 1 ? 0.15 : 0.25;

    particles.push({
      baseX: r1,
      baseY: r2,
      size: 2 + r3 * 4, // 2-6px
      alpha: alphaRange * intensity,
      depth,
      seed: i,
    });
  }
  return particles;
}

export const ParticleField: React.FC<ParticleFieldProps> = ({
  brand,
  particleCount = 40,
  intensity = 0.5,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const particles = useMemo(
    () => generateParticles(particleCount, intensity),
    [particleCount, intensity],
  );

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      {particles.map((p, i) => {
        // Speed inversely proportional to depth (farther = slower)
        const speedMultiplier = p.depth === 0 ? 0.005 : p.depth === 1 ? 0.01 : 0.018;

        const x = p.baseX * width + noise2D(`px-${p.seed}`, frame * speedMultiplier, 0) * width * 0.15;
        const y = p.baseY * height + noise2D(`py-${p.seed}`, 0, frame * speedMultiplier) * height * 0.12;

        // Gentle opacity pulsing
        const opacityPulse = 0.7 + noise2D(`po-${p.seed}`, frame * 0.008, 0) * 0.3;

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              backgroundColor: brand.accent_color,
              opacity: p.alpha * opacityPulse,
              willChange: 'transform',
              transform: 'translateZ(0)', // Force GPU layer
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
