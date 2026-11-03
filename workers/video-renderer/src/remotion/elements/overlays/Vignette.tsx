/**
 * Vignette — edge darkening overlay for cinematic look.
 *
 * Renders as a full-screen overlay on top of scene content.
 */

import React from 'react';
import { AbsoluteFill } from 'remotion';

interface VignetteProps {
  /** Darkness at edges (0 = none, 1 = very dark). Default: 0.35 */
  intensity?: number;
}

export const Vignette: React.FC<VignetteProps> = ({ intensity = 0.35 }) => {
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(
            ellipse 80% 80% at 50% 50%,
            transparent 40%,
            rgba(0, 0, 0, ${intensity * 0.5}) 75%,
            rgba(0, 0, 0, ${intensity}) 100%
          )`,
        }}
      />
    </AbsoluteFill>
  );
};
