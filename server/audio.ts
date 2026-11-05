import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chunkLines, parseScript, ttsInputHash } from '../shared/script.ts';
import { autoLayout } from '../shared/timeline.ts';
import type { Alignment, AudioJobState, LineTiming, Peaks, Project, Timestamps } from '../shared/types.ts';
import { getQuota, textToDialogue } from './elevenlabs.ts';
import { HttpError, projectDir, readProject, writeProject } from './projects.ts';

const FFMPEG = () => process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = () => process.env.FFPROBE_PATH || 'ffprobe';
const PEAKS_PER_SECOND = 100;
const MAX_UNIQUE_VOICES = 10;

function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    proc.stdout.on('data', (d: Buffer) => out.push(d));
    proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
    proc.on('error', (e) => reject(new HttpError(500, `Could not run ${cmd}: ${e.message}. Is ffmpeg installed and on PATH?`)));
    proc.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new HttpError(500, `${cmd} exited with ${code}: ${err.slice(-500)}`)),
    );
  });
}

async function probeDuration(file: string): Promise<number> {
  const out = await run(FFPROBE(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = parseFloat(out.toString().trim());
  if (!Number.isFinite(d)) throw new HttpError(500, `Could not read duration of ${path.basename(file)}`);
  return d;
}

async function computePeaks(file: string): Promise<Peaks> {
  const sampleRate = 8000;
  const pcm = await run(FFMPEG(), ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-']);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const bucket = sampleRate / PEAKS_PER_SECOND;
  const data: number[] = [];
  let max = 0;
  for (let i = 0; i < samples.length; i += bucket) {
    let peak = 0;
    const end = Math.min(i + bucket, samples.length);
    for (let j = i; j < end; j++) peak = Math.max(peak, Math.abs(samples[j]));
    data.push(peak);
    max = Math.max(max, peak);
  }
  return { peaksPerSecond: PEAKS_PER_SECOND, data: data.map((v) => (max ? Math.round((v / max) * 1000) / 1000 : 0)) };
}

/**
 * Fails fast, before any credits are spent, if the plan doesn't have enough characters left.
 * Voice IDs are not checked against "My Voices": Voice Library voices can be used directly by ID on paid plans.
 */
async function preflight(chars: number): Promise<void> {
  const quota = await getQuota();
  if (quota && quota.remaining < chars) {
    const reset = quota.resetsAt ? ` Your quota resets on ${new Date(quota.resetsAt).toDateString()}.` : '';
    throw new HttpError(
      402,
      `Not enough ElevenLabs credits: this script needs about ${chars.toLocaleString()} characters, but only ${quota.remaining.toLocaleString()} are left this cycle.${reset} Shorten the script or upgrade your plan.`,
    );
  }
}

const jobs = new Map<string, AudioJobState>();

export function audioStatus(id: string): AudioJobState {
  return jobs.get(id) ?? { state: 'idle' };
}

/** Starts generation in the background; the client polls audioStatus(). */
export function startAudioJob(id: string): AudioJobState {
  projectDir(id); // validates the id
  if (audioStatus(id).state === 'running') throw new HttpError(409, 'Audio generation is already running for this project.');
  const report = (message: string, progress: number) => {
    jobs.set(id, { state: 'running', message, progress });
    console.log(`[tts ${id}] ${message}`);
  };
  report('Checking script and voices', 0);
  void generateAudio(id, report).then(
    () => jobs.set(id, { state: 'done', finishedAt: new Date().toISOString() }),
    (err) => {
      console.error(`[tts ${id}]`, err);
      jobs.set(id, { state: 'error', message: err instanceof Error ? err.message : String(err) });
    },
  );
  return audioStatus(id);
}

/**
 * Generates the full voice-over for a project:
 * script → chunks (≤2,000 chars, split on turns) → ElevenLabs Text-to-Dialogue with timestamps per chunk
 * → ffmpeg concat → audio.mp3 + timestamps.json + peaks.json, then auto-lays out the image track.
 */
async function generateAudio(id: string, report: (message: string, progress: number) => void): Promise<Project> {
  const dir = projectDir(id);
  const tmp = path.join(dir, 'tmp-tts');
  try {
    const project = await readProject(id);
    const parsed = parseScript(project.script);
    const errors = parsed.issues.filter((i) => i.severity === 'error');
    if (errors.length) throw new HttpError(400, `Fix script errors first (line ${errors[0].sourceLine}: ${errors[0].message})`);
    if (parsed.lines.length === 0) throw new HttpError(400, 'The script has no dialogue lines.');
    const missing = parsed.speakers.filter((s) => !project.voices[s]);
    if (missing.length) throw new HttpError(400, `Pick a voice for: ${missing.join(', ')}`);
    if (new Set(parsed.speakers.map((s) => project.voices[s])).size > MAX_UNIQUE_VOICES) {
      throw new HttpError(400, `ElevenLabs dialogue supports at most ${MAX_UNIQUE_VOICES} different voices.`);
    }
    await preflight(parsed.lines.reduce((n, l) => n + l.text.length, 0));

    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { recursive: true });

    const chunks = chunkLines(parsed.lines);
    const lineTimes = new Map<number, LineTiming>();
    const alignment: Alignment = { characters: [], starts: [], ends: [] };
    const chunkFiles: string[] = [];
    let offset = 0;

    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      report(`Voicing part ${c + 1} of ${chunks.length} (${chunk.length} lines)`, c / (chunks.length + 1));
      const res = await textToDialogue(
        chunk.map((l) => ({ text: l.text, voiceId: project.voices[l.speaker] })),
        { previousText: chunks[c - 1]?.at(-1)?.text, futureText: chunks[c + 1]?.[0]?.text },
      );
      const file = path.join(tmp, `chunk-${String(c).padStart(3, '0')}.mp3`);
      await fs.writeFile(file, Buffer.from(res.audioBase64, 'base64'));
      chunkFiles.push(file);

      for (const seg of res.voiceSegments) {
        const line = chunk[seg.dialogueInputIndex];
        if (!line) continue;
        const start = offset + seg.startTimeSeconds;
        const end = offset + seg.endTimeSeconds;
        const prev = lineTimes.get(line.index);
        lineTimes.set(line.index, {
          index: line.index,
          speaker: line.speaker,
          text: line.text,
          start: prev ? Math.min(prev.start, start) : start,
          end: prev ? Math.max(prev.end, end) : end,
        });
      }
      if (res.alignment) {
        alignment.characters.push(...res.alignment.characters);
        alignment.starts.push(...res.alignment.characterStartTimesSeconds.map((t) => offset + t));
        alignment.ends.push(...res.alignment.characterEndTimesSeconds.map((t) => offset + t));
      }
      offset += await probeDuration(file);
    }

    const audioFile = path.join(dir, 'audio.mp3');
    if (chunkFiles.length === 1) {
      await fs.copyFile(chunkFiles[0], audioFile);
    } else {
      report(`Joining ${chunkFiles.length} parts`, chunks.length / (chunks.length + 1));
      const inputs = chunkFiles.flatMap((f) => ['-i', f]);
      const filter = `${chunkFiles.map((_, i) => `[${i}:a]`).join('')}concat=n=${chunkFiles.length}:v=0:a=1[a]`;
      await run(FFMPEG(), ['-y', '-v', 'error', ...inputs, '-filter_complex', filter, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '192k', audioFile]);
    }

    const duration = await probeDuration(audioFile);
    const lines = parsed.lines.map(
      (l, i) =>
        lineTimes.get(l.index) ?? {
          // A line without a segment (should not happen) inherits its neighbour's end so ordering holds.
          index: l.index,
          speaker: l.speaker,
          text: l.text,
          start: lineTimes.get(i - 1)?.end ?? 0,
          end: lineTimes.get(i - 1)?.end ?? 0,
        },
    );
    // Segment times can overshoot the encoded file by a few frames; keep everything inside the audio.
    const clamp = (t: number) => Math.min(t, duration);
    const timestamps: Timestamps = {
      duration,
      lines: lines.map((l) => ({ ...l, start: clamp(l.start), end: clamp(l.end) })),
      alignment: { ...alignment, starts: alignment.starts.map(clamp), ends: alignment.ends.map(clamp) },
    };
    await fs.writeFile(path.join(dir, 'timestamps.json'), JSON.stringify(timestamps));
    report('Computing waveform', 0.97);
    await fs.writeFile(path.join(dir, 'peaks.json'), JSON.stringify(await computePeaks(audioFile)));

    // Re-read in case the client saved while we were generating; audio + timeline are ours to set.
    const latest = await readProject(id);
    latest.audio = {
      file: 'audio.mp3',
      duration,
      inputHash: ttsInputHash(parsed.lines, project.voices),
      generatedAt: new Date().toISOString(),
    };
    latest.timeline = { clips: autoLayout(parsed, timestamps) };
    return await writeProject(latest);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
