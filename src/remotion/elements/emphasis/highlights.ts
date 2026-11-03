/**
 * Highlight animation functions.
 *
 * Ported from workers/video-renderer/src/remotion/animations/highlights.ts.
 * Generates animation values for visual highlights:
 * red circles, underlines, blur masks, glow pulses, arrows.
 *
 * Pure functions — no React hooks or Node.js dependencies.
 */

import { interpolate, Easing } from 'remotion';
import type { HighlightType, ElementBounds } from '@/remotion/presenter/types';

// ─── Circle Draw Animation ───────────────────────────────────────────────────

/**
 * Returns the stroke-dashoffset for an SVG circle draw animation.
 * Progress 0 = circle hidden, 1 = fully drawn.
 */
export function getCircleDrawProgress(
  progress: number,
  circumference: number,
): number {
  return interpolate(progress, [0, 0.6], [circumference, 0], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });
}

/**
 * Compute the radius and center for a circle highlight
 * that encompasses the target element with padding.
 */
export function getCircleDimensions(
  bounds: ElementBounds,
  padding: number = 20,
): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: bounds.x + bounds.width / 2,
    cy: bounds.y + bounds.height / 2,
    rx: bounds.width / 2 + padding,
    ry: bounds.height / 2 + padding,
  };
}

// ─── Underline Draw Animation ────────────────────────────────────────────────

/**
 * Returns the width percentage of the underline to draw.
 */
export function getUnderlineWidth(progress: number): number {
  return interpolate(progress, [0, 0.4, 1], [0, 100, 100], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });
}

/**
 * Returns vertical offset for an organic hand-drawn feel.
 */
export function getUnderlineWave(
  xPercent: number,
  amplitude: number = 2,
): number {
  return Math.sin(xPercent * Math.PI * 3) * amplitude;
}

// ─── Blur Mask Animation ─────────────────────────────────────────────────────

export function getBlurAmount(progress: number): number {
  return interpolate(progress, [0, 0.3, 0.8, 1], [0, 8, 8, 0], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });
}

export function getBlurMaskOpacity(progress: number): number {
  return interpolate(progress, [0, 0.3, 0.8, 1], [0, 0.7, 0.7, 0], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });
}

// ─── Glow Pulse Animation ────────────────────────────────────────────────────

export function getGlowSpread(progress: number, frame: number): number {
  const pulsePhase = Math.sin(frame * 0.15) * 0.5 + 0.5;
  const intensity = interpolate(progress, [0, 0.2, 0.8, 1], [0, 1, 1, 0], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });
  return pulsePhase * 20 * intensity;
}

export function getGlowOpacity(progress: number, frame: number): number {
  const pulsePhase = Math.sin(frame * 0.15) * 0.5 + 0.5;
  const intensity = interpolate(progress, [0, 0.2, 0.8, 1], [0, 1, 1, 0], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });
  return (0.4 + pulsePhase * 0.4) * intensity;
}

// ─── Arrow Point Animation ───────────────────────────────────────────────────

export function getArrowPosition(
  progress: number,
  targetBounds: ElementBounds,
): { x: number; y: number; rotation: number; opacity: number } {
  const eased = Easing.out(Easing.back(1.4))(
    Math.min(progress / 0.4, 1),
  );

  const targetX = targetBounds.x + targetBounds.width + 30;
  const targetY = targetBounds.y - 30;

  return {
    x: interpolate(eased, [0, 1], [targetX + 100, targetX]),
    y: interpolate(eased, [0, 1], [targetY - 80, targetY]),
    rotation: interpolate(eased, [0, 1], [-30, 135]),
    opacity: interpolate(progress, [0, 0.1, 0.8, 1], [0, 1, 1, 0], {
      extrapolateRight: 'clamp',
    }),
  };
}

// ─── Magnify Animation ───────────────────────────────────────────────────────

export function getMagnifyTransform(
  progress: number,
  bounds: ElementBounds,
): { scale: number; opacity: number } {
  const eased = Easing.out(Easing.cubic)(Math.min(progress / 0.3, 1));
  return {
    scale: interpolate(eased, [0, 1], [1.0, 2.5]),
    opacity: interpolate(progress, [0, 0.1, 0.8, 1], [0, 1, 1, 0], {
      extrapolateRight: 'clamp',
    }),
  };
}

// ─── Dispatch Helpers ────────────────────────────────────────────────────────

export function isOverlayHighlight(type: HighlightType): boolean {
  return ['red_circle', 'underline_draw', 'arrow', 'magnify'].includes(type);
}

export function isBackdropHighlight(type: HighlightType): boolean {
  return ['blur_except', 'glow_pulse'].includes(type);
}
