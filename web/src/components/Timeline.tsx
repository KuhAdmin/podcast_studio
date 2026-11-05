import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { round, snap } from '../../../shared/timeline.ts';
import type { Clip, Peaks } from '../../../shared/types.ts';

const MIN_CLIP_SEC = 0.5;
const SNAP_PX = 8;
const TRACKS = [
  { id: 'images', label: 'Scenes', className: 'track-images' },
  { id: 'audio', label: 'Audio', className: 'track-audio' },
];

interface Props {
  duration: number;
  clips: Clip[];
  /** Scene name -> image URL */
  images: Record<string, string>;
  peaks: Peaks | null;
  snapPoints: number[];
  currentTime: number;
  playing: boolean;
  onSeek: (t: number) => void;
  onChange: (clips: Clip[]) => void;
  onAutoLayout: () => void;
}

type DragMode = 'move' | 'start' | 'end';
interface Drag {
  mode: DragMode;
  clipId: string;
  x0: number;
  original: Clip[];
}

export function Timeline({ duration, clips, images, peaks, snapPoints, currentTime, playing, onSeek, onChange, onAutoLayout }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 800 });
  const [pps, setPps] = useState<number | null>(null); // pixels per second; null = fit to width
  const drag = useRef<Drag | null>(null);
  const [snapping, setSnapping] = useState(true);

  const fitPps = Math.max(2, (viewport.width - 16) / Math.max(duration, 1));
  const scale = pps ?? fitPps;
  const width = Math.max(viewport.width, duration * scale);
  const sorted = useMemo(() => [...clips].sort((a, b) => a.start - b.start), [clips]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setViewport({ left: el.scrollLeft, width: el.clientWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, []);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = currentTime * scale;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 40;
  }, [currentTime, playing, scale]);

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    const rect = el.getBoundingClientRect();
    return Math.min(duration, Math.max(0, (clientX - rect.left + el.scrollLeft) / scale));
  };

  const zoom = (factor: number) => {
    const el = scroller.current;
    const center = el ? (el.scrollLeft + el.clientWidth / 2) / scale : 0;
    const next = Math.min(400, Math.max(fitPps, scale * factor));
    setPps(next);
    requestAnimationFrame(() => {
      if (el) el.scrollLeft = center * next - el.clientWidth / 2;
    });
  };

  const applyDrag = useCallback(
    (clientX: number, noSnap: boolean) => {
      const d = drag.current;
      if (!d) return;
      const dt = (clientX - d.x0) / scale;
      const list = [...d.original].sort((a, b) => a.start - b.start);
      const i = list.findIndex((c) => c.id === d.clipId);
      const c = list[i];
      const prev = list[i - 1];
      const next = list[i + 1];
      const threshold = noSnap || !snapping ? 0 : SNAP_PX / scale;
      const s = (t: number) => (threshold ? snap(t, snapPoints, threshold) : t);
      // Adjacent clips share a cut: dragging that edge moves the neighbour's edge too.
      const joinedPrev = prev && Math.abs(prev.end - c.start) < 0.002;
      const joinedNext = next && Math.abs(next.start - c.end) < 0.002;
      const out = list.map((x) => ({ ...x }));

      if (d.mode === 'move') {
        const len = c.end - c.start;
        const lo = prev ? prev.end : 0;
        const hi = next ? next.start : duration;
        let start = c.start + dt;
        const snappedStart = s(start);
        const snappedEnd = s(start + len);
        start = Math.abs(snappedStart - start) <= Math.abs(snappedEnd - (start + len)) ? snappedStart : snappedEnd - len;
        start = Math.min(Math.max(start, lo), hi - len);
        out[i].start = round(start);
        out[i].end = round(start + len);
      } else if (d.mode === 'start') {
        const lo = joinedPrev ? prev.start + MIN_CLIP_SEC : prev ? prev.end : 0;
        const start = Math.min(Math.max(s(c.start + dt), lo), c.end - MIN_CLIP_SEC);
        out[i].start = round(start);
        if (joinedPrev) out[i - 1].end = round(start);
      } else {
        const hi = joinedNext ? next.end - MIN_CLIP_SEC : next ? next.start : duration;
        const end = Math.max(Math.min(s(c.end + dt), hi), c.start + MIN_CLIP_SEC);
        out[i].end = round(end);
        if (joinedNext) out[i + 1].start = round(end);
      }
      onChange(out);
    },
    [scale, snapping, snapPoints, duration, onChange],
  );

  const beginDrag = (e: React.PointerEvent, clipId: string, mode: DragMode) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, clipId, x0: e.clientX, original: clips };
  };

  const nudge = (clip: Clip, e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1);
    drag.current = { mode: 'move', clipId: clip.id, x0: 0, original: clips };
    applyDrag(step * scale, true);
    drag.current = null;
  };

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-toolbar">
        <button className="btn btn-sm" onClick={() => zoom(1 / 1.5)} aria-label="Zoom out">
          −
        </button>
        <button className="btn btn-sm" onClick={() => setPps(null)}>
          Fit
        </button>
        <button className="btn btn-sm" onClick={() => zoom(1.5)} aria-label="Zoom in">
          +
        </button>
        <label className="check small">
          <input type="checkbox" checked={snapping} onChange={(e) => setSnapping(e.target.checked)} />
          Snap to sentences <span className="muted">(hold Alt to bypass)</span>
        </label>
        <span className="spacer" />
        <span className="mono small muted" aria-live="off">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <button className="btn btn-sm" onClick={onAutoLayout}>
          Auto-layout from scenes
        </button>
      </div>

      <div className="timeline-body">
        <div className="track-labels" aria-hidden>
          <div style={{ height: 29, borderBottom: '1px solid var(--border)' }} />
          {TRACKS.map((t) => (
            <div key={t.id} className={`track-label ${t.className}`} style={{ borderBottom: '1px solid var(--border)' }}>
              {t.label}
            </div>
          ))}
        </div>

        <div className="timeline-scroll" ref={scroller}>
          <div className="timeline-content" style={{ width }}>
            <Ruler duration={duration} scale={scale} viewport={viewport} onSeek={(x) => onSeek(timeAt(x))} />

            <div className="track track-images" onPointerDown={(e) => e.target === e.currentTarget && onSeek(timeAt(e.clientX))}>
              {sorted.map((clip) => {
                const active = currentTime >= clip.start && currentTime < clip.end;
                return (
                  <div
                    key={clip.id}
                    className="clip"
                    role="button"
                    tabIndex={0}
                    aria-label={`Scene ${clip.scene}, ${formatTime(clip.start)} to ${formatTime(clip.end)}. Arrow keys move it.`}
                    data-active={active}
                    data-missing={!images[clip.scene]}
                    style={{
                      left: clip.start * scale,
                      width: Math.max(4, (clip.end - clip.start) * scale),
                      backgroundImage: images[clip.scene] ? `url("${images[clip.scene]}")` : undefined,
                    }}
                    onPointerDown={(e) => beginDrag(e, clip.id, 'move')}
                    onPointerMove={(e) => drag.current && applyDrag(e.clientX, e.altKey)}
                    onPointerUp={() => (drag.current = null)}
                    onDoubleClick={() => onSeek(clip.start)}
                    onKeyDown={(e) => nudge(clip, e)}
                  >
                    <span className="clip-label">
                      {clip.scene}
                      {!images[clip.scene] && ' · no image'}
                    </span>
                    <div className="clip-handle start" onPointerDown={(e) => beginDrag(e, clip.id, 'start')} aria-hidden />
                    <div className="clip-handle end" onPointerDown={(e) => beginDrag(e, clip.id, 'end')} aria-hidden />
                  </div>
                );
              })}
            </div>

            <div className="track track-audio" onPointerDown={(e) => onSeek(timeAt(e.clientX))}>
              <WaveformCanvas peaks={peaks} scale={scale} viewport={viewport} />
            </div>

            <div className="playhead" style={{ left: currentTime * scale }} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Ruler({ duration, scale, viewport, onSeek }: { duration: number; scale: number; viewport: { left: number; width: number }; onSeek: (clientX: number) => void }) {
  // Pick a tick spacing that leaves ~80px between labels.
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * scale >= 80) ?? 600;
  const first = Math.floor(viewport.left / scale / step) * step;
  const last = Math.min(duration, (viewport.left + viewport.width) / scale);
  const ticks: number[] = [];
  for (let t = first; t <= last; t += step) ticks.push(t);
  return (
    <div className="ruler" onPointerDown={(e) => onSeek(e.clientX)}>
      {ticks.map((t) => (
        <span key={t} className="ruler-tick" style={{ left: t * scale }}>
          {formatTime(t)}
        </span>
      ))}
    </div>
  );
}

/** Draws only the visible slice of the waveform, so hour-long audio doesn't need a giant canvas. */
function WaveformCanvas({ peaks, scale, viewport }: { peaks: Peaks | null; scale: number; viewport: { left: number; width: number } }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const w = viewport.width;
    const h = el.parentElement?.clientHeight ?? 96;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    el.style.width = `${w}px`;
    el.style.transform = `translateX(${viewport.left}px)`;
    const ctx = el.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!peaks) return;
    ctx.fillStyle = getComputedStyle(el).getPropertyValue('--accent').trim() || '#f5a524';
    ctx.globalAlpha = 0.75;
    const mid = h / 2;
    const perPx = peaks.peaksPerSecond / scale;
    for (let x = 0; x < w; x += 2) {
      const from = Math.floor((viewport.left + x) / scale * peaks.peaksPerSecond);
      let v = 0;
      for (let k = from; k < from + Math.max(1, perPx * 2); k++) v = Math.max(v, peaks.data[k] ?? 0);
      const bar = Math.max(1, v * (h / 2 - 6));
      ctx.fillRect(x, mid - bar, 1.5, bar * 2);
    }
  }, [peaks, scale, viewport]);

  return <canvas ref={canvas} className="waveform-canvas" aria-hidden />;
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
