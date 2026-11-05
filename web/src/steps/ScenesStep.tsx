import { useRef, useState } from 'react';
import type { ParsedScript } from '../../../shared/script.ts';
import type { Project } from '../../../shared/types.ts';
import { api, fileUrl } from '../api.ts';
import { BulkAssign, UnusedImages } from '../components/SceneBulk.tsx';

interface Props {
  project: Project;
  parsed: ParsedScript;
  replace: (p: Project) => Promise<void>;
  onNext: () => void;
}

export function ScenesStep({ project, parsed, replace, onNext }: Props) {
  const scenes = [...new Set(parsed.scenes.map((s) => s.name))].map((name) => ({
    name,
    firstLine: parsed.lines[parsed.scenes.find((s) => s.name === name)!.firstLineIndex],
    occurrences: parsed.scenes.filter((s) => s.name === name).length,
  }));
  const sceneNames = scenes.map((s) => s.name);
  const missing = scenes.filter((s) => !project.images[s.name]).length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Scene images</h1>
          <p className="muted">One clean 16:9 image per scene (1920×1080 recommended). PNG, JPEG or WebP.</p>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={onNext} disabled={scenes.length === 0}>
          Next: timeline & preview
        </button>
      </header>

      {scenes.length === 0 ? (
        <div className="notice notice-warning">No [SCENE: …] markers in the script yet. Add them in the Script step.</div>
      ) : missing > 0 ? (
        <div className="notice notice-warning" role="status">
          {missing} of {scenes.length} scenes still need an image. They will render as a dark background.
        </div>
      ) : (
        <div className="notice notice-success" role="status">
          Every scene has an image.
        </div>
      )}

      {scenes.length > 0 && <BulkAssign project={project} scenes={sceneNames} replace={replace} />}

      <div className="scene-grid">
        {scenes.map((s) => (
          <SceneCard key={s.name} project={project} scene={s.name} firstLine={s.firstLine?.text} occurrences={s.occurrences} replace={replace} />
        ))}
      </div>

      <UnusedImages project={project} scenes={sceneNames} replace={replace} />
    </div>
  );
}

function SceneCard({
  project,
  scene,
  firstLine,
  occurrences,
  replace,
}: {
  project: Project;
  scene: string;
  firstLine?: string;
  occurrences: number;
  replace: (p: Project) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const image = project.images[scene];

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await replace(await api.uploadImage(project.id, scene, file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="scene-card" data-missing={!image}>
      <button
        type="button"
        className="scene-drop"
        data-dragging={dragging}
        aria-label={image ? `Replace image for ${scene}` : `Upload image for ${scene}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files[0]);
        }}
        style={{ border: 0, font: 'inherit' }}
      >
        {image ? <img src={fileUrl(project.id, `images/${image}`)} alt="" /> : <span>{busy ? 'Uploading…' : 'Drop an image or click to upload'}</span>}
        {busy && image && <span className="spinner" aria-hidden style={{ position: 'relative' }} />}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void upload(e.target.files?.[0])} />
      <div className="scene-body">
        <div className="row">
          <h3 className="mono">{scene}</h3>
          <span className="spacer" />
          {occurrences > 1 && <span className="chip">used {occurrences}×</span>}
        </div>
        {firstLine && <p className="muted small">“{firstLine.length > 110 ? `${firstLine.slice(0, 110)}…` : firstLine}”</p>}
        {error && <div className="notice notice-error small">{error}</div>}
        {image && (
          <div className="row">
            <button className="btn btn-sm" onClick={() => input.current?.click()} disabled={busy}>
              Replace
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await replace(await api.removeImage(project.id, scene));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
