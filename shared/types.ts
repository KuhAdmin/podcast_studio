// Shared data model. All times are in seconds (floats); frames exist only inside Remotion.

export interface Clip {
  id: string;
  /** Scene name from the `[SCENE: name]` marker; the image is looked up by this name. */
  scene: string;
  start: number;
  end: number;
}

/** Camera movement over the scene images: off, or a very slow 3% zoom and pan. */
export type MotionLevel = 'off' | 'subtle';

export interface VideoSettings {
  title: string;
  motion: MotionLevel;
  showWaveform: boolean;
  showSpeaker: boolean;
  /** Captions of the spoken words, highlighted as they are said. */
  showCaptions: boolean;
  crossfadeSec: number;
}

export interface AudioInfo {
  file: string;
  duration: number;
  /** Hash of the TTS input (script lines + voice map); used to flag stale audio. */
  inputHash: string;
  generatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  script: string;
  /** Speaker name -> ElevenLabs voice_id */
  voices: Record<string, string>;
  audio?: AudioInfo;
  /** Scene name -> filename inside the project's images/ folder */
  images: Record<string, string>;
  timeline: { clips: Clip[] };
  settings: VideoSettings;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface LineTiming {
  index: number;
  speaker: string;
  /** The exact text that was voiced (with [audio tags]); used for captions. Missing in older projects. */
  text?: string;
  start: number;
  end: number;
}

/** Character-level alignment merged across chunks (offsets already applied). Kept for captions. */
export interface Alignment {
  characters: string[];
  starts: number[];
  ends: number[];
}

export interface Timestamps {
  duration: number;
  lines: LineTiming[];
  alignment: Alignment;
}

/** Amplitude envelope of the audio: `peaksPerSecond` values in 0..1 per second of audio. */
export interface Peaks {
  peaksPerSecond: number;
  data: number[];
}

export interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

export type AudioJobState =
  | { state: 'idle' }
  | { state: 'running'; message: string; progress: number }
  | { state: 'done'; finishedAt: string }
  | { state: 'error'; message: string };

export type RenderState =
  | { state: 'idle' }
  | { state: 'bundling' | 'rendering'; progress: number }
  | { state: 'done'; file: string; finishedAt: string }
  | { state: 'error'; message: string };

export const DEFAULT_SETTINGS: VideoSettings = {
  title: '',
  motion: 'subtle',
  showWaveform: true,
  showSpeaker: true,
  showCaptions: true,
  crossfadeSec: 0.8,
};

export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const;
