/**
 * AvatarFullscreen layout: the avatar video takes the full frame.
 *
 * Used for emphasis moments where the presenter is front and center,
 * such as hook openings, key insights, or CTAs.
 */

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { AvatarLayer } from '../components/AvatarLayer.js';
import type { BrandConfig } from '../types.js';

interface AvatarFullscreenProps {
  avatarVideoUrl: string;
  avatarTimeOffset: number;
  brand: BrandConfig;
}

export const AvatarFullscreen: React.FC<AvatarFullscreenProps> = ({
  avatarVideoUrl,
  avatarTimeOffset,
  brand,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: brand.background_color }}>
      <AvatarLayer
        videoUrl={avatarVideoUrl}
        timeOffset={avatarTimeOffset}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </AbsoluteFill>
  );
};
