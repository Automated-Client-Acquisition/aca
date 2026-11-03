/**
 * AvatarPip layout: full-screen screenshot background with a small
 * picture-in-picture avatar video in a corner.
 *
 * The avatar position is configurable (bottom_right, bottom_left, top_right, top_left).
 * The PiP has a rounded border with a subtle shadow.
 */

import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import { ScreenshotLayer } from '../components/ScreenshotLayer.js';
import { AvatarLayer } from '../components/AvatarLayer.js';
import type {
  ScreenshotData,
  CameraMove,
  BrandConfig,
  AvatarPosition,
} from '../types.js';

interface AvatarPipProps {
  screenshot: ScreenshotData | null;
  avatarVideoUrl: string;
  avatarTimeOffset: number;
  cameraMove: CameraMove;
  frame: number;
  fps: number;
  shotDuration: number;
  brand: BrandConfig;
  avatarPosition?: AvatarPosition;
}

const POSITION_MAP: Record<AvatarPosition, React.CSSProperties> = {
  bottom_right: { bottom: 40, right: 40 },
  bottom_left: { bottom: 40, left: 40 },
  top_right: { top: 40, right: 40 },
  top_left: { top: 40, left: 40 },
};

export const AvatarPip: React.FC<AvatarPipProps> = ({
  screenshot,
  avatarVideoUrl,
  avatarTimeOffset,
  cameraMove,
  frame,
  fps,
  shotDuration,
  brand,
  avatarPosition = 'bottom_right',
}) => {
  const { width, height } = useVideoConfig();

  // PiP size: 30% of the shorter dimension
  const pipSize = Math.round(Math.min(width, height) * 0.3);

  return (
    <AbsoluteFill>
      {/* Screenshot background */}
      {screenshot && (
        <ScreenshotLayer
          src={screenshot.url}
          camera={cameraMove}
          frame={frame}
          fps={fps}
          shotDuration={shotDuration}
        />
      )}

      {/* Avatar PiP overlay */}
      <div
        style={{
          position: 'absolute',
          ...POSITION_MAP[avatarPosition],
          width: pipSize,
          height: pipSize,
          borderRadius: pipSize / 2,
          overflow: 'hidden',
          border: `3px solid ${brand.accent_color}`,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          zIndex: 10,
        }}
      >
        <AvatarLayer
          videoUrl={avatarVideoUrl}
          timeOffset={avatarTimeOffset}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
