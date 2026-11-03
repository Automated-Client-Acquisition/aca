/**
 * Ken Burns camera move animations for storyboard scene images.
 *
 * Shared between VideoEditorComposition (client preview)
 * and StoryboardVideoComposition (client preview).
 * The worker-side compositions have their own copy.
 */

import { interpolate } from 'remotion';

export type CameraMoveType =
  | 'ken_burns_slow'
  | 'ken_burns_fast'
  | 'punch_zoom'
  | 'pan_left'
  | 'pan_right'
  | 'tilt_up'
  | 'tilt_down'
  | 'static';

/**
 * Returns a CSS style object with the Ken Burns / camera move transform.
 *
 * @param frame - current frame within the scene
 * @param durationInFrames - total frames for this scene
 * @param cameraMove - the animation type to apply
 */
export function getKenBurnsStyle(
  frame: number,
  durationInFrames: number,
  cameraMove: string = 'ken_burns_slow',
): React.CSSProperties {
  const progress = durationInFrames > 0 ? frame / durationInFrames : 0;

  switch (cameraMove) {
    case 'ken_burns_slow': {
      const scale = interpolate(progress, [0, 1], [1, 1.15]);
      const translateX = interpolate(progress, [0, 1], [0, -2]);
      const translateY = interpolate(progress, [0, 1], [0, -1]);
      return { transform: `scale(${scale}) translate(${translateX}%, ${translateY}%)` };
    }
    case 'ken_burns_fast': {
      const scale = interpolate(progress, [0, 1], [1, 1.3]);
      const translateX = interpolate(progress, [0, 1], [0, -3]);
      return { transform: `scale(${scale}) translate(${translateX}%, 0%)` };
    }
    case 'punch_zoom': {
      const scale = interpolate(progress, [0, 0.3, 1], [1, 1.2, 1.05]);
      return { transform: `scale(${scale})` };
    }
    case 'pan_left': {
      const translateX = interpolate(progress, [0, 1], [5, -5]);
      return { transform: `scale(1.1) translateX(${translateX}%)` };
    }
    case 'pan_right': {
      const translateX = interpolate(progress, [0, 1], [-5, 5]);
      return { transform: `scale(1.1) translateX(${translateX}%)` };
    }
    case 'tilt_up': {
      const translateY = interpolate(progress, [0, 1], [5, -5]);
      return { transform: `scale(1.1) translateY(${translateY}%)` };
    }
    case 'tilt_down': {
      const translateY = interpolate(progress, [0, 1], [-5, 5]);
      return { transform: `scale(1.1) translateY(${translateY}%)` };
    }
    case 'static':
    default:
      return { transform: 'scale(1)' };
  }
}
