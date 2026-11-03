/**
 * Camera move animation functions for presenter video shots.
 *
 * Client-side copy of workers/video-renderer/src/remotion/animations/camera.ts.
 * Pure functions — no React hooks or Node.js dependencies.
 */

import { interpolate, Easing, spring } from 'remotion';
import { noise2D } from '@remotion/noise';
import type { CameraMoveType, CameraTransform } from '@/remotion/presenter/types';

/**
 * Organic micro-movement using Perlin noise — replaces sin/cos jitter.
 */
function organicDrift(frame: number, intensity: number = 0.3, seed: string = 'cam'): { x: number; y: number } {
  return {
    x: noise2D(seed + '-x', frame * 0.015, 0) * intensity * 2,
    y: noise2D(seed + '-y', 0, frame * 0.012) * intensity * 1.5,
  };
}

/**
 * Spring physics helper — converts progress (0-1) to a spring-eased value.
 */
function springProgress(progress: number, config?: { damping?: number; stiffness?: number; mass?: number }): number {
  const frame = Math.round(progress * 60);
  return spring({
    frame,
    fps: 60,
    config: {
      damping: config?.damping ?? 120,
      stiffness: config?.stiffness ?? 200,
      mass: config?.mass ?? 0.8,
    },
  });
}

/**
 * Slow-start ease for gentle reveals.
 */
function gentleEase(progress: number): number {
  return Easing.bezier(0.25, 0.1, 0.25, 1.0)(progress);
}

export function kenBurnsSlow(progress: number, frame: number): CameraTransform {
  const eased = gentleEase(progress);
  const drift = organicDrift(frame, 0.25, 'kb');
  return {
    scale: interpolate(eased, [0, 1], [1.0, 1.10], { extrapolateRight: 'clamp' }),
    x: interpolate(eased, [0, 1], [0, -18], { extrapolateRight: 'clamp' }) + drift.x,
    y: interpolate(eased, [0, 1], [0, -12], { extrapolateRight: 'clamp' }) + drift.y,
  };
}

export function punchZoom(progress: number, frame: number, targetX: number = 0, targetY: number = 0): CameraTransform {
  const zoomProgress = Math.min(progress / 0.35, 1);
  const eased = springProgress(zoomProgress, { damping: 80, stiffness: 300, mass: 0.6 });
  const zoomScale = interpolate(eased, [0, 1], [1.0, 2.2], { extrapolateRight: 'clamp' });
  const drift = organicDrift(frame, 0.12, 'pz');
  return {
    scale: zoomScale,
    x: interpolate(eased, [0, 1], [0, -targetX], { extrapolateRight: 'clamp' }) + drift.x,
    y: interpolate(eased, [0, 1], [0, -targetY], { extrapolateRight: 'clamp' }) + drift.y,
  };
}

export function panLeft(progress: number, frame: number): CameraTransform {
  const eased = gentleEase(progress);
  const drift = organicDrift(frame, 0.3, 'pl');
  return {
    scale: 1.15,
    x: interpolate(eased, [0, 1], [80, -80], { extrapolateRight: 'clamp' }) + drift.x,
    y: drift.y,
  };
}

export function panRight(progress: number, frame: number): CameraTransform {
  const eased = gentleEase(progress);
  const drift = organicDrift(frame, 0.3, 'pr');
  return {
    scale: 1.15,
    x: interpolate(eased, [0, 1], [-80, 80], { extrapolateRight: 'clamp' }) + drift.x,
    y: drift.y,
  };
}

export function panDown(progress: number, frame: number): CameraTransform {
  const eased = gentleEase(progress);
  const drift = organicDrift(frame, 0.25, 'pd');
  return {
    scale: 1.15,
    x: drift.x,
    y: interpolate(eased, [0, 1], [0, -160], { extrapolateRight: 'clamp' }) + drift.y,
  };
}

export function zoomOutReveal(progress: number, frame: number): CameraTransform {
  const eased = springProgress(progress, { damping: 100, stiffness: 180, mass: 0.9 });
  const drift = organicDrift(frame, 0.15, 'zr');
  return {
    scale: interpolate(eased, [0, 1], [1.8, 1.0], { extrapolateRight: 'clamp' }),
    x: interpolate(eased, [0, 1], [-40, 0], { extrapolateRight: 'clamp' }) + drift.x,
    y: interpolate(eased, [0, 1], [-25, 0], { extrapolateRight: 'clamp' }) + drift.y,
  };
}

export function shake(progress: number, frame: number): CameraTransform {
  const intensity = interpolate(progress, [0, 0.3, 0.7, 1], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  const shakeX = noise2D('shake-x-lo', frame * 0.08, 0) * 3.5 + noise2D('shake-x-hi', frame * 0.25, 0) * 1.5;
  const shakeY = noise2D('shake-y-lo', 0, frame * 0.07) * 3.0 + noise2D('shake-y-hi', 0, frame * 0.22) * 1.2;
  return {
    scale: 1.05 + noise2D('shake-s', frame * 0.1, 0) * 0.015 * intensity,
    x: shakeX * intensity,
    y: shakeY * intensity,
  };
}

export function tilt3d(progress: number, frame: number): CameraTransform {
  const eased = gentleEase(progress);
  const drift = organicDrift(frame, 0.15, 't3');
  return {
    scale: 1.05,
    x: drift.x,
    y: drift.y,
    rotateX: interpolate(eased, [0, 0.5, 1], [0, 3, 0], { extrapolateRight: 'clamp' }),
    rotateY: interpolate(eased, [0, 0.5, 1], [0, -2, 0], { extrapolateRight: 'clamp' }),
  };
}

export function snapTo(progress: number, frame: number, targetX: number = 0, targetY: number = 0, targetScale: number = 1.5): CameraTransform {
  const snapProgress = Math.min(progress / 0.1, 1);
  const eased = springProgress(snapProgress, { damping: 60, stiffness: 400, mass: 0.5 });
  const drift = organicDrift(frame, 0.1, 'sn');
  return {
    scale: interpolate(eased, [0, 1], [1.0, targetScale]),
    x: interpolate(eased, [0, 1], [0, -targetX]) + drift.x,
    y: interpolate(eased, [0, 1], [0, -targetY]) + drift.y,
  };
}

export function hold(frame: number): CameraTransform {
  const drift = organicDrift(frame, 0.2, 'hd');
  return {
    scale: 1.0 + noise2D('hold-s', frame * 0.008, 0) * 0.003,
    x: drift.x,
    y: drift.y,
  };
}

/**
 * Main dispatch function: given a camera move type, progress, and frame,
 * returns the correct CameraTransform.
 */
export function getCameraTransform(
  moveType: CameraMoveType,
  progress: number,
  frame: number,
  targetX: number = 0,
  targetY: number = 0,
  _startScale?: number,
  endScale?: number,
): CameraTransform {
  switch (moveType) {
    case 'ken_burns_slow': return kenBurnsSlow(progress, frame);
    case 'punch_zoom': return punchZoom(progress, frame, targetX, targetY);
    case 'pan_left': return panLeft(progress, frame);
    case 'pan_right': return panRight(progress, frame);
    case 'pan_down': return panDown(progress, frame);
    case 'zoom_out_reveal': return zoomOutReveal(progress, frame);
    case 'shake': return shake(progress, frame);
    case 'tilt_3d': return tilt3d(progress, frame);
    case 'snap_to': return snapTo(progress, frame, targetX, targetY, endScale ?? 1.5);
    case 'hold': return hold(frame);
    default: return hold(frame);
  }
}
