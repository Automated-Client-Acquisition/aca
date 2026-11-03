import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { StoryboardVideo } from './StoryboardVideo.js';
import { DynamicVideo } from './DynamicVideo.js';
import { AcaViralVideo } from './layouts/AcaViralVideo.js';
import { getResolution, parseRemotionCodeMeta } from '../types.js';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="StoryboardVideo"
        component={StoryboardVideo as any}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{} as any}
        calculateMetadata={async ({ props }: { props: any }) => {
          const res = getResolution(props.aspect_ratio, props.resolution, props.fps);
          const totalDuration = (props.clips || []).reduce((sum: number, c: any) => sum + (c.duration || 5), 0);
          return {
            durationInFrames: Math.ceil(totalDuration * res.fps),
            fps: res.fps,
            width: res.width,
            height: res.height,
          };
        }}
      />
      <Composition
        id="AcaViralVideo"
        component={AcaViralVideo}
        durationInFrames={2250}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
      <Composition
        id="DynamicVideo"
        component={DynamicVideo as any}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ remotion_code: '' } as any}
        calculateMetadata={async ({ props }: { props: any }) => {
          const code = props.remotion_code || '';
          const meta = parseRemotionCodeMeta(code);
          const res = getResolution(
            props.aspect_ratio || 'portrait',
            props.resolution,
            props.fps,
          );
          return {
            durationInFrames: meta.durationInFrames || Math.ceil(60 * res.fps),
            fps: meta.fps || res.fps,
            width: meta.width || res.width,
            height: meta.height || res.height,
          };
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
