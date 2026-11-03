/**
 * SceneImageShot layout: Full-screen AI-generated or uploaded image with camera animation.
 *
 * Used in the unified video pipeline when imageMode === 'ai_generated' or
 * when uploaded images are used as scene visuals. Functionally similar to
 * ScreenshotFull but takes a direct image URL instead of ScreenshotData.
 */

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { ScreenshotLayer } from '../components/ScreenshotLayer.js';
import type { CameraMove, BrandConfig } from '../types.js';

interface SceneImageShotProps {
  imageUrl: string | null;
  cameraMove: CameraMove;
  frame: number;
  fps: number;
  shotDuration: number;
  brand: BrandConfig;
}

export const SceneImageShot: React.FC<SceneImageShotProps> = ({
  imageUrl,
  cameraMove,
  frame,
  fps,
  shotDuration,
  brand,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: brand.background_color }}>
      {imageUrl ? (
        <ScreenshotLayer
          src={imageUrl}
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
            No image
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};
