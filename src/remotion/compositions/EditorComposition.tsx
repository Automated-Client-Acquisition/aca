/**
 * EditorComposition — Track-based Remotion composition for inline preview.
 *
 * Renders EditorState (assets + tracks) into a layered Remotion composition.
 * Used by @remotion/player in MultiStageDetailPanel for previewing
 * track-based video compositions before sending to the render worker.
 */

import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  Img,
  Video,
  Audio,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from 'remotion';
import type {
  EditorState,
  Track,
  Item,
  VideoItem,
  ImageItem,
  TextItem,
  SolidItem,
  AudioItem,
  CaptionsItem,
  OverlayItem,
  Asset,
} from '@/lib/editorState';

export type EditorCompositionProps = EditorState;

export const EditorComposition: React.FC<EditorCompositionProps> = ({
  assets,
  tracks,
  brand,
}) => {
  const visibleTracks = tracks.filter((t) => !t.hidden);

  return (
    <AbsoluteFill style={{ backgroundColor: brand.background_color }}>
      {visibleTracks.map((track, trackIndex) => (
        <TrackLayer
          key={track.name + trackIndex}
          track={track}
          assets={assets}
          brand={brand}
        />
      ))}
    </AbsoluteFill>
  );
};

interface TrackLayerProps {
  track: Track;
  assets: Asset[];
  brand: EditorState['brand'];
}

const TrackLayer: React.FC<TrackLayerProps> = ({ track, assets, brand }) => {
  if (track.muted && track.items.every((i) => i.type === 'audio')) return null;

  return (
    <>
      {track.items.map((item) => (
        <Sequence
          key={item.id}
          from={item.from}
          durationInFrames={item.durationInFrames}
          layout="none"
        >
          <ItemRenderer item={item} assets={assets} brand={brand} muted={track.muted} />
        </Sequence>
      ))}
    </>
  );
};

interface ItemRendererProps {
  item: Item;
  assets: Asset[];
  brand: EditorState['brand'];
  muted: boolean;
}

const ItemRenderer: React.FC<ItemRendererProps> = ({ item, assets, brand, muted }) => {
  switch (item.type) {
    case 'video':
      return <VideoItemRenderer item={item} assets={assets} muted={muted} />;
    case 'image':
      return <ImageItemRenderer item={item} assets={assets} />;
    case 'text':
      return <TextItemRenderer item={item} brand={brand} />;
    case 'solid':
      return <SolidItemRenderer item={item} />;
    case 'audio':
      return <AudioItemRenderer item={item} assets={assets} muted={muted} />;
    case 'captions':
      return <CaptionsItemRenderer item={item} assets={assets} brand={brand} />;
    case 'overlay':
      return <OverlayItemRenderer item={item} />;
    default:
      return null;
  }
};

const VideoItemRenderer: React.FC<{ item: VideoItem; assets: Asset[]; muted: boolean }> = ({
  item,
  assets,
  muted,
}) => {
  const asset = assets.find((a) => a.id === item.assetId);
  if (!asset || asset.type !== 'video') return null;

  return (
    <Video
      src={asset.src}
      style={{
        position: 'absolute',
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        objectFit: 'cover',
      }}
      startFrom={item.trimStartFrames}
      endAt={item.trimEndFrames || undefined}
      playbackRate={item.playbackRate || 1}
      volume={muted ? 0 : item.volume}
    />
  );
};

const ImageItemRenderer: React.FC<{ item: ImageItem; assets: Asset[] }> = ({ item, assets }) => {
  const asset = assets.find((a) => a.id === item.assetId);
  if (!asset || asset.type !== 'image') return null;

  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = item.durationInFrames > 0 ? frame / item.durationInFrames : 0;

  let scale = 1;
  if (item.camera?.move === 'ken_burns_slow') {
    const start = item.camera.startScale ?? 1;
    const end = item.camera.endScale ?? 1.15;
    scale = interpolate(progress, [0, 1], [start, end], { extrapolateRight: 'clamp' });
  } else if (item.camera?.move === 'punch_zoom') {
    scale = interpolate(progress, [0, 0.5, 1], [1, 1.3, 1], { extrapolateRight: 'clamp' });
  }

  return (
    <Img
      src={asset.src}
      style={{
        position: 'absolute',
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        objectFit: 'cover',
        transform: `scale(${scale})`,
      }}
    />
  );
};

const TextItemRenderer: React.FC<{ item: TextItem; brand: EditorState['brand'] }> = ({
  item,
  brand,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  let opacity = 1;
  if (item.textAnimation === 'spring_fade') {
    opacity = spring({ frame, fps, config: { damping: 20 } });
  } else {
    opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  }

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 60,
        opacity,
      }}
    >
      <div
        style={{
          color: item.color || brand.text_color,
          fontSize: item.fontSize || 48,
          fontWeight: item.fontWeight || 700,
          fontFamily: item.fontFamily || brand.font_family,
          lineHeight: item.lineHeight || 1.3,
          letterSpacing: item.letterSpacing,
          textAlign: item.textAlign || 'center',
          maxWidth: '90%',
        }}
      >
        {item.text}
      </div>
    </AbsoluteFill>
  );
};

const SolidItemRenderer: React.FC<{ item: SolidItem }> = ({ item }) => (
  <div
    style={{
      position: 'absolute',
      left: item.x,
      top: item.y,
      width: item.width,
      height: item.height,
      backgroundColor: item.color,
    }}
  />
);

const AudioItemRenderer: React.FC<{ item: AudioItem; assets: Asset[]; muted: boolean }> = ({
  item,
  assets,
  muted,
}) => {
  const asset = assets.find((a) => a.id === item.assetId);
  if (!asset || asset.type !== 'audio' || muted) return null;

  return <Audio src={asset.src} volume={item.volume} />;
};

const CaptionsItemRenderer: React.FC<{
  item: CaptionsItem;
  assets: Asset[];
  brand: EditorState['brand'];
}> = ({ item, assets, brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const asset = assets.find((a) => a.id === item.assetId);
  if (!asset || asset.type !== 'caption') return null;

  const currentTimeSec = frame / fps;
  const activeWords = asset.wordTimestamps.filter(
    (w) => currentTimeSec >= w.start && currentTimeSec <= w.end,
  );

  if (activeWords.length === 0) return null;

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: 120,
      }}
    >
      <div
        style={{
          color: brand.text_color,
          fontSize: 42,
          fontWeight: 700,
          fontFamily: brand.font_family,
          textAlign: 'center',
          textShadow: '0 2px 8px rgba(0,0,0,0.8)',
          padding: '8px 24px',
        }}
      >
        {activeWords.map((w) => w.word).join(' ')}
      </div>
    </AbsoluteFill>
  );
};

const OverlayItemRenderer: React.FC<{ item: OverlayItem }> = ({ item }) => {
  if (item.overlayType === 'vignette') {
    return (
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${item.intensity}) 100%)`,
          pointerEvents: 'none',
        }}
      />
    );
  }

  if (item.overlayType === 'letterbox') {
    const barHeight = `${item.intensity * 15}%`;
    return (
      <>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: barHeight, backgroundColor: '#000' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: barHeight, backgroundColor: '#000' }} />
      </>
    );
  }

  return null;
};
