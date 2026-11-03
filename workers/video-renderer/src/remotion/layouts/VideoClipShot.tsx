/**
 * VideoClipShot layout: Plays a time-range segment of a source video.
 *
 * Used in the unified video pipeline for video_clip shots — segments
 * of an uploaded/imported source video. Supports playback speed control.
 */

import React from 'react';
import { AbsoluteFill, Video, useVideoConfig } from 'remotion';
import type { BrandConfig } from '../types.js';

interface VideoClipShotProps {
  sourceVideoUrl: string;
  sourceStart: number;  // seconds
  sourceEnd: number;    // seconds
  speed: number;        // playback speed multiplier (1.0 = normal)
  brand: BrandConfig;
}

export const VideoClipShot: React.FC<VideoClipShotProps> = ({
  sourceVideoUrl,
  sourceStart,
  sourceEnd,
  speed,
  brand,
}) => {
  const { fps } = useVideoConfig();

  if (!sourceVideoUrl) {
    return (
      <AbsoluteFill style={{ backgroundColor: brand.background_color }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ color: brand.text_color, fontSize: 24, opacity: 0.5 }}>
            No source video
          </span>
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Video
        src={sourceVideoUrl}
        crossOrigin="anonymous"
        startFrom={Math.round(sourceStart * fps)}
        playbackRate={speed || 1}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </AbsoluteFill>
  );
};
