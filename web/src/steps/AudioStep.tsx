import { useCallback, useEffect, useRef, useState } from 'react';
import { stripTags } from '../../../shared/captions.ts';
import { chunkLines, type ParsedScript } from '../../../shared/script.ts';
import type { AudioJobState, Project, Timestamps, Voice } from '../../../shared/types.ts';
import { DEFAULT_VOICES, suggestVoices, type VoiceSource } from '../../../shared/voices.ts';
import { api, fileUrl } from '../api.ts';
import { VoiceOverPlayer, type PlayerLine } from '../components/VoiceOverPlayer.tsx';

const POLL_MS = 1000;
const VOICE_MEMORY_KEY = 'voiceDefaults';

interface Props {
  project: Project;
  parsed: ParsedScript;
  timestamps: Timestamps | null;
  update: (fn: (p: Project) => Project) => void;
  replace: (p: Project) => Promise<void>;
  flush: () => Promise<void>;
  upToDate: boolean;
  onNext: () => void;
}

function readVoiceMemory(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(VOICE_MEMORY_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function AudioStep({ project, parsed, timestamps, update, replace, flush, upToDate, onNext }: Props) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ remaining: number; resetsAt: string | null } | null>(null);
  const [autoPicked, setAutoPicked] = useState<Record<string, VoiceSource>>({});
  const [job, setJob] = useState<AudioJobState>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLAudioElement | null>(null);
  const running = job.state === 'running';

  useEffect(() => {
    api.voices().then(setVoices).catch((e: Error) => setVoiceError(e.message));
    api.health().then((h) => setModel(h.model)).catch(() => {});
  }, []);

  // Re-read the remaining characters whenever a generation finishes.
  useEffect(() => {
    if (job.state !== 'running') api.quota().then(setQuota).catch(() => setQuota(null));
  }, [job.state]);

  // Fill in voices for new speakers: last pick for that name, the house defaults, or a voice with the same name.
  useEffect(() => {
    if (!voices) return;
    const picks = suggestVoices(parsed.speakers, project.voices, voices, readVoiceMemory());
    const names = Object.keys(picks);
    if (names.length === 0) return;
    update((p) => ({ ...p, voices: { ...p.voices, ...Object.fromEntries(names.map((n) => [n, picks[n].voiceId])) } }));
    setAutoPicked((prev) => ({ ...prev, ...Object.fromEntries(names.map((n) => [n, picks[n].source])) }));
  }, [voices, parsed.speakers, project.voices, update]);

  // Poll the background job; a job started earlier keeps running if you leave this step and come back.
  // A finished job whose audio this tab hasn't loaded yet (e.g. it finished while the page was reloading) is picked up too.
  const loadedAudio = useRef(project.audio?.generatedAt);
  loadedAudio.current = project.audio?.generatedAt;
  const poll = useCallback(
    async (wasRunning: boolean) => {
      const s = await api.audioStatus(project.id);
      setJob(s);
      if (s.state === 'running') return true;
      if (s.state === 'done') {
        const fresh = await api.getProject(project.id);
        if (wasRunning || fresh.audio?.generatedAt !== loadedAudio.current) await replace(fresh);
      }
      if (wasRunning && s.state === 'error') setError(s.message);
      return false;
    },
    [project.id, replace],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let wasRunning = running;
    const tick = async () => {
      try {
        const still = await poll(wasRunning);
        if (cancelled) return;
        wasRunning = still;
        if (still) timer = window.setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [poll, running]);

  const missing = parsed.speakers.filter((s) => !project.voices[s]);
  const scriptErrors = parsed.issues.some((i) => i.severity === 'error');
  const requests = chunkLines(parsed.lines).length;
  const chars = parsed.lines.reduce((n, l) => n + l.text.length, 0);
  const accountIds = new Set(voices?.map((v) => v.voice_id) ?? []);
  const outOfCredits = quota !== null && quota.remaining < chars;
  const canGenerate = !running && parsed.lines.length > 0 && missing.length === 0 && !scriptErrors && !outOfCredits;

  const playerLines: PlayerLine[] =
    timestamps && timestamps.lines.length === parsed.lines.length
      ? timestamps.lines.map((l, i) => ({ speaker: l.speaker, text: stripTags(parsed.lines[i].text), start: l.start, end: l.end }))
      : [];

  const regenerate = () => {
    if (window.confirm(`Generate a new voice-over? This replaces the current one and uses about ${chars.toLocaleString()} ElevenLabs characters.`)) void generate();
  };

  const generate = async () => {
    setError(null);
    try {
      await flush(); // the server generates from the saved script + voices
      setJob(await api.startAudio(project.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const chooseVoice = (speaker: string, voiceId: string) => {
    update((p) => ({ ...p, voices: { ...p.voices, [speaker]: voiceId } }));
    setAutoPicked(({ [speaker]: _, ...rest }) => rest);
    if (voiceId) localStorage.setItem(VOICE_MEMORY_KEY, JSON.stringify({ ...readVoiceMemory(), [speaker]: voiceId }));
  };

  const playPreview = (url?: string) => {
    preview.current?.pause();
    if (!url) return;
    preview.current = new Audio(url);
    void preview.current.play();
  };

  const generateLabel = running ? 'Generating…' : project.audio ? 'Regenerate audio' : 'Generate audio';

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Voices & audio</h1>
          <p className="muted">
            Pick an ElevenLabs voice for each speaker, then generate the voice-over{model ? ` with ${model}` : ''} (audio tags supported).
          </p>
        </div>
        <div className="spacer" />
        {project.audio && upToDate && !running ? (
          <button className="btn btn-primary" onClick={onNext}>
            Next: scene images
          </button>
        ) : (
          <button className="btn btn-primary" onClick={generate} disabled={!canGenerate} aria-describedby="generate-hint">
            {running && <span className="spinner" aria-hidden />}
            {generateLabel}
          </button>
        )}
      </header>

      <section className="panel stack" aria-labelledby="voices-heading">
        <h2 id="voices-heading">Speaker voices</h2>
        {voiceError && <div className="notice notice-error">Could not load voices: {voiceError}</div>}
        {parsed.speakers.length === 0 ? (
          <p className="muted">Add a script first — speakers are detected from it.</p>
        ) : (
          <div className="voice-table">
            {parsed.speakers.map((speaker) => {
              const selected = voices?.find((v) => v.voice_id === project.voices[speaker]);
              const unknown = voices && project.voices[speaker] && !selected;
              return (
                <div key={speaker} style={{ display: 'contents' }}>
                  <label className="speaker-name" htmlFor={`voice-${speaker}`}>
                    {speaker}
                    {autoPicked[speaker] && (
                      <span className="muted small" style={{ display: 'block', fontWeight: 400 }}>
                        {autoPicked[speaker] === 'remembered' ? 'Auto-selected: used last time' : autoPicked[speaker] === 'default' ? 'Default voice' : 'Auto-selected: same name'}
                      </span>
                    )}
                  </label>
                  <select
                    id={`voice-${speaker}`}
                    value={project.voices[speaker] ?? ''}
                    disabled={!voices || running}
                    onChange={(e) => chooseVoice(speaker, e.target.value)}
                  >
                    <option value="">{voices ? 'Choose a voice…' : voiceError ? 'Voices unavailable' : 'Loading voices…'}</option>
                    {unknown && <option value={project.voices[speaker]}>{voiceLabel(project.voices[speaker])} (Voice Library)</option>}
                    {voices && (
                      <optgroup label="Default voices (Voice Library)">
                        {DEFAULT_VOICES.filter((d) => !accountIds.has(d.voiceId) && d.voiceId !== project.voices[speaker]).map((d) => (
                          <option key={d.voiceId} value={d.voiceId}>
                            {d.name} ({d.gender})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {voices?.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}
                        {v.labels ? ` — ${Object.values(v.labels).filter(Boolean).slice(0, 3).join(', ')}` : ''}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-sm" disabled={!selected?.preview_url} onClick={() => playPreview(selected?.preview_url)} aria-label={`Preview voice for ${speaker}`}>
                    ▶ Preview
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {outOfCredits && (
          <div className="notice notice-error" role="status">
            Not enough ElevenLabs credits: this script needs about {chars.toLocaleString()} characters, {quota!.remaining.toLocaleString()} left
            {quota!.resetsAt ? ` (resets ${new Date(quota!.resetsAt).toLocaleDateString()})` : ''}.
          </div>
        )}
        <p id="generate-hint" className="muted small">
          {missing.length > 0
            ? `Choose a voice for ${missing.join(', ')}.`
            : scriptErrors
              ? 'Fix the script errors first.'
              : `${parsed.lines.length} lines · ${chars.toLocaleString()} characters → ${requests} ElevenLabs request${requests === 1 ? '' : 's'}. Billed by ElevenLabs per character${quota ? ` · ${quota.remaining.toLocaleString()} left this cycle` : ''}.`}
        </p>
      </section>

      {running && (
        <section className="panel stack" aria-live="polite">
          <div className="row">
            <strong>{job.message}</strong>
            <span className="spacer" />
            <span className="mono">{Math.round(job.progress * 100)}%</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
            <div style={{ width: `${job.progress * 100}%` }} />
          </div>
          <p className="muted small">You can switch steps — generation keeps running on the server.</p>
        </section>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {project.audio && (
        <section className="panel stack" aria-labelledby="audio-heading">
          <div className="row">
            <h2 id="audio-heading">Voice-over</h2>
            <span className="muted small">
              {formatDuration(project.audio.duration)} · generated {new Date(project.audio.generatedAt).toLocaleString()}
            </span>
            <span className="spacer" />
            <button className="btn" onClick={regenerate} disabled={!canGenerate} title={`Uses about ${chars.toLocaleString()} ElevenLabs characters`}>
              {running ? <span className="spinner" aria-hidden /> : <span aria-hidden>↻</span>}
              {running ? 'Generating…' : 'Regenerate'}
            </button>
          </div>
          {!upToDate && !running && (
            <div className="notice notice-warning">The script or voices changed since this audio was generated. Regenerate to hear the current version.</div>
          )}
          <VoiceOverPlayer
            src={`${fileUrl(project.id, project.audio.file)}?v=${encodeURIComponent(project.audio.generatedAt)}`}
            duration={project.audio.duration}
            lines={playerLines}
            downloadName={`${project.id}-voice-over.mp3`}
          />
        </section>
      )}
    </div>
  );
}

function voiceLabel(voiceId: string): string {
  return DEFAULT_VOICES.find((d) => d.voiceId === voiceId)?.name ?? voiceId;
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
