/**
 * FilmGrain — SVG noise texture overlay for premium texture.
 *
 * Prevents the flat-digital look by adding subtle film grain.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

interface FilmGrainProps {
  /** Grain opacity (0 = none, 1 = very grainy). Default: 0.04 */
  intensity?: number;
}

export const FilmGrain: React.FC<FilmGrainProps> = ({ intensity = 0.04 }) => {
  const frame = useCurrentFrame();

  if (intensity <= 0) return null;

  // Pseudo-random seed from frame for per-frame grain animation
  const grainSeed = ((frame * 2654435761) >>> 0) % 1000;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: intensity,
          mixBlendMode: 'overlay',
        }}
      >
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <filter id={`grain-${frame}`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.65"
              numOctaves="3"
              seed={grainSeed}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#grain-${frame})`} />
        </svg>
      </div>
    </AbsoluteFill>
  );
};
