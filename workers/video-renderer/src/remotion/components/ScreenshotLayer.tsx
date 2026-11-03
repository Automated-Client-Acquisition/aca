/**
 * ScreenshotLayer — Animated screenshot with camera moves.
 *
 * Applies camera animations (ken burns, punch zoom, pan, shake, etc.)
 * to a screenshot image. Used by both presenter and storyboard pipelines.
 *
 * Pure React — no Node.js-specific code.
 */

import React, { useMemo } from 'react';
import { AbsoluteFill, Img } from 'remotion';
import { getCameraTransform } from '../animations/camera.js';
import type { CameraMove } from '../types.js';

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
      camera.target_element ? 100 : 0, // Default target offset if element specified
      camera.target_element ? 80 : 0,
      camera.start_scale,
      camera.end_scale,
    );
  }, [camera.move, camera.target_element, camera.start_scale, camera.end_scale, progress, frame]);

  // Build CSS transform string
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
        crossOrigin="anonymous"
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
