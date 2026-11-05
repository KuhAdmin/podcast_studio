import { buildCaptions, type CaptionCue } from './captions.ts';
import { parseScript, type ParsedScript } from './script.ts';
import type { Clip, LineTiming, Project, Timestamps, VideoSettings } from './types.ts';

/**
 * One clip per [SCENE] marker. A scene starts where its first line starts (the first scene starts at 0)
 * and ends where the next scene starts (the last scene ends at the end of the audio).
 */
export function autoLayout(parsed: ParsedScript, timestamps: Timestamps): Clip[] {
  const { duration, lines } = timestamps;
  const starts = parsed.scenes
    .filter((s) => s.firstLineIndex < lines.length)
    .map((s, i) => ({ scene: s.name, start: i === 0 ? 0 : lines[s.firstLineIndex].start }));

  // Merge consecutive occurrences of the same scene so they read as one clip.
  const merged = starts.filter((s, i) => i === 0 || s.scene !== starts[i - 1].scene);

  return merged.map((s, i) => ({
    id: `clip-${i}-${s.scene}`,
    scene: s.scene,
    start: round(s.start),
    end: round(i + 1 < merged.length ? merged[i + 1].start : duration),
  }));
}

/** Sentence boundaries the timeline snaps to: every line's start and end, plus 0 and the audio end. */
export function snapPoints(lines: LineTiming[], duration: number): number[] {
  const pts = new Set<number>([0, round(duration)]);
  for (const l of lines) {
    pts.add(round(l.start));
    pts.add(round(l.end));
  }
  return [...pts].sort((a, b) => a - b);
}

export function snap(value: number, points: number[], threshold: number): number {
  let best = value;
  let bestDist = threshold;
  for (const p of points) {
    const d = Math.abs(p - value);
    if (d <= bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

export function round(t: number): number {
  return Math.round(t * 1000) / 1000;
}

// ---- Props passed to the Remotion composition (built identically in the browser and on the server) ----

export interface VideoClip {
  src: string;
  start: number;
  end: number;
}

export interface SpeakerSpan {
  speaker: string;
  start: number;
  end: number;
}

export interface PodcastVideoProps {
  audioSrc: string | null;
  peaksSrc: string | null;
  durationInSeconds: number;
  clips: VideoClip[];
  speakers: SpeakerSpan[];
  captions: CaptionCue[];
  settings: VideoSettings;
  [key: string]: unknown;
}

/** `baseUrl` is '' in the browser (same origin via the Vite proxy) and http://localhost:PORT on the server. */
export function buildVideoProps(project: Project, timestamps: Timestamps | null, baseUrl: string): PodcastVideoProps {
  const files = `${baseUrl}/files/${project.id}`;
  const version = project.audio ? `?v=${encodeURIComponent(project.audio.generatedAt)}` : '';
  const clips = project.timeline.clips
    .filter((c) => project.images[c.scene] && c.end > c.start)
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ src: `${files}/images/${encodeURIComponent(project.images[c.scene])}`, start: c.start, end: c.end }));

  return {
    audioSrc: project.audio ? `${files}/${project.audio.file}${version}` : null,
    peaksSrc: project.audio ? `${files}/peaks.json${version}` : null,
    durationInSeconds: Math.max(1, timestamps?.duration ?? project.audio?.duration ?? 10),
    clips,
    speakers: (timestamps?.lines ?? []).map((l) => ({ speaker: l.speaker, start: l.start, end: l.end })),
    captions: captionsFor(project, timestamps),
    settings: project.settings,
  };
}


/**
 * Captions from the character timings saved with the voice-over. Uses the texts stored with the timings;
 * older projects fall back to the current script, which buildCaptions rejects if it no longer matches.
 */
export function captionsFor(project: Project, timestamps: Timestamps | null): CaptionCue[] {
  if (!timestamps) return [];
  const lines = timestamps.lines.every((l) => typeof l.text === 'string')
    ? timestamps.lines.map((l) => ({ speaker: l.speaker, text: l.text! }))
    : parseScript(project.script).lines.map((l) => ({ speaker: l.speaker, text: l.text }));
  return buildCaptions(lines, timestamps.alignment).map((c) => ({ ...c, end: Math.min(c.end, timestamps.duration) }));
}
