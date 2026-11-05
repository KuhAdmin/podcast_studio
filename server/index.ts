import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { audioStatus, startAudioJob } from './audio.ts';
import { DIALOGUE_MODEL, getQuota, listVoices } from './elevenlabs.ts';
import { HttpError, PROJECTS_DIR, createProject, listProjects, projectDir, readProject, readTimestamps, updateProject, writeProject } from './projects.ts';
import { renderStatus, startRender } from './render.ts';
import { toSrt } from '../shared/captions.ts';
import { captionsFor } from '../shared/timeline.ts';
import { normalizeSceneName } from '../shared/script.ts';

const PORT = Number(process.env.PORT ?? 3001);
const app = express();
app.use(express.json({ limit: '5mb' }));

// Project media. CORS is needed because the Remotion renderer's headless browser loads these from another origin.
app.use('/files', cors(), express.static(PROJECTS_DIR, { fallthrough: false }));

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const param = (req: Request, name: string) => String(req.params[name]);

app.get('/api/health', h(async (_req, res) => res.json({ ok: true, elevenlabsKey: Boolean(process.env.ELEVENLABS_API_KEY), model: DIALOGUE_MODEL() })));

app.get('/api/projects', h(async (_req, res) => res.json(await listProjects())));
app.post('/api/projects', h(async (req, res) => res.status(201).json(await createProject(String(req.body?.name ?? '')))));
app.get('/api/projects/:id', h(async (req, res) => res.json(await readProject(param(req, 'id')))));
app.put('/api/projects/:id', h(async (req, res) => res.json(await updateProject(param(req, 'id'), req.body ?? {}))));
// Subtitles for YouTube, built from the character timings saved with the voice-over.
app.get('/api/projects/:id/captions.srt', h(async (req, res) => {
  const project = await readProject(param(req, 'id'));
  const cues = captionsFor(project, await readTimestamps(project.id));
  if (cues.length === 0) throw new HttpError(404, 'No captions yet: generate the voice-over first (or regenerate it if the script changed).');
  res.setHeader('Content-Disposition', `attachment; filename="${project.id}.srt"`);
  res.type('application/x-subrip').send(toSrt(cues));
}));
app.get('/api/projects/:id/timestamps', h(async (req, res) => res.json(await readTimestamps(param(req, 'id')))));

app.get('/api/voices', h(async (_req, res) => res.json(await listVoices())));
app.get('/api/quota', h(async (_req, res) => res.json(await getQuota())));

app.post('/api/projects/:id/tts', h(async (req, res) => res.status(202).json(startAudioJob(param(req, 'id')))));
app.get('/api/projects/:id/tts', h(async (req, res) => res.json(audioStatus(param(req, 'id')))));

const IMAGE_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype in IMAGE_EXT),
});

app.post('/api/projects/:id/images', upload.single('file'), h(async (req, res) => {
  const id = param(req, 'id');
  const scene = normalizeSceneName(String(req.body?.scene ?? ''));
  if (!scene) throw new HttpError(400, 'Missing scene name');
  if (!req.file) throw new HttpError(400, 'Upload a PNG, JPEG or WebP image');
  const project = await readProject(id);
  const imagesDir = path.join(projectDir(id), 'images');
  await fs.mkdir(imagesDir, { recursive: true });
  // Versioned filename so browsers and the Remotion Player never show a cached old image.
  const filename = `${scene}-${Date.now().toString(36)}${IMAGE_EXT[req.file.mimetype]}`;
  await fs.writeFile(path.join(imagesDir, filename), req.file.buffer);
  const old = project.images[scene];
  project.images[scene] = filename;
  await writeProject(project);
  if (old) await fs.rm(path.join(imagesDir, old), { force: true });
  res.json(project);
}));

app.delete('/api/projects/:id/images/:scene', h(async (req, res) => {
  const project = await readProject(param(req, 'id'));
  const old = project.images[param(req, 'scene')];
  delete project.images[param(req, 'scene')];
  await writeProject(project);
  if (old) await fs.rm(path.join(projectDir(project.id), 'images', old), { force: true });
  res.json(project);
}));

// Moves an already-uploaded image to another scene (e.g. an image left unused after scene names changed).
app.post('/api/projects/:id/images/:scene/assign', h(async (req, res) => {
  const project = await readProject(param(req, 'id'));
  const scene = normalizeSceneName(param(req, 'scene'));
  const from = String(req.body?.from ?? '');
  const file = project.images[from];
  if (!scene) throw new HttpError(400, 'Missing scene name');
  if (!file) throw new HttpError(404, `No image is stored under "${from}"`);
  if (from === scene) return res.json(project);
  const old = project.images[scene];
  project.images[scene] = file;
  delete project.images[from];
  await writeProject(project);
  if (old && old !== file) await fs.rm(path.join(projectDir(project.id), 'images', old), { force: true });
  res.json(project);
}));

app.post('/api/projects/:id/render', h(async (req, res) => res.status(202).json(await startRender(param(req, 'id'), PORT))));
app.get('/api/projects/:id/render', h(async (req, res) => res.json(renderStatus(param(req, 'id')))));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : (err as { status?: number }).status ?? 500;
  const message = err instanceof Error ? err.message : 'Unexpected error';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
  if (!process.env.ELEVENLABS_API_KEY) console.warn('ELEVENLABS_API_KEY is not set; audio generation will fail.');
});
