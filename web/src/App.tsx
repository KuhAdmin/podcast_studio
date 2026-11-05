import { useEffect, useMemo, useState } from 'react';
import { parseScript, ttsInputHash } from '../../shared/script.ts';
import type { ProjectSummary } from '../../shared/types.ts';
import { api } from './api.ts';
import { AudioStep } from './steps/AudioStep.tsx';
import { EditorStep } from './steps/EditorStep.tsx';
import { ExportStep } from './steps/ExportStep.tsx';
import { ScenesStep } from './steps/ScenesStep.tsx';
import { ScriptStep } from './steps/ScriptStep.tsx';
import { useProject, type SaveState } from './useProject.ts';

const STEPS = [
  { id: 'script', label: 'Script' },
  { id: 'audio', label: 'Voices & audio' },
  { id: 'scenes', label: 'Scene images' },
  { id: 'editor', label: 'Timeline & preview' },
  { id: 'export', label: 'Render' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'All changes saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  error: 'Save failed — retrying…',
};

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // ?project=<id>&step=<step> deep-links (handy for bookmarks); otherwise resume where you left off.
  const query = new URLSearchParams(window.location.search);
  const [projectId, setProjectId] = useState<string | null>(() => query.get('project') ?? localStorage.getItem('projectId'));
  const [step, setStep] = useState<StepId>(() => (query.get('step') ?? localStorage.getItem('step') ?? 'script') as StepId);
  const state = useProject(projectId);
  const { project } = state;

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, [projectId]);
  useEffect(() => {
    if (projectId) localStorage.setItem('projectId', projectId);
    else localStorage.removeItem('projectId');
  }, [projectId]);
  useEffect(() => localStorage.setItem('step', step), [step]);
  useEffect(() => {
    // A stored id for a deleted project falls back to the welcome screen.
    if (state.loadError) setProjectId(null);
  }, [state.loadError]);

  const parsed = useMemo(() => parseScript(project?.script ?? ''), [project?.script]);

  const done: Record<StepId, boolean> = useMemo(() => {
    if (!project) return { script: false, audio: false, scenes: false, editor: false, export: false };
    const sceneNames = new Set(parsed.scenes.map((s) => s.name));
    return {
      script: parsed.lines.length > 0 && !parsed.issues.some((i) => i.severity === 'error'),
      audio: Boolean(project.audio && project.audio.inputHash === ttsInputHash(parsed.lines, project.voices)),
      scenes: sceneNames.size > 0 && [...sceneNames].every((n) => project.images[n]),
      editor: project.timeline.clips.length > 0,
      export: false,
    };
  }, [project, parsed]);

  const createProject = async (name: string) => {
    const p = await api.createProject(name);
    setProjectId(p.id);
    setStep('script');
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" aria-hidden />
          Podcast Video Creator
        </div>

        <label className="field small">
          <span className="muted">Project</span>
          <select
            value={projectId ?? ''}
            onChange={(e) => {
              void state.flush();
              setProjectId(e.target.value || null);
            }}
          >
            <option value="">+ New project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        {project && (
          <nav aria-label="Steps">
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.id}>
                  <button className="step-link" aria-current={step === s.id ? 'step' : undefined} onClick={() => setStep(s.id)}>
                    <span className={`step-num${done[s.id] ? ' done' : ''}`} aria-hidden>
                      {done[s.id] ? '✓' : i + 1}
                    </span>
                    {s.label}
                    {done[s.id] && <span className="visually-hidden">(complete)</span>}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="spacer" />
        {project && (
          <p className="save-state" data-state={state.saveState} role="status">
            {SAVE_LABEL[state.saveState]}
          </p>
        )}
      </aside>

      <main className="main">
        {!projectId || !project ? (
          projectId && !state.loadError ? (
            <div className="page muted">Loading project…</div>
          ) : (
            <Welcome onCreate={createProject} />
          )
        ) : (
          <>
            {step === 'script' && <ScriptStep project={project} parsed={parsed} update={state.update} onNext={() => setStep('audio')} />}
            {step === 'audio' && (
              <AudioStep project={project} parsed={parsed} timestamps={state.timestamps} update={state.update} replace={state.replace} flush={state.flush} upToDate={done.audio} onNext={() => setStep('scenes')} />
            )}
            {step === 'scenes' && <ScenesStep project={project} parsed={parsed} replace={state.replace} onNext={() => setStep('editor')} />}
            {step === 'editor' && (
              <EditorStep project={project} parsed={parsed} timestamps={state.timestamps} peaks={state.peaks} update={state.update} onNext={() => setStep('export')} />
            )}
            {step === 'export' && <ExportStep project={project} flush={state.flush} />}
          </>
        )}
      </main>
    </div>
  );
}

function Welcome({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <div className="stack">
        <h1>New podcast video</h1>
        <p className="muted">
          Paste a ChatGPT script, voice it with ElevenLabs, drop in a scene image per setting, line them up on the timeline and render an MP4.
        </p>
      </div>
      <form
        className="panel stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onCreate(name);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Episode name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ep 12 — The night market" autoFocus required />
        </label>
        {error && <div className="notice notice-error">{error}</div>}
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>
            {busy && <span className="spinner" aria-hidden />}
            Create project
          </button>
        </div>
      </form>
    </div>
  );
}
