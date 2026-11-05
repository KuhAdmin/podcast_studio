import { useEffect, useRef, useState } from 'react';
import { assignImagesToScenes } from '../../../shared/sceneMatch.ts';
import type { Project } from '../../../shared/types.ts';
import { api, fileUrl } from '../api.ts';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface Props {
  project: Project;
  scenes: string[];
  replace: (p: Project) => Promise<void>;
}

interface TrayItem {
  key: string;
  file: File;
  url: string;
  scene: string; // '' = skip
}

/** Drop several images at once; each gets a pre-filled scene (file name match, else download order) to confirm. */
export function BulkAssign({ project, scenes, replace }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Release thumbnail object URLs when the step unmounts.
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const clear = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    setTray([]);
  };

  const accept = (list: FileList | null) => {
    const all = [...(list ?? [])];
    const files = all.filter((f) => IMAGE_TYPES.includes(f.type));
    setError(all.length > 0 && files.length === 0 ? 'Only PNG, JPEG or WebP images can be used.' : null);
    if (files.length === 0) return;
    clear();
    const taken = new Set(scenes.filter((s) => project.images[s]));
    const picks = assignImagesToScenes(files, scenes, taken);
    setTray(
      files.map((file, i) => {
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        return { key: `${file.name}-${file.lastModified}-${i}`, file, url, scene: picks[i] ?? '' };
      }),
    );
  };

  const counts: Record<string, number> = {};
  for (const t of tray) if (t.scene) counts[t.scene] = (counts[t.scene] ?? 0) + 1;
  const duplicates = Object.keys(counts).filter((s) => counts[s] > 1);
  const toAssign = tray.filter((t) => t.scene);

  const assignAll = async () => {
    setError(null);
    try {
      for (const [i, t] of toAssign.entries()) {
        setBusy(`Uploading ${i + 1} of ${toAssign.length}…`);
        await replace(await api.uploadImage(project.id, t.scene, t.file));
      }
      clear();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="stack" aria-label="Add several scene images at once">
      <button
        type="button"
        className="bulk-drop"
        data-dragging={dragging}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files);
        }}
      >
        <strong>Drop all scene images here</strong>
        <span className="muted small">
          or click to choose several. Each image is matched to a scene by file name, otherwise in download order. You confirm before anything is saved.
        </span>
      </button>
      <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden onChange={(e) => accept(e.target.files)} />

      {tray.length > 0 && (
        <div className="panel stack">
          <div className="row">
            <h2>Check the matches</h2>
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={clear} disabled={Boolean(busy)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={assignAll} disabled={Boolean(busy) || duplicates.length > 0 || toAssign.length === 0}>
              {busy && <span className="spinner" aria-hidden />}
              {busy ?? `Assign ${toAssign.length} image${toAssign.length === 1 ? '' : 's'}`}
            </button>
          </div>
          {duplicates.length > 0 && (
            <div className="notice notice-error" role="alert">
              More than one image is set to {duplicates.join(', ')}. Pick a different scene or skip one.
            </div>
          )}
          <div className="tray-grid">
            {tray.map((t) => (
              <div key={t.key} className="tray-item" data-duplicate={duplicates.includes(t.scene)}>
                <img src={t.url} alt="" />
                <span className="muted small tray-name" title={t.file.name}>
                  {t.file.name}
                </span>
                <label className="visually-hidden" htmlFor={`tray-${t.key}`}>
                  Scene for {t.file.name}
                </label>
                <SceneSelect
                  id={`tray-${t.key}`}
                  value={t.scene}
                  scenes={scenes}
                  project={project}
                  emptyLabel="— Skip —"
                  disabled={Boolean(busy)}
                  onChange={(scene) => setTray((all) => all.map((x) => (x.key === t.key ? { ...x, scene } : x)))}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

/** Images stored under scene names that are no longer in the script; reattach them without re-uploading. */
export function UnusedImages({ project, scenes, replace }: Props) {
  const unused = Object.keys(project.images).filter((name) => !scenes.includes(name));
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (unused.length === 0) return null;

  const run = async (fn: () => Promise<Project>) => {
    setBusy(true);
    setError(null);
    try {
      await replace(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack" aria-labelledby="unused-heading">
      <div className="stack" style={{ gap: 'var(--s1)' }}>
        <h2 id="unused-heading">Unused images</h2>
        <p className="muted small">These were uploaded for scene names that are no longer in the script. Assign them to a current scene or delete them.</p>
      </div>
      {error && <div className="notice notice-error">{error}</div>}
      <div className="tray-grid">
        {unused.map((name) => {
          const target = targets[name] ?? '';
          return (
            <div key={name} className="tray-item">
              <img src={fileUrl(project.id, `images/${project.images[name]}`)} alt="" />
              <span className="muted small mono tray-name">{name}</span>
              <label className="visually-hidden" htmlFor={`unused-${name}`}>
                Scene for unused image {name}
              </label>
              <SceneSelect
                id={`unused-${name}`}
                value={target}
                scenes={scenes}
                project={project}
                emptyLabel="Choose a scene…"
                disabled={busy}
                onChange={(scene) => setTargets((t) => ({ ...t, [name]: scene }))}
              />
              <div className="row" style={{ gap: 'var(--s2)' }}>
                <button className="btn btn-sm" disabled={busy || !target} onClick={() => run(() => api.moveImage(project.id, name, target))}>
                  Assign
                </button>
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => api.removeImage(project.id, name))}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SceneSelect(props: {
  id: string;
  value: string;
  scenes: string[];
  project: Project;
  emptyLabel: string;
  disabled: boolean;
  onChange: (scene: string) => void;
}) {
  return (
    <select id={props.id} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">{props.emptyLabel}</option>
      {props.scenes.map((s) => (
        <option key={s} value={s}>
          {s}
          {props.project.images[s] ? ' (replaces current)' : ''}
        </option>
      ))}
    </select>
  );
}
