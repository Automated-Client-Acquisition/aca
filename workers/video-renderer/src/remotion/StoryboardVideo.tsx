import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { CaptionLayer } from './components/CaptionLayer.js';
import { getCameraTransform } from './animations/camera.js';
import type { RenderInput, ClipData } from '../types.js';
import { getResolution } from '../types.js';

const TRANSITION_FRAMES = 8; // ~0.27s transition between clips

/**
 * Main composition: sequences clips (video, image, color) with transitions,
 * overlays voiceover audio, and renders animated captions.
 */
export const StoryboardVideo: React.FC<RenderInput> = (props) => {
  const { clips, audio_url, word_timestamps, aspect_ratio, caption_style, brand, background_music_url, background_music_volume, sound_effects } = props;
  const { fps } = getResolution(aspect_ratio, props.resolution, props.fps);

  // Sort clips by scene number
  const sortedClips = [...clips].sort((a, b) => a.scene_number - b.scene_number);

  // Calculate frame durations for each clip
  const clipFrames = sortedClips.map(c => Math.round((c.duration || 5) * fps));

  // Per-clip transition (falls back to alternating fade/slide)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getTransition = (clip: ClipData, index: number): any => {
    switch (clip.transition) {
      case 'fade': return fade();
      case 'slide': return slide({ direction: 'from-right' });
      case 'wipe': return wipe({ direction: 'from-left' });
      case 'none': return undefined;
      default: return index % 2 === 0 ? fade() : slide({ direction: 'from-right' });
    }
  };

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Clips with transitions */}
      <TransitionSeries>
        {sortedClips.map((clip, i) => {
          const transition = i > 0 ? getTransition(clip, i) : undefined;
          return (
            <React.Fragment key={clip.scene_number}>
              {i > 0 && transition && (
                <TransitionSeries.Transition
                  presentation={transition}
                  timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
                />
              )}
              <TransitionSeries.Sequence durationInFrames={clipFrames[i]}>
                <ClipRenderer clip={clip} />
              </TransitionSeries.Sequence>
            </React.Fragment>
          );
        })}
      </TransitionSeries>

      {/* Voiceover audio - replaces all clip audio */}
      {audio_url && (
        <Audio src={audio_url} volume={1.0} />
      )}

      {/* Background music */}
      {background_music_url && (
        <Audio src={background_music_url} volume={background_music_volume ?? 0.1} />
      )}

      {/* Sound effects at specific timestamps */}
      {sound_effects?.map((sfx, i) => (
        <Sequence
          key={`sfx-${i}`}
          from={Math.round(sfx.timestamp * fps)}
          durationInFrames={Math.round(sfx.duration * fps)}
        >
          <Audio src={sfx.url} volume={sfx.volume ?? 0.7} />
        </Sequence>
      ))}

      {/* Animated captions */}
      {caption_style && caption_style !== 'none' && word_timestamps && word_timestamps.length > 0 && (
        <CaptionLayer
          words={word_timestamps}
          style={caption_style}
          brand={brand}
          fps={fps}
        />
      )}
    </AbsoluteFill>
  );
};

/** Renders a single clip - handles video, image, and color media types */
const ClipRenderer: React.FC<{ clip: ClipData }> = ({ clip }) => {
  return (
    <AbsoluteFill>
      {/* Video media */}
      {clip.media_type === 'video' && clip.url && (
        <OffthreadVideo
          src={clip.url}
          crossOrigin="anonymous"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          volume={0}
        />
      )}

      {/* Image media with Ken Burns animation */}
      {clip.media_type === 'image' && clip.url && (
        <KenBurnsImage src={clip.url} />
      )}

      {/* Solid color background */}
      {clip.media_type === 'color' && (
        <AbsoluteFill style={{ backgroundColor: clip.url || '#1a1a2e' }} />
      )}

      {/* Fallback for missing media */}
      {!clip.url && clip.media_type !== 'color' && (
        <AbsoluteFill style={{ backgroundColor: '#1a1a2e' }} />
      )}

      {/* Text overlay */}
      {clip.text?.content && (
        <ClipTextOverlay text={clip.text} />
      )}
    </AbsoluteFill>
  );
};

/** Image with Ken Burns (slow zoom + drift) animation */
const KenBurnsImage: React.FC<{ src: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = durationInFrames > 0 ? frame / durationInFrames : 0;
  const camera = getCameraTransform('ken_burns_slow', progress, frame);

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <Img
        src={src}
        crossOrigin="anonymous"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${camera.scale}) translate(${camera.x}px, ${camera.y}px)`,
        }}
      />
    </div>
  );
};

/** Simple text overlay with spring entrance animation */
const ClipTextOverlay: React.FC<{ text: NonNullable<ClipData['text']> }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const animProgress = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.5 },
  });

  const opacity = interpolate(animProgress, [0, 1], [0, 1]);
  const translateY = interpolate(animProgress, [0, 1], [20, 0]);

  const positionStyles: Record<string, React.CSSProperties> = {
    top: { justifyContent: 'flex-start', paddingTop: 80 },
    center: { justifyContent: 'center' },
    bottom: { justifyContent: 'flex-end', paddingBottom: 100 },
  };

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        ...positionStyles[text.position] || positionStyles.bottom,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          padding: '12px 24px',
          backgroundColor: text.backgroundColor || 'rgba(0,0,0,0.6)',
          borderRadius: 8,
          maxWidth: '80%',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            fontSize: text.fontSize,
            color: text.color,
            fontWeight: 700,
            fontFamily: 'Arial, sans-serif',
          }}
        >
          {text.content}
        </span>
      </div>
    </AbsoluteFill>
  );
};
