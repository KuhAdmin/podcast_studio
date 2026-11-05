import type { AudioJobState, Peaks, Project, ProjectSummary, RenderState, Timestamps, Voice } from '../../shared/types.ts';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export const api = {
  health: () => call<{ ok: boolean; elevenlabsKey: boolean; model: string }>('/api/health'),
  listProjects: () => call<ProjectSummary[]>('/api/projects'),
  createProject: (name: string) => call<Project>('/api/projects', json('POST', { name })),
  getProject: (id: string) => call<Project>(`/api/projects/${id}`),
  saveProject: (p: Project) => call<Project>(`/api/projects/${p.id}`, json('PUT', p)),
  timestamps: (id: string) => call<Timestamps | null>(`/api/projects/${id}/timestamps`),
  peaks: (id: string, version: string) => call<Peaks>(`/files/${id}/peaks.json?v=${encodeURIComponent(version)}`),
  voices: () => call<Voice[]>('/api/voices'),
  quota: () => call<{ used: number; limit: number; remaining: number; resetsAt: string | null } | null>('/api/quota'),
  startAudio: (id: string) => call<AudioJobState>(`/api/projects/${id}/tts`, { method: 'POST' }),
  audioStatus: (id: string) => call<AudioJobState>(`/api/projects/${id}/tts`),
  uploadImage: (id: string, scene: string, file: File) => {
    const form = new FormData();
    form.append('scene', scene);
    form.append('file', file);
    return call<Project>(`/api/projects/${id}/images`, { method: 'POST', body: form });
  },
  moveImage: (id: string, from: string, to: string) =>
    call<Project>(`/api/projects/${id}/images/${encodeURIComponent(to)}/assign`, json('POST', { from })),
  removeImage: (id: string, scene: string) =>
    call<Project>(`/api/projects/${id}/images/${encodeURIComponent(scene)}`, { method: 'DELETE' }),
  startRender: (id: string) => call<RenderState>(`/api/projects/${id}/render`, { method: 'POST' }),
  renderStatus: (id: string) => call<RenderState>(`/api/projects/${id}/render`),
};

export const fileUrl = (id: string, file: string) => `/files/${id}/${file}`;
