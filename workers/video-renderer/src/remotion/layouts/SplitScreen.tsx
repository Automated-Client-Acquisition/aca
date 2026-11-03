/**
 * SplitScreen layout: 50/50 split between avatar video and screenshot.
 *
 * Supports split_left (avatar left, screenshot right) and
 * split_right (screenshot left, avatar right).
 *
 * Portrait mode: vertical split (top/bottom) — screenshot on top, avatar below.
 * Landscape mode: horizontal split (left/right) — classic side-by-side.
 */

import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import { ScreenshotLayer } from '../components/ScreenshotLayer.js';
import { AvatarLayer } from '../components/AvatarLayer.js';
import type { ScreenshotData, CameraMove, BrandConfig } from '../types.js';

interface SplitScreenProps {
  screenshot: ScreenshotData | null;
  avatarVideoUrl: string;
  avatarTimeOffset: number;
  cameraMove: CameraMove;
  frame: number;
  fps: number;
  shotDuration: number;
  brand: BrandConfig;
  direction: 'split_left' | 'split_right';
}

export const SplitScreen: React.FC<SplitScreenProps> = ({
  screenshot,
  avatarVideoUrl,
  avatarTimeOffset,
  cameraMove,
  frame,
  fps,
  shotDuration,
  brand,
  direction,
}) => {
  const { width, height } = useVideoConfig();

  // Portrait (9:16): vertical top/bottom split — screenshot gets 60%, avatar 40%
  // Landscape (16:9): horizontal left/right split — classic 50/50
  const isPortrait = height > width;

  if (isPortrait) {
    // Vertical split: screenshot on top (60%), avatar on bottom (40%)
    const screenshotHeight = Math.round(height * 0.6);
    const avatarHeight = height - screenshotHeight;

    // For split_right, swap: avatar on top, screenshot on bottom
    const screenshotOnTop = direction === 'split_left';

    return (
      <AbsoluteFill>
        {/* Dividing line */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: screenshotOnTop ? screenshotHeight - 1 : avatarHeight - 1,
            width: '100%',
            height: 2,
            backgroundColor: brand.accent_color || '#FFD700',
            zIndex: 5,
          }}
        />

        {/* Screenshot region */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: screenshotOnTop ? 0 : avatarHeight,
            width: '100%',
            height: screenshotHeight,
            overflow: 'hidden',
          }}
        >
          {screenshot ? (
            <ScreenshotLayer
              src={screenshot.url}
              camera={cameraMove}
              frame={frame}
              fps={fps}
              shotDuration={shotDuration}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                backgroundColor: brand.background_color || '#111',
              }}
            />
          )}
        </div>

        {/* Avatar region */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: screenshotOnTop ? screenshotHeight : 0,
            width: '100%',
            height: avatarHeight,
            overflow: 'hidden',
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
  }

  // Landscape: horizontal left/right split
  const halfWidth = width / 2;
  const avatarSide = direction === 'split_left' ? 'left' : 'right';

  return (
    <AbsoluteFill>
      {/* Dividing line */}
      <div
        style={{
          position: 'absolute',
          left: halfWidth - 1,
          top: 0,
          width: 2,
          height: '100%',
          backgroundColor: brand.accent_color || '#FFD700',
          zIndex: 5,
        }}
      />

      {/* Avatar half */}
      <div
        style={{
          position: 'absolute',
          left: avatarSide === 'left' ? 0 : halfWidth,
          top: 0,
          width: halfWidth,
          height: '100%',
          overflow: 'hidden',
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

      {/* Screenshot half */}
      <div
        style={{
          position: 'absolute',
          left: avatarSide === 'left' ? halfWidth : 0,
          top: 0,
          width: halfWidth,
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {screenshot ? (
          <ScreenshotLayer
            src={screenshot.url}
            camera={cameraMove}
            frame={frame}
            fps={fps}
            shotDuration={shotDuration}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: brand.background_color || '#111',
            }}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};
