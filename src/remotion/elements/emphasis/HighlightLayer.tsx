/**
 * HighlightLayer — Visual highlights for UI elements.
 *
 * Ported from workers/video-renderer/src/remotion/components/HighlightLayer.tsx.
 * Renders animated highlights: red_circle, underline_draw, blur_except,
 * glow_pulse, arrow, magnify.
 *
 * Pure React — no Node.js-specific code.
 */

import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import {
  getCircleDrawProgress,
  getCircleDimensions,
  getUnderlineWidth,
  getBlurAmount,
  getBlurMaskOpacity,
  getGlowSpread,
  getGlowOpacity,
  getArrowPosition,
  getMagnifyTransform,
} from './highlights';
import type { HighlightType, ElementBounds, CameraMove } from '@/remotion/presenter/types';

interface HighlightLayerProps {
  type: HighlightType;
  targetBounds: ElementBounds | null;
  cameraMove: CameraMove;
  frame: number;
  fps: number;
}

export const HighlightLayer: React.FC<HighlightLayerProps> = ({
  type,
  targetBounds,
  cameraMove,
  frame,
  fps,
}) => {
  const { width, height } = useVideoConfig();

  if (!targetBounds) return null;

  const progress = Math.min(frame / 90, 1);

  switch (type) {
    case 'red_circle':
      return <RedCircleHighlight bounds={targetBounds} progress={progress} width={width} height={height} />;
    case 'underline_draw':
      return <UnderlineHighlight bounds={targetBounds} progress={progress} />;
    case 'blur_except':
      return <BlurExceptHighlight bounds={targetBounds} progress={progress} width={width} height={height} />;
    case 'glow_pulse':
      return <GlowPulseHighlight bounds={targetBounds} progress={progress} frame={frame} />;
    case 'arrow':
      return <ArrowHighlight bounds={targetBounds} progress={progress} />;
    case 'fake_cursor_click':
      return null;
    case 'magnify':
      return <MagnifyHighlight bounds={targetBounds} progress={progress} width={width} height={height} />;
    default:
      return null;
  }
};

// ─── Red Circle ──────────────────────────────────────────────────────────────

const RedCircleHighlight: React.FC<{
  bounds: ElementBounds; progress: number; width: number; height: number;
}> = ({ bounds, progress, width, height }) => {
  const dims = getCircleDimensions(bounds, 15);
  const circumference = Math.PI * 2 * Math.max(dims.rx, dims.ry);
  const dashOffset = getCircleDrawProgress(progress, circumference);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        <ellipse
          cx={dims.cx} cy={dims.cy} rx={dims.rx} ry={dims.ry}
          fill="none" stroke="#FF3333" strokeWidth={3}
          strokeDasharray={circumference} strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </svg>
    </AbsoluteFill>
  );
};

// ─── Underline Draw ──────────────────────────────────────────────────────────

const UnderlineHighlight: React.FC<{
  bounds: ElementBounds; progress: number;
}> = ({ bounds, progress }) => {
  const widthPercent = getUnderlineWidth(progress);
  const lineWidth = (bounds.width * widthPercent) / 100;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: bounds.x,
          top: bounds.y + bounds.height + 4,
          width: lineWidth,
          height: 4,
          backgroundColor: '#FF3333',
          borderRadius: 2,
        }}
      />
    </AbsoluteFill>
  );
};

// ─── Blur Except ─────────────────────────────────────────────────────────────

const BlurExceptHighlight: React.FC<{
  bounds: ElementBounds; progress: number; width: number; height: number;
}> = ({ bounds, progress, width, height }) => {
  const blurAmount = getBlurAmount(progress);
  const maskOpacity = getBlurMaskOpacity(progress);
  const padding = 10;
  const clipLeft = ((bounds.x - padding) / width) * 100;
  const clipTop = ((bounds.y - padding) / height) * 100;
  const clipRight = ((bounds.x + bounds.width + padding) / width) * 100;
  const clipBottom = ((bounds.y + bounds.height + padding) / height) * 100;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: `rgba(0, 0, 0, ${maskOpacity})`,
          backdropFilter: `blur(${blurAmount}px)`,
          clipPath: `polygon(
            0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
            ${clipLeft}% ${clipTop}%, ${clipLeft}% ${clipBottom}%,
            ${clipRight}% ${clipBottom}%, ${clipRight}% ${clipTop}%,
            ${clipLeft}% ${clipTop}%
          )`,
        }}
      />
    </AbsoluteFill>
  );
};

// ─── Glow Pulse ──────────────────────────────────────────────────────────────

const GlowPulseHighlight: React.FC<{
  bounds: ElementBounds; progress: number; frame: number;
}> = ({ bounds, progress, frame }) => {
  const spread = getGlowSpread(progress, frame);
  const opacity = getGlowOpacity(progress, frame);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: bounds.x - 10,
          top: bounds.y - 10,
          width: bounds.width + 20,
          height: bounds.height + 20,
          borderRadius: 8,
          boxShadow: `0 0 ${spread}px ${spread / 2}px rgba(255, 200, 50, ${opacity})`,
          border: `2px solid rgba(255, 200, 50, ${opacity})`,
        }}
      />
    </AbsoluteFill>
  );
};

// ─── Arrow ───────────────────────────────────────────────────────────────────

const ArrowHighlight: React.FC<{
  bounds: ElementBounds; progress: number;
}> = ({ bounds, progress }) => {
  const arrow = getArrowPosition(progress, bounds);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: arrow.x,
          top: arrow.y,
          opacity: arrow.opacity,
          transform: `rotate(${arrow.rotation}deg)`,
          transformOrigin: 'bottom left',
          fontSize: 48,
          lineHeight: 1,
        }}
      >
        <svg width="60" height="60" viewBox="0 0 60 60">
          <path
            d="M55 5 L15 45 M15 45 L15 20 M15 45 L40 45"
            stroke="#FF3333" strokeWidth="4" fill="none"
            strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
      </div>
    </AbsoluteFill>
  );
};

// ─── Magnify ─────────────────────────────────────────────────────────────────

const MagnifyHighlight: React.FC<{
  bounds: ElementBounds; progress: number; width: number; height: number;
}> = ({ bounds, progress }) => {
  const mag = getMagnifyTransform(progress, bounds);
  const size = Math.max(bounds.width, bounds.height) + 40;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: bounds.x + bounds.width / 2 - size / 2,
          top: bounds.y + bounds.height / 2 - size / 2,
          width: size,
          height: size,
          borderRadius: '50%',
          border: '3px solid rgba(255, 255, 255, 0.8)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          transform: `scale(${mag.scale})`,
          opacity: mag.opacity,
          overflow: 'hidden',
          transformOrigin: 'center center',
        }}
      />
    </AbsoluteFill>
  );
};
