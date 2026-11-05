import { useCallback, useEffect, useRef, useState } from 'react';
import type { Peaks, Project, Timestamps } from '../../shared/types.ts';
import { api } from './api.ts';

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

const SAVE_DELAY_MS = 600;
const RETRY_DELAY_MS = 3000;

/**
 * Loads a project and autosaves local edits (debounced). Server-produced changes (audio, images)
 * come back as whole projects via `replace`, which also reloads timestamps and peaks.
 */
export function useProject(id: string | null) {
  const [project, setProject] = useState<Project | null>(null);
  const [timestamps, setTimestamps] = useState<Timestamps | null>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [loadError, setLoadError] = useState<string | null>(null);
  const pending = useRef<Project | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const loadMedia = useCallback(async (p: Project) => {
    if (!p.audio) {
      setTimestamps(null);
      setPeaks(null);
      return;
    }
    const [ts, pk] = await Promise.all([api.timestamps(p.id), api.peaks(p.id, p.audio.generatedAt).catch(() => null)]);
    setTimestamps(ts);
    setPeaks(pk);
  }, []);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setSaveState('saving');
    try {
      await api.saveProject(p);
      setSaveState(pending.current ? 'unsaved' : 'saved');
    } catch {
      // Keep the unsaved version (unless a newer edit replaced it) and retry on our own.
      pending.current ??= p;
      setSaveState('error');
      timer.current = window.setTimeout(() => void flushRef.current(), RETRY_DELAY_MS);
    }
  }, []);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Warn before closing the tab while edits haven't reached the server.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  useEffect(() => {
    setProject(null);
    setTimestamps(null);
    setPeaks(null);
    setLoadError(null);
    if (!id) return;
    let cancelled = false;
    api
      .getProject(id)
      .then(async (p) => {
        if (cancelled) return;
        setProject(p);
        await loadMedia(p);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
      void flush();
    };
  }, [id, loadMedia, flush]);

  /** Local edit; saved automatically. */
  const update = useCallback(
    (fn: (p: Project) => Project) => {
      setProject((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        pending.current = next;
        return next;
      });
      setSaveState('unsaved');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  /** Server returned a new version of the project (after TTS, image upload…). */
  const replace = useCallback(
    async (p: Project) => {
      // Keep unsaved local edits; take only the server-owned fields from the response.
      const local = pending.current;
      const merged = local ? { ...local, audio: p.audio, images: p.images, timeline: p.timeline } : p;
      if (local) pending.current = merged;
      setProject(merged);
      await loadMedia(p);
    },
    [loadMedia],
  );

  return { project, timestamps, peaks, saveState, loadError, update, replace, flush };
}
