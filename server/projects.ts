import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, type Project, type ProjectSummary, type Timestamps } from '../shared/types.ts';

export const PROJECTS_DIR = path.resolve(process.cwd(), 'projects');

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function projectDir(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid project id');
  return path.join(PROJECTS_DIR, id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  const out: ProjectSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    try {
      const p = await readProject(e.name);
      out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt });
    } catch {
      // Skip folders without a valid project.json.
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createProject(name: string): Promise<Project> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'podcast';
  const id = `${slug}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const project: Project = {
    id,
    name: name.trim() || 'Untitled podcast',
    createdAt: now,
    updatedAt: now,
    script: '',
    voices: {},
    images: {},
    timeline: { clips: [] },
    settings: { ...DEFAULT_SETTINGS, title: name.trim() },
  };
  await fs.mkdir(path.join(projectDir(id), 'images'), { recursive: true });
  await writeProject(project);
  return project;
}

export async function readProject(id: string): Promise<Project> {
  try {
    const raw = await fs.readFile(path.join(projectDir(id), 'project.json'), 'utf8');
    const p = JSON.parse(raw) as Project;
    return { ...p, settings: { ...DEFAULT_SETTINGS, ...p.settings } };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Project not found');
    throw err;
  }
}

export async function writeProject(project: Project): Promise<Project> {
  project.updatedAt = new Date().toISOString();
  const file = path.join(projectDir(project.id), 'project.json');
  // Write-then-rename so a crash never leaves a half-written project.json.
  await fs.writeFile(`${file}.tmp`, JSON.stringify(project, null, 2));
  await fs.rename(`${file}.tmp`, file);
  return project;
}

/** Applies the editable fields from the client; server-owned fields (id, audio, images) are preserved. */
export async function updateProject(id: string, patch: Partial<Project>): Promise<Project> {
  const p = await readProject(id);
  if (typeof patch.name === 'string') p.name = patch.name;
  if (typeof patch.script === 'string') p.script = patch.script;
  if (patch.voices) p.voices = patch.voices;
  if (patch.timeline) p.timeline = patch.timeline;
  if (patch.settings) p.settings = { ...p.settings, ...patch.settings };
  return writeProject(p);
}

export async function readTimestamps(id: string): Promise<Timestamps | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(projectDir(id), 'timestamps.json'), 'utf8')) as Timestamps;
  } catch {
    return null;
  }
}
