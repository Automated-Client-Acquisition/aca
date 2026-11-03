/**
 * Transition presentation factories for Remotion TransitionSeries.
 *
 * Ported from workers/video-renderer/src/remotion/animations/transitions.tsx.
 * Maps transition type names to Remotion TransitionPresentation objects.
 *
 * Pure functions — no Node.js-specific dependencies.
 */

import React from 'react';
import { linearTiming } from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { fade } from '@remotion/transitions/fade';
import type { TransitionPresentation } from '@remotion/transitions';
import type { TransitionType } from '@/remotion/presenter/types';

// ─── Transition Presentations ────────────────────────────────────────────────

export function slideLeftPresentation(): TransitionPresentation<Record<string, unknown>> {
  return slide({ direction: 'from-right' });
}

export function slideUpPresentation(): TransitionPresentation<Record<string, unknown>> {
  return slide({ direction: 'from-bottom' });
}

export function crossfadePresentation(): TransitionPresentation<Record<string, unknown>> {
  return fade();
}

const ZoomPresentation: React.FC<{
  children: React.ReactNode;
  presentationDirection: 'entering' | 'exiting';
  presentationProgress: number;
}> = ({ children, presentationDirection, presentationProgress }) => {
  const isEntering = presentationDirection === 'entering';
  const scale = isEntering
    ? 0.5 + presentationProgress * 0.5
    : 1 + presentationProgress * 0.5;
  const opacity = isEntering ? presentationProgress : 1 - presentationProgress;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      {children}
    </div>
  );
};

export function zoomPresentation(): TransitionPresentation<Record<string, unknown>> {
  return { component: ZoomPresentation, props: {} } as any;
}

const SlamZoomPresentation: React.FC<{
  children: React.ReactNode;
  presentationDirection: 'entering' | 'exiting';
  presentationProgress: number;
}> = ({ children, presentationDirection, presentationProgress }) => {
  const isEntering = presentationDirection === 'entering';
  const scale = isEntering
    ? 3 - presentationProgress * 2
    : 1 + presentationProgress * 2;
  const opacity = isEntering ? presentationProgress : 1 - presentationProgress;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      {children}
    </div>
  );
};

export function slamZoomPresentation(): TransitionPresentation<Record<string, unknown>> {
  return { component: SlamZoomPresentation, props: {} } as any;
}

const SnapCutPresentation: React.FC<{
  children: React.ReactNode;
  presentationDirection: 'entering' | 'exiting';
  presentationProgress: number;
}> = ({ children, presentationDirection, presentationProgress }) => {
  const isEntering = presentationDirection === 'entering';
  const opacity = isEntering
    ? (presentationProgress > 0.5 ? 1 : 0)
    : (presentationProgress > 0.5 ? 0 : 1);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        opacity,
      }}
    >
      {children}
    </div>
  );
};

export function snapCutPresentation(): TransitionPresentation<Record<string, unknown>> {
  return { component: SnapCutPresentation, props: {} } as any;
}

export function whooshPresentation(): TransitionPresentation<Record<string, unknown>> {
  return slide({ direction: 'from-right' });
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Get the Remotion TransitionPresentation for a given TransitionType.
 * Returns null for 'cut_hard' (no transition — TransitionSeries handles this
 * by simply not inserting a Transition element).
 */
export function getTransitionPresentation(
  type: TransitionType,
): TransitionPresentation<Record<string, unknown>> | null {
  switch (type) {
    case 'cut_hard':
      return null;
    case 'slide_left':
      return slideLeftPresentation();
    case 'slide_up':
      return slideUpPresentation();
    case 'fade':
    case 'crossfade':
      return crossfadePresentation();
    case 'zoom':
      return zoomPresentation();
    case 'slam_zoom':
      return slamZoomPresentation();
    case 'snap_cut':
      return snapCutPresentation();
    case 'whoosh':
      return whooshPresentation();
    default:
      return crossfadePresentation();
  }
}

/**
 * Get the default duration in frames for a transition type.
 */
export function getDefaultTransitionDuration(type: TransitionType): number {
  switch (type) {
    case 'cut_hard':
      return 0;
    case 'snap_cut':
      return 2;
    case 'slam_zoom':
      return 4;
    case 'whoosh':
      return 5;
    case 'slide_left':
    case 'slide_up':
      return 8;
    case 'fade':
    case 'crossfade':
      return 10;
    case 'zoom':
      return 8;
    default:
      return 6;
  }
}
