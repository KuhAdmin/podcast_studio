import { useEffect, useMemo, useState } from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  Img,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { cameraAt } from '../shared/camera.ts';
import type { PodcastVideoProps, SpeakerSpan } from '../shared/timeline.ts';
import type { CaptionCue } from '../shared/captions.ts';
import type { MotionLevel, Peaks } from '../shared/types.ts';

const ACCENT = '#f5a524';

export const PodcastVideo: React.FC<PodcastVideoProps> = ({ audioSrc, peaksSrc, clips, speakers, captions, settings }) => {
  const { fps } = useVideoConfig();
  const fade = Math.max(0, Math.round(settings.crossfadeSec * fps));
  // Anything but 'off' (including older saved values) means the slow zoom and pan.
  const motion: MotionLevel = settings.motion === 'off' ? 'off' : 'subtle';

  return (
    <AbsoluteFill style={{ backgroundColor: '#0d0d0f', fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif' }}>
      {clips.map((clip, i) => {
        const startFrame = Math.round(clip.start * fps);
        const endFrame = Math.round(clip.end * fps);
        // Each clip after the first starts `fade` frames early and fades in over the previous one.
        const lead = i === 0 ? 0 : Math.min(fade, startFrame);
        return (
          <Sequence key={`${clip.src}-${i}`} from={startFrame - lead} durationInFrames={Math.max(1, endFrame - startFrame + lead)} layout="absolute-fill">
            <SceneImage src={clip.src} fromFrame={startFrame - lead} fadeFrames={lead} index={i} motion={motion} />
          </Sequence>
        );
      })}

      {/* Scrim keeps the waveform and labels readable on bright images. */}
      {(settings.showWaveform || settings.showSpeaker || settings.title) && (
        <AbsoluteFill style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 38%)' }} />
      )}

      {settings.title && <Title text={settings.title} />}
      {settings.showSpeaker && <SpeakerLabel speakers={speakers} />}
      {settings.showCaptions !== false && captions?.length > 0 && <Captions cues={captions} />}
      {settings.showWaveform && peaksSrc && <Waveform peaksSrc={peaksSrc} />}
      {audioSrc && <Html5Audio src={audioSrc} />}
    </AbsoluteFill>
  );
};

const SceneImage: React.FC<{ src: string; fromFrame: number; fadeFrames: number; index: number; motion: MotionLevel }> = ({
  src,
  fromFrame,
  fadeFrames,
  index,
  motion,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = fadeFrames > 0 ? interpolate(frame, [0, fadeFrames], [0, 1], { extrapolateRight: 'clamp' }) : 1;
  const cam = cameraAt({ t: (fromFrame + frame) / fps, clipIndex: index, motion });

  return (
    <AbsoluteFill style={{ opacity, overflow: 'hidden' }}>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${cam.scale}) translate(${cam.x}%, ${cam.y}%)`,
          willChange: 'transform',
        }}
      />
    </AbsoluteFill>
  );
};

const Title: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      position: 'absolute',
      top: 48,
      left: 64,
      padding: '10px 22px',
      borderRadius: 999,
      background: 'rgba(0,0,0,0.45)',
      color: '#fff',
      fontSize: 30,
      fontWeight: 600,
      letterSpacing: 0.3,
    }}
  >
    {text}
  </div>
);

/** Speaker of the current line; holds through short pauses so the label doesn't flicker between lines. */
function activeSpeaker(speakers: SpeakerSpan[], t: number): SpeakerSpan | null {
  let last: SpeakerSpan | null = null;
  for (const s of speakers) {
    if (s.start > t) break;
    last = s;
  }
  if (!last) return null;
  return t <= last.end + 1.5 ? last : null;
}

const SpeakerLabel: React.FC<{ speakers: SpeakerSpan[] }> = ({ speakers }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const span = activeSpeaker(speakers, t);
  if (!span) return null;
  const opacity = interpolate(t, [span.start, span.start + 0.25], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 64, bottom: 220, display: 'flex', alignItems: 'center', gap: 16, opacity }}>
      <div style={{ width: 8, height: 44, borderRadius: 4, background: ACCENT }} />
      <div style={{ color: '#fff', fontSize: 44, fontWeight: 700, textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>{span.speaker}</div>
    </div>
  );
};

function usePeaks(src: string): Peaks | null {
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [handle] = useState(() => delayRender(`Loading waveform ${src}`));
  useEffect(() => {
    let cancelled = false;
    fetch(src)
      .then((r) => r.json())
      .then((p: Peaks) => !cancelled && setPeaks(p))
      .catch((err) => console.error('Waveform peaks failed to load', err))
      .finally(() => continueRender(handle));
    return () => {
      cancelled = true;
    };
  }, [src, handle]);
  return peaks;
}

const BARS = 96;
const WINDOW_SEC = 6;

/** Scrolling amplitude strip centred on the playhead: played audio on the left, upcoming on the right. */
const Waveform: React.FC<{ peaksSrc: string }> = ({ peaksSrc }) => {
  const peaks = usePeaks(peaksSrc);
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;

  const bars = useMemo(() => {
    if (!peaks) return [];
    const perBar = (WINDOW_SEC * peaks.peaksPerSecond) / BARS;
    const first = (t - WINDOW_SEC / 2) * peaks.peaksPerSecond;
    return Array.from({ length: BARS }, (_, b) => {
      const from = Math.floor(first + b * perBar);
      let v = 0;
      for (let k = from; k < from + perBar; k++) v = Math.max(v, peaks.data[k] ?? 0);
      return v;
    });
  }, [peaks, t]);

  const stripWidth = width - 128;
  const barGap = 6;
  const barWidth = stripWidth / BARS - barGap;
  const maxHeight = 120;

  return (
    <div style={{ position: 'absolute', left: 64, bottom: 64, width: stripWidth, height: maxHeight, display: 'flex', alignItems: 'center', gap: barGap }}>
      {bars.map((v, i) => (
        <div
          key={i}
          style={{
            width: barWidth,
            height: Math.max(4, v * maxHeight),
            borderRadius: barWidth / 2,
            background: i < BARS / 2 ? ACCENT : 'rgba(255,255,255,0.45)',
          }}
        />
      ))}
    </div>
  );
};

function activeCue(cues: CaptionCue[], t: number): CaptionCue | null {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const cue = cues[found];
  return cue && t < cue.end ? cue : null;
}

/** The sentence being spoken, centred above the speaker name; words turn amber as they are said. */
const Captions: React.FC<{ cues: CaptionCue[] }> = ({ cues }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cue = activeCue(cues, t);
  if (!cue) return null;
  const opacity = interpolate(t, [cue.start, cue.start + 0.15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 280, display: 'flex', justifyContent: 'center', opacity }}>
      <div
        style={{
          maxWidth: 1500,
          padding: '14px 30px',
          borderRadius: 18,
          background: 'rgba(0, 0, 0, 0.55)',
          color: 'rgba(255, 255, 255, 0.85)',
          fontSize: 52,
          fontWeight: 700,
          lineHeight: 1.3,
          textAlign: 'center',
          textShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }}
      >
        {cue.words.map((w, i) => (
          <span key={i} style={{ color: t >= w.start ? ACCENT : undefined }}>
            {i > 0 ? ' ' : ''}
            {w.text}
          </span>
        ))}
      </div>
    </div>
  );
};
