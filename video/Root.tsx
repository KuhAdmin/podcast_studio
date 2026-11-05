import { Composition } from 'remotion';
import type { PodcastVideoProps } from '../shared/timeline.ts';
import { DEFAULT_SETTINGS, VIDEO } from '../shared/types.ts';
import { PodcastVideo } from './PodcastVideo.tsx';

const defaultProps: PodcastVideoProps = {
  audioSrc: null,
  peaksSrc: null,
  durationInSeconds: 10,
  clips: [],
  speakers: [],
  captions: [],
  settings: DEFAULT_SETTINGS,
};

export const Root: React.FC = () => (
  <Composition
    id="PodcastVideo"
    component={PodcastVideo}
    width={VIDEO.width}
    height={VIDEO.height}
    fps={VIDEO.fps}
    durationInFrames={VIDEO.fps * 10}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.ceil(props.durationInSeconds * VIDEO.fps)) })}
  />
);
