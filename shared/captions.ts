import type { Alignment } from './types.ts';

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

/** One on-screen caption: part of a single speaker's line, shown from `start` to `end`. */
export interface CaptionCue {
  speaker: string;
  start: number;
  end: number;
  words: CaptionWord[];
}

const MAX_CUE_CHARS = 80; // about two lines on screen
const MIN_SENTENCE_CUE_CHARS = 25; // shorter sentences are joined with the next one to avoid flashing
const MAX_PAUSE_SEC = 0.8;
const HOLD_SEC = 0.6;

/** Line text without [audio tags], for display. */
export function stripTags(text: string): string {
  return text.replace(/\[[^\]]*\]\s*/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Builds captions from the character timings ElevenLabs returned with the voice-over (no speech-to-text needed).
 * `lines` must be exactly the texts that were voiced, in order; if their total length doesn't match the timings
 * (e.g. the script changed since the audio was made) no captions are returned rather than wrong ones.
 */
export function buildCaptions(lines: { speaker: string; text: string }[], alignment: Alignment | null | undefined): CaptionCue[] {
  const total = lines.reduce((n, l) => n + l.text.length, 0);
  if (!alignment || total === 0 || alignment.starts.length !== total || alignment.ends.length !== total) return [];

  const cues: CaptionCue[] = [];
  let offset = 0;
  for (const line of lines) {
    const words = wordsOf(line.text, offset, alignment);
    offset += line.text.length;

    let cue: CaptionWord[] = [];
    const flush = () => {
      if (cue.length) cues.push({ speaker: line.speaker, start: cue[0].start, end: cue[cue.length - 1].end, words: cue });
      cue = [];
    };
    for (const w of words) {
      const prev = cue[cue.length - 1];
      if (prev && (w.start - prev.end > MAX_PAUSE_SEC || cueLength(cue) + 1 + w.text.length > MAX_CUE_CHARS)) flush();
      cue.push(w);
      if (/[.?!…]["'”’)]*$/.test(w.text) && cueLength(cue) >= MIN_SENTENCE_CUE_CHARS) flush();
    }
    flush();
  }

  // Keep each caption up briefly after its last word, but never over the next one.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    cues[i].end = Math.max(cues[i].end, next ? Math.min(next.start, cues[i].end + HOLD_SEC) : cues[i].end + HOLD_SEC);
  }
  return cues;
}

function cueLength(words: CaptionWord[]): number {
  return words.reduce((n, w, i) => n + w.text.length + (i ? 1 : 0), 0);
}

/** Splits one line's text into timed words, skipping [audio tags]. Punctuation-only tokens join the previous word. */
function wordsOf(text: string, offset: number, a: Alignment): CaptionWord[] {
  const words: CaptionWord[] = [];
  let first = -1;
  const flush = (endIdx: number) => {
    if (first < 0) return;
    const token = text.slice(first, endIdx);
    const start = a.starts[offset + first];
    const end = a.ends[offset + endIdx - 1];
    const prev = words[words.length - 1];
    if (prev && !/[\p{L}\p{N}]/u.test(token)) {
      prev.text += ` ${token}`;
      prev.end = end;
    } else {
      words.push({ text: token, start, end });
    }
    first = -1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '[') {
      flush(i);
      const close = text.indexOf(']', i);
      i = close < 0 ? text.length : close;
    } else if (/\s/.test(ch)) {
      flush(i);
    } else if (first < 0) {
      first = i;
    }
  }
  flush(text.length);
  return words;
}

/** Standard SubRip subtitles, e.g. for uploading to YouTube. */
export function toSrt(cues: CaptionCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${wrap(c.words.map((w) => w.text).join(' '))}\n`)
    .join('\n');
}

export function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/** Breaks long subtitle text into two lines at the space closest to the middle. */
function wrap(text: string, max = 42): string {
  if (text.length <= max) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}
