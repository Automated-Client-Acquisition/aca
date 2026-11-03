/**
 * ScreenshotLayer — Animated screenshot with camera moves.
 *
 * Client-side copy of workers/video-renderer/src/remotion/components/ScreenshotLayer.tsx.
 * Pure React — no Node.js-specific code.
 */

import React, { useMemo } from 'react';
import { AbsoluteFill, Img } from 'remotion';
import { getCameraTransform } from '@/remotion/presenter/animations/camera';
import type { CameraMove } from '@/remotion/presenter/types';

interface ScreenshotLayerProps {
  src: string;
  camera: CameraMove;
  frame: number;
  fps: number;
  shotDuration: number;
}

export const ScreenshotLayer: React.FC<ScreenshotLayerProps> = ({
  src,
  camera,
  frame,
  fps,
  shotDuration,
}) => {
  const totalFrames = Math.round(shotDuration * fps);
  const progress = totalFrames > 0 ? Math.min(frame / totalFrames, 1) : 0;

  const transform = useMemo(() => {
    return getCameraTransform(
      camera.move,
      progress,
      frame,
      camera.target_element ? 100 : 0,
      camera.target_element ? 80 : 0,
      camera.start_scale,
      camera.end_scale,
    );
  }, [camera.move, camera.target_element, camera.start_scale, camera.end_scale, progress, frame]);

  const cssTransform = [
    `scale(${transform.scale})`,
    `translate(${transform.x}px, ${transform.y}px)`,
    transform.rotateX ? `rotateX(${transform.rotateX}deg)` : '',
    transform.rotateY ? `rotateY(${transform.rotateY}deg)` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        perspective: transform.rotateX || transform.rotateY ? 1000 : undefined,
      }}
    >
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: cssTransform,
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      />
    </AbsoluteFill>
  );
};
