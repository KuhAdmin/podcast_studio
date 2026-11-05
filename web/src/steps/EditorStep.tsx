import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import type { ParsedScript } from '../../../shared/script.ts';
import { autoLayout, buildVideoProps, snapPoints } from '../../../shared/timeline.ts';
import { VIDEO, type Clip, type Peaks, type Project, type Timestamps, type VideoSettings } from '../../../shared/types.ts';
import { PodcastVideo } from '../../../video/PodcastVideo.tsx';
import { fileUrl } from '../api.ts';
import { Timeline } from '../components/Timeline.tsx';

interface Props {
  project: Project;
  parsed: ParsedScript;
  timestamps: Timestamps | null;
  peaks: Peaks | null;
  update: (fn: (p: Project) => Project) => void;
  onNext: () => void;
}

export function EditorStep({ project, parsed, timestamps, peaks, update, onNext }: Props) {
  const player = useRef<PlayerRef>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const inputProps = useMemo(() => buildVideoProps(project, timestamps, ''), [project, timestamps]);
  const durationInFrames = Math.max(1, Math.ceil(inputProps.durationInSeconds * VIDEO.fps));
  const points = useMemo(() => (timestamps ? snapPoints(timestamps.lines, timestamps.duration) : []), [timestamps]);
  const images = useMemo(
    () => Object.fromEntries(Object.entries(project.images).map(([scene, file]) => [scene, fileUrl(project.id, `images/${file}`)])),
    [project.images, project.id],
  );

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setTime(e.detail.frame / VIDEO.fps);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('seeked', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    p.addEventListener('ended', onPause);
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('seeked', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
      p.removeEventListener('ended', onPause);
    };
  }, [timestamps]);

  const seek = useCallback((t: number) => {
    player.current?.seekTo(Math.round(t * VIDEO.fps));
    setTime(t);
  }, []);

  const setClips = useCallback((clips: Clip[]) => update((p) => ({ ...p, timeline: { clips } })), [update]);
  const setSetting = <K extends keyof VideoSettings>(key: K, value: VideoSettings[K]) =>
    update((p) => ({ ...p, settings: { ...p.settings, [key]: value } }));

  if (!project.audio || !timestamps) {
    return (
      <div className="page">
        <h1>Timeline & preview</h1>
        <div className="notice notice-warning">Generate the audio first — the timeline is laid out from the voice-over timestamps.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Timeline & preview</h1>
          <p className="muted">Scene cuts are placed at each [SCENE] marker. Drag a clip's edges to adjust a cut, or the clip body to move it.</p>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={onNext}>
          Next: render
        </button>
      </header>

      <div className="editor-top">
        <div className="player-frame">
          <Player
            ref={player}
            component={PodcastVideo}
            inputProps={inputProps}
            durationInFrames={durationInFrames}
            fps={VIDEO.fps}
            compositionWidth={VIDEO.width}
            compositionHeight={VIDEO.height}
            style={{ width: '100%', aspectRatio: '16 / 9' }}
            controls
            clickToPlay
            spaceKeyToPlayOrPause
            acknowledgeRemotionLicense
          />
        </div>

        <aside className="panel stack" aria-labelledby="look-heading">
          <h2 id="look-heading">Look</h2>
          <label className="field">
            Title badge
            <input type="text" value={project.settings.title} placeholder="(none)" onChange={(e) => setSetting('title', e.target.value)} />
          </label>
          <div className="stack" style={{ gap: 0 }}>
            <label className="check">
              <input type="checkbox" checked={project.settings.showWaveform} onChange={(e) => setSetting('showWaveform', e.target.checked)} />
              Waveform
            </label>
            <label className="check">
              <input type="checkbox" checked={project.settings.showSpeaker} onChange={(e) => setSetting('showSpeaker', e.target.checked)} />
              Speaker name
            </label>
            <label className="check">
              <input type="checkbox" checked={project.settings.showCaptions} onChange={(e) => setSetting('showCaptions', e.target.checked)} />
              Captions (highlight spoken words)
            </label>
            <label className="check">
              <input type="checkbox" checked={project.settings.motion !== 'off'} onChange={(e) => setSetting('motion', e.target.checked ? 'subtle' : 'off')} />
              Slow pan & 6% zoom on images
            </label>
          </div>
          <label className="field">
            <span>
              Crossfade <span className="muted">{project.settings.crossfadeSec.toFixed(1)}s</span>
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={project.settings.crossfadeSec}
              onChange={(e) => setSetting('crossfadeSec', Number(e.target.value))}
            />
          </label>
        </aside>
      </div>

      <Timeline
        duration={timestamps.duration}
        clips={project.timeline.clips}
        images={images}
        peaks={peaks}
        snapPoints={points}
        currentTime={time}
        playing={playing}
        onSeek={seek}
        onChange={setClips}
        onAutoLayout={() => setClips(autoLayout(parsed, timestamps))}
      />
    </div>
  );
}
