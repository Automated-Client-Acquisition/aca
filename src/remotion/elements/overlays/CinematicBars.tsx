/**
 * CinematicBars — subtle letterbox gradient bars for cinematic framing.
 *
 * Ported from CinematicOverlay in workers/video-renderer.
 */

import React from 'react';
import { AbsoluteFill } from 'remotion';

interface CinematicBarsProps {
  /** Bar height as CSS value. Default: '3%' */
  barHeight?: string;
  /** Bar opacity. Default: 0.3 */
  opacity?: number;
}

export const CinematicBars: React.FC<CinematicBarsProps> = ({
  barHeight = '3%',
  opacity = 0.3,
}) => {
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: barHeight,
          background: `linear-gradient(to bottom, rgba(0,0,0,${opacity}), transparent)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: barHeight,
          background: `linear-gradient(to top, rgba(0,0,0,${opacity}), transparent)`,
        }}
      />
    </AbsoluteFill>
  );
};
