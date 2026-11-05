// Parser for the script contract described in CLAUDE.md:
//   [SCENE: kebab-name]          (own line, stripped before TTS)
//   Speaker: text with [audio] tags

export interface ScriptLine {
  /** Index among dialogue lines (scene markers excluded). */
  index: number;
  speaker: string;
  text: string;
  /** Scene name active for this line (null if the script has no scene before it). */
  scene: string | null;
  sourceLine: number;
}

export interface SceneMarker {
  name: string;
  /** Index of the first dialogue line after the marker (lines.length if none follow). */
  firstLineIndex: number;
  sourceLine: number;
}

export interface ScriptIssue {
  sourceLine: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface ParsedScript {
  lines: ScriptLine[];
  scenes: SceneMarker[];
  speakers: string[];
  issues: ScriptIssue[];
}

const SCENE_RE = /^\[\s*SCENE\s*:\s*([^\]]+?)\s*\]$/i;
// Speaker names: no brackets or colons, up to 40 chars. Tolerates markdown bold (**Alex:** / **Alex**:).
const LINE_RE = /^\*{0,2}([^\[\]:*]{1,40}?)\*{0,2}\s*:\s*\*{0,2}\s*(.*)$/;

export function normalizeSceneName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseScript(source: string): ParsedScript {
  const lines: ScriptLine[] = [];
  const scenes: SceneMarker[] = [];
  const issues: ScriptIssue[] = [];
  let currentScene: string | null = null;

  source.split(/\r?\n/).forEach((raw, i) => {
    const sourceLine = i + 1;
    const line = raw.trim();
    // Blank lines, markdown headings and horizontal rules are ignored.
    if (!line || line.startsWith('#') || /^-{3,}$/.test(line)) return;

    const scene = SCENE_RE.exec(line);
    if (scene) {
      const name = normalizeSceneName(scene[1]);
      if (!name) {
        issues.push({ sourceLine, severity: 'error', message: 'Scene marker has an empty name.' });
        return;
      }
      currentScene = name;
      scenes.push({ name, firstLineIndex: lines.length, sourceLine });
      return;
    }

    const m = LINE_RE.exec(line);
    if (!m) {
      issues.push({
        sourceLine,
        severity: 'error',
        message: 'Expected "Speaker: text" or "[SCENE: name]".',
      });
      return;
    }
    const speaker = m[1].trim();
    const text = m[2].trim();
    if (!text) {
      issues.push({ sourceLine, severity: 'warning', message: `"${speaker}" has an empty line; it will be skipped.` });
      return;
    }
    lines.push({ index: lines.length, speaker, text, scene: currentScene, sourceLine });
  });

  if (lines.length > 0 && (scenes.length === 0 || scenes[0].firstLineIndex > 0)) {
    issues.push({
      sourceLine: lines[0].sourceLine,
      severity: 'warning',
      message: 'Dialogue starts before the first [SCENE: …] marker; the first scene will be stretched to cover it.',
    });
  }
  for (const s of scenes) {
    if (s.firstLineIndex === lines.length) {
      issues.push({ sourceLine: s.sourceLine, severity: 'warning', message: `Scene "${s.name}" has no dialogue after it.` });
    }
  }

  const speakers = [...new Set(lines.map((l) => l.speaker))];
  return { lines, scenes, speakers, issues };
}

/** Maximum characters per ElevenLabs Text-to-Dialogue request (documented limit is 2,000). */
export const MAX_CHUNK_CHARS = 1800;

/**
 * Splits dialogue lines into request-sized chunks on turn boundaries.
 * A single line longer than the limit becomes its own chunk (ElevenLabs may reject it; surfaced as an issue).
 */
export function chunkLines<T extends { text: string }>(lines: T[], maxChars = MAX_CHUNK_CHARS): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const line of lines) {
    if (current.length > 0 && size + line.text.length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Stable hash of what the TTS request depends on, so the UI can flag stale audio. */
export function ttsInputHash(lines: ScriptLine[], voices: Record<string, string>): string {
  const input = JSON.stringify(lines.map((l) => [l.speaker, l.text, voices[l.speaker] ?? '']));
  // FNV-1a, 32-bit: good enough for change detection.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
