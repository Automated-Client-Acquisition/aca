/**
 * CinematicOverlay — Vignette + subtle film grain for premium look.
 *
 * Renders as a full-screen overlay on top of scene content.
 * The vignette darkens edges to draw the eye to the center.
 * The grain adds subtle texture that prevents the flat-digital look.
 *
 * Pure React — no Node.js-specific code.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

interface CinematicOverlayProps {
  /** Vignette darkness at edges (0 = none, 1 = very dark). Default: 0.35 */
  vignetteIntensity?: number;
  /** Film grain opacity (0 = none, 1 = very grainy). Default: 0.04 */
  grainIntensity?: number;
}

export const CinematicOverlay: React.FC<CinematicOverlayProps> = ({
  vignetteIntensity = 0.35,
  grainIntensity = 0.04,
}) => {
  const frame = useCurrentFrame();

  // Generate a pseudo-random seed from the frame for grain animation
  // This creates a different grain pattern every frame
  const grainSeed = ((frame * 2654435761) >>> 0) % 1000;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* Vignette — radial gradient darkening edges */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(
            ellipse 80% 80% at 50% 50%,
            transparent 40%,
            rgba(0, 0, 0, ${vignetteIntensity * 0.5}) 75%,
            rgba(0, 0, 0, ${vignetteIntensity}) 100%
          )`,
        }}
      />

      {/* Film grain — SVG noise filter for texture */}
      {grainIntensity > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: grainIntensity,
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
      )}

      {/* Subtle top/bottom letterbox bars for cinematic framing */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3%',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.3), transparent)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '3%',
          background: 'linear-gradient(to top, rgba(0,0,0,0.3), transparent)',
        }}
      />
    </AbsoluteFill>
  );
};
