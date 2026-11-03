/**
 * AnimatedEmoji — A generic animated emoji component with multiple animation presets.
 *
 * Reads `config.emoji` for the emoji character (default: '🔥').
 * Reads `config.animation` for the animation type: 'bounce' | 'pulse' | 'shake' | 'float'.
 * Renders emoji as large text (48px) with deterministic Remotion-driven animation.
 */

import React from 'react';
import { spring, interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types.js';

type EmojiAnimation = 'bounce' | 'pulse' | 'shake' | 'float';

export const AnimatedEmoji: React.FC<DecorationComponentProps> = ({
  frame,
  fps,
  config,
}) => {
  const emoji = (config?.emoji as string) ?? '🔥';
  const animation = (config?.animation as EmojiAnimation) ?? 'bounce';

  let transform = '';
  let opacity = 1;

  switch (animation) {
    case 'bounce': {
      // Spring scale 0 -> 1.3 -> 1.0 entrance
      const scaleRaw = spring({
        frame,
        fps,
        config: {
          damping: 8,
          stiffness: 150,
          mass: 0.6,
        },
        durationInFrames: Math.round(fps * 0.8),
      });
      // Overshoot to 1.3 then settle at 1.0
      const scale = interpolate(scaleRaw, [0, 0.7, 1], [0, 1.3, 1.0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      transform = `scale(${scale})`;
      break;
    }

    case 'pulse': {
      // Looping scale oscillation 1.0 -> 1.15 -> 1.0 using sin wave
      const cycleDuration = fps; // 1 second cycle
      const progress = (frame % cycleDuration) / cycleDuration;
      const scale = 1.0 + 0.15 * Math.sin(progress * Math.PI * 2);
      transform = `scale(${scale})`;
      break;
    }

    case 'shake': {
      // Looping horizontal shake using sin wave, +/-3px
      const shakeCycle = fps * 0.5; // 0.5 second cycle for snappy shake
      const shakeProgress = (frame % shakeCycle) / shakeCycle;
      const tx = 3 * Math.sin(shakeProgress * Math.PI * 2);
      transform = `translateX(${tx}px)`;
      break;
    }

    case 'float': {
      // Non-looping upward float with gentle rotation
      const totalFrames = fps * 2; // 2 second float
      const progress = Math.min(frame / totalFrames, 1);
      const ty = interpolate(progress, [0, 1], [0, -40], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      const rotation = interpolate(progress, [0, 0.5, 1], [0, 8, -4], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      opacity = interpolate(progress, [0, 0.2, 0.8, 1], [0, 1, 1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      transform = `translateY(${ty}px) rotate(${rotation}deg)`;
      break;
    }
  }

  return (
    <div
      style={{
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform,
        opacity,
        fontSize: 48,
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      {emoji}
    </div>
  );
};
