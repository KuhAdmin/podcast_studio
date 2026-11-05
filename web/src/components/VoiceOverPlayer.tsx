import { useEffect, useRef, useState } from 'react';

export interface PlayerLine {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

interface Props {
  src: string;
  duration: number;
  /** Optional per-line timings, used to show who is speaking and what they say. */
  lines?: PlayerLine[];
  downloadName: string;
}

/** Play/pause, seek and "now speaking" for the generated voice-over. */
export function VoiceOverPlayer({ src, duration, lines = [], downloadName }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [failed, setFailed] = useState(false);

  // A new take means a new file: stop and rewind.
  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setFailed(false);
  }, [src]);

  const toggle = async () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      try {
        await el.play();
      } catch {
        setFailed(true);
      }
    } else {
      el.pause();
    }
  };

  const seek = (t: number) => {
    if (audio.current) audio.current.currentTime = t;
    setTime(t);
  };

  const current = [...lines].reverse().find((l) => l.start <= time + 0.05);
  const total = duration || audio.current?.duration || 0;

  return (
    <div className="vo-player">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onError={() => setFailed(true)}
      />
      <button className="vo-play" onClick={toggle} aria-label={playing ? 'Pause voice-over' : 'Play voice-over'}>
        {playing ? (
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
          </svg>
        )}
      </button>

      <div className="vo-body">
        <div className="vo-meta">
          <span className="vo-now">
            {failed ? (
              <span className="muted">The audio file could not be played.</span>
            ) : current ? (
              <>
                <strong>{current.speaker}</strong>
                <span className="muted"> — {current.text}</span>
              </>
            ) : (
              <span className="muted">{playing ? 'Playing…' : 'Press play to listen'}</span>
            )}
          </span>
          <span className="mono small muted">
            {fmt(time)} / {fmt(total)}
          </span>
        </div>
        <input
          type="range"
          className="vo-seek"
          min={0}
          max={total || 1}
          step={0.1}
          value={Math.min(time, total || 1)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek voice-over"
          aria-valuetext={`${fmt(time)} of ${fmt(total)}`}
        />
      </div>

      <a className="btn btn-sm btn-ghost" href={src} download={downloadName}>
        Download MP3
      </a>
    </div>
  );
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
