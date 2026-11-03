/**
 * ScreenshotFull layout: screenshot takes the full frame.
 *
 * Client-side copy of workers/video-renderer/src/remotion/layouts/ScreenshotFull.tsx.
 */

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { ScreenshotLayer } from '@/remotion/presenter/components/ScreenshotLayer';
import type { ScreenshotData, CameraMove, BrandConfig } from '@/remotion/presenter/types';

interface ScreenshotFullProps {
  screenshot: ScreenshotData | null;
  cameraMove: CameraMove;
  frame: number;
  fps: number;
  shotDuration: number;
  brand: BrandConfig;
}

export const ScreenshotFull: React.FC<ScreenshotFullProps> = ({
  screenshot,
  cameraMove,
  frame,
  fps,
  shotDuration,
  brand,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: brand.background_color }}>
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
            backgroundColor: brand.background_color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ color: brand.text_color, fontSize: 24, opacity: 0.5 }}>
            No screenshot
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};
