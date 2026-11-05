import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraAt, maxShift } from './camera.ts';

const FRAME = 1 / 30;

test('motion off leaves the image still', () => {
  assert.deepEqual(cameraAt({ t: 12.3, clipIndex: 2, motion: 'off' }), { scale: 1, x: 0, y: 0 });
});

test('zoom moves through a 6% range', () => {
  const scales = Array.from({ length: 800 }, (_, i) => cameraAt({ t: i * 0.25, clipIndex: 0, motion: 'subtle' }).scale);
  const range = Math.max(...scales) - Math.min(...scales);
  assert.ok(range > 0.059 && range <= 0.0601, `range ${range}`);
});

test('the image always covers the whole frame', () => {
  for (let clipIndex = 0; clipIndex < 6; clipIndex++) {
    for (let t = 0; t < 300; t += 0.41) {
      const c = cameraAt({ t, clipIndex, motion: 'subtle' });
      assert.ok(Math.abs(c.x) <= maxShift(c.scale) + 1e-9 && Math.abs(c.y) <= maxShift(c.scale) + 1e-9, `edge visible at t=${t}`);
    }
  }
});

test('zoom speed is constant most of the time (no long slow-downs)', () => {
  const speeds: number[] = [];
  for (let t = 0; t < 100; t += FRAME) {
    const a = cameraAt({ t, clipIndex: 0, motion: 'subtle' }).scale;
    const b = cameraAt({ t: t + FRAME, clipIndex: 0, motion: 'subtle' }).scale;
    speeds.push(Math.abs(b - a) / FRAME);
  }
  const top = Math.max(...speeds);
  const steady = speeds.filter((s) => s > top * 0.8).length / speeds.length;
  assert.ok(steady > 0.85, `only ${(steady * 100).toFixed(0)}% of frames at steady speed`);
  assert.ok(top > 0.003 && top < 0.006, `zoom speed ${top}/s should be visible but slow`);
});

test('movement between frames is tiny, so there are no jerks', () => {
  let maxScaleStep = 0;
  let maxPanStep = 0;
  for (let t = 0; t < 300; t += FRAME) {
    const a = cameraAt({ t, clipIndex: 1, motion: 'subtle' });
    const b = cameraAt({ t: t + FRAME, clipIndex: 1, motion: 'subtle' });
    maxScaleStep = Math.max(maxScaleStep, Math.abs(b.scale - a.scale));
    maxPanStep = Math.max(maxPanStep, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }
  assert.ok(maxScaleStep < 0.0002, `scale step ${maxScaleStep}`);
  assert.ok(maxPanStep < 0.005, `pan step ${maxPanStep}%`);
});
