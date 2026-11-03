/**
 * AvatarLayer — Avatar PiP video overlay.
 *
 * Renders the lip-synced avatar video with a time offset for correct sync.
 * The avatar video plays continuously; the time offset ensures each shot
 * shows the correct portion of the avatar video matching the narration.
 *
 * Pure React — no Node.js-specific code.
 */

import React from 'react';
import { Video } from 'remotion';

interface AvatarLayerProps {
  videoUrl: string;
  timeOffset: number; // In frames — where in the global timeline this shot starts
  style?: React.CSSProperties;
}

export const AvatarLayer: React.FC<AvatarLayerProps> = ({
  videoUrl,
  timeOffset,
  style,
}) => {
  // When no avatar video is available (lip-sync skipped), render a placeholder
  if (!videoUrl) {
    return (
      <div
        style={{
          objectFit: 'cover',
          backgroundColor: '#1a1a2e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style,
        }}
      />
    );
  }

  return (
    <Video
      src={videoUrl}
      crossOrigin="anonymous"
      startFrom={timeOffset}
      style={{
        objectFit: 'cover',
        ...style,
      }}
    />
  );
};
