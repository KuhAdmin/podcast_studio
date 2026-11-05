import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { buildVideoProps } from '../shared/timeline.ts';
import type { RenderState } from '../shared/types.ts';
import { HttpError, projectDir, readProject, readTimestamps } from './projects.ts';

const COMPOSITION_ID = 'PodcastVideo';
const jobs = new Map<string, RenderState>();
let bundlePromise: Promise<string> | null = null;
let bundledVersion = '';

/** Newest modification time of the composition's source (video/ and shared/), used to detect edits. */
async function sourceVersion(): Promise<string> {
  let newest = 0;
  for (const dir of ['video', 'shared']) {
    for (const name of await fs.readdir(path.resolve(process.cwd(), dir))) {
      if (!/\.tsx?$/.test(name) || name.endsWith('.test.ts')) continue;
      newest = Math.max(newest, (await fs.stat(path.resolve(process.cwd(), dir, name))).mtimeMs);
    }
  }
  return String(newest);
}

/** Bundles the Remotion composition, re-bundling only when its source files changed since the last bundle. */
async function getBundle(): Promise<string> {
  const version = await sourceVersion();
  if (!bundlePromise || version !== bundledVersion) {
    bundledVersion = version;
    bundlePromise = bundle({
      entryPoint: path.resolve(process.cwd(), 'video/index.ts'),
      outDir: path.resolve(process.cwd(), '.remotion-bundle'),
    }).catch((err) => {
      bundlePromise = null;
      throw err;
    });
  }
  return bundlePromise;
}

export function renderStatus(id: string): RenderState {
  return jobs.get(id) ?? { state: 'idle' };
}

export async function startRender(id: string, port: number): Promise<RenderState> {
  const current = renderStatus(id);
  if (current.state === 'bundling' || current.state === 'rendering') {
    throw new HttpError(409, 'A render is already running for this project.');
  }
  const project = await readProject(id);
  if (!project.audio) throw new HttpError(400, 'Generate the audio before rendering.');
  const timestamps = await readTimestamps(id);
  const inputProps = buildVideoProps(project, timestamps, `http://localhost:${port}`);

  const state: RenderState = { state: 'bundling', progress: 0 };
  jobs.set(id, state);

  void (async () => {
    try {
      const serveUrl = await getBundle();
      const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
      jobs.set(id, { state: 'rendering', progress: 0 });
      const outDir = path.join(projectDir(id), 'output');
      await fs.mkdir(outDir, { recursive: true });
      const file = 'video.mp4';
      await renderMedia({
        serveUrl,
        composition,
        inputProps,
        codec: 'h264',
        audioCodec: 'aac',
        outputLocation: path.join(outDir, file),
        onProgress: ({ progress }) => jobs.set(id, { state: 'rendering', progress }),
      });
      jobs.set(id, { state: 'done', file: `output/${file}`, finishedAt: new Date().toISOString() });
    } catch (err) {
      console.error(`[render ${id}]`, err);
      jobs.set(id, { state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();

  return state;
}
