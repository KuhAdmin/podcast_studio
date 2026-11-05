export interface DroppedFile {
  name: string;
  lastModified: number;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Pre-fills a scene for each dropped image (result is in the same order as `files`; null = unassigned).
 * 1. Filename match: the file name contains the scene name, ignoring case, spaces, `_` and `-`
 *    ("Sunny Meadow.png" → sunny-meadow). Longer scene names win, so "city-street-night" beats "city-street".
 * 2. Order: remaining files, oldest first (download order ≈ the order ChatGPT generated them), take the
 *    remaining scenes in script order, filling scenes without an image (`taken`) before replacing ones that have one.
 */
export function assignImagesToScenes(files: DroppedFile[], scenes: string[], taken: Set<string> = new Set()): (string | null)[] {
  const result: (string | null)[] = files.map(() => null);
  const used = new Set<string>();
  const byLength = [...scenes].sort((a, b) => normalize(b).length - normalize(a).length);

  files.forEach((f, i) => {
    const name = normalize(f.name.replace(/\.[^.]+$/, ''));
    const scene = byLength.find((s) => !used.has(s) && normalize(s) && name.includes(normalize(s)));
    if (scene) {
      result[i] = scene;
      used.add(scene);
    }
  });

  const pool = [...scenes.filter((s) => !used.has(s) && !taken.has(s)), ...scenes.filter((s) => !used.has(s) && taken.has(s))];
  files
    .map((f, i) => ({ f, i }))
    .filter(({ i }) => result[i] === null)
    .sort((a, b) => a.f.lastModified - b.f.lastModified || a.f.name.localeCompare(b.f.name))
    .forEach(({ i }) => {
      result[i] = pool.shift() ?? null;
    });
  return result;
}
