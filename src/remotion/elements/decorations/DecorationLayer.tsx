/**
 * DecorationLayer — Renders positioned decoration instances for a shot.
 *
 * Each DecorationInstance is positioned via CSS percentage-based absolute
 * positioning and wrapped in a Remotion Sequence for timing control.
 *
 * Inserted between layout content and overlays (z-index 15).
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Sequence } from 'remotion';
import { DecorationRenderer } from './DecorationRenderer';
import type { BrandConfig, DecorationInstance } from '@/remotion/presenter/types';

interface DecorationLayerProps {
  decorations: DecorationInstance[];
  brand: BrandConfig;
  shotDurationFrames: number;
}

export const DecorationLayer: React.FC<DecorationLayerProps> = ({
  decorations,
  brand,
  shotDurationFrames,
}) => {
  const { fps, width, height } = useVideoConfig();

  if (!decorations || decorations.length === 0) return null;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 15 }}>
      {decorations.map((dec, i) => {
        const startOffset = dec.start_frame_offset ?? 0;
        const duration = dec.duration_frames ?? (shotDurationFrames - startOffset);

        return (
          <Sequence
            key={`dec-${i}-${dec.decoration_id}`}
            from={startOffset}
            durationInFrames={Math.max(1, duration)}
          >
            <DecorationItem
              dec={dec}
              brand={brand}
              fps={fps}
              width={width}
              height={height}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

/** Individual decoration item — needs its own component to use useCurrentFrame inside Sequence. */
const DecorationItem: React.FC<{
  dec: DecorationInstance;
  brand: BrandConfig;
  fps: number;
  width: number;
  height: number;
}> = ({ dec, brand, fps, width, height }) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: 'absolute',
        left: `${dec.position.x}%`,
        top: `${dec.position.y}%`,
        transform: `translate(-50%, -50%) scale(${dec.scale}) rotate(${dec.rotation ?? 0}deg)`,
        transformOrigin: 'center center',
      }}
    >
      <DecorationRenderer
        decorationId={dec.decoration_id}
        brand={brand}
        frame={frame}
        fps={fps}
        width={width}
        height={height}
        config={dec.config}
      />
    </div>
  );
};
