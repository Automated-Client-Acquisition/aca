/**
 * AudioMixer — Multi-track audio component.
 *
 * Combines voiceover, background music, and SFX into the composition.
 * Each audio source gets its own volume control.
 *
 * Pure React — no Node.js-specific code.
 */

import React from 'react';
import { Audio, Sequence } from 'remotion';
import type { AudioTrack, SoundEffectType } from '../types.js';

interface AudioMixerProps {
  voiceoverUrl?: string;
  voiceoverVolume?: number;
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number;
  audioTracks?: AudioTrack[];
}

export const AudioMixer: React.FC<AudioMixerProps> = ({
  voiceoverUrl,
  voiceoverVolume = 1.0,
  backgroundMusicUrl,
  backgroundMusicVolume = 0.10,
  audioTracks = [],
}) => {
  return (
    <>
      {/* Primary voiceover — spans full composition */}
      {voiceoverUrl && (
        <Audio
          src={voiceoverUrl}
          volume={voiceoverVolume}
        />
      )}

      {/* Background music — continuous loop */}
      {backgroundMusicUrl && (
        <Audio
          src={backgroundMusicUrl}
          volume={backgroundMusicVolume}
          loop
        />
      )}

      {/* Additional audio tracks with individual timing */}
      {audioTracks.map((track) => (
        <Sequence
          key={track.id}
          from={track.startFrame}
          durationInFrames={track.durationFrames}
        >
          <Audio
            src={track.url}
            volume={track.volume}
          />
        </Sequence>
      ))}
    </>
  );
};

// ─── Sound Effect Helper ─────────────────────────────────────────────────────

interface SoundEffectProps {
  type: SoundEffectType;
  volume?: number;
}

/**
 * Single sound effect component.
 * Plays a sound effect from the built-in SFX library.
 *
 * Note: In production, SFX files should be hosted on a CDN or
 * included as static files in the Remotion bundle. For now, this
 * uses a URL pattern that maps to the SFX directory.
 */
export const SoundEffect: React.FC<SoundEffectProps> = ({
  type,
  volume = 0.6,
}) => {
  // SFX URL pattern — these will be hosted externally or as static files.
  // In the Remotion bundle, use staticFile() for local files.
  // For server-side rendering, SFX URLs should be absolute.
  const sfxUrl = getSfxUrl(type);

  if (!sfxUrl) return null;

  return <Audio src={sfxUrl} volume={volume} />;
};

/**
 * Map sound effect type to a hosted URL.
 * SFX files are stored in Supabase Storage under content-media/sfx/. The base is
 * ACA_ASSETS_URL (passed in by render.ts as a Remotion env variable), defaulting to
 * ACA Cloud's public bucket so any install can play them.
 */
const DEFAULT_ASSETS_URL = 'https://neqyerjlcrxjsgkhxalx.supabase.co/storage/v1/object/public';

const SFX_FILES: Record<SoundEffectType, string> = {
  whoosh: 'whoosh.wav',
  pop: 'pop.wav',
  click: 'click.wav',
  ding: 'ding.wav',
  boom: 'boom.wav',
  record_scratch: 'record_scratch.wav',
  cash_register: 'cash_register.wav',
  typing: 'typing.wav',
};

function getSfxUrl(type: SoundEffectType): string | null {
  const file = SFX_FILES[type];
  if (!file) return null;
  const base = (process.env.ACA_ASSETS_URL || DEFAULT_ASSETS_URL).replace(/\/+$/, '');
  return `${base}/content-media/sfx/${file}`;
}
