import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkLines, parseScript, ttsInputHash } from './script.ts';
import { autoLayout, snap } from './timeline.ts';
import type { Timestamps } from './types.ts';

const SAMPLE = `# Episode 1

[SCENE: Cozy Studio]
Alex: [excited] Welcome back to the show!
**Sam:** [laughs] Glad to be here.

[SCENE: city-rooftop]
Alex: [whispers] Let me tell you a secret: it's 5pm.
Sam: Go on...
[SCENE: cozy-studio]
Alex: And we're back.
`;

test('parses speakers, lines and scenes', () => {
  const p = parseScript(SAMPLE);
  assert.deepEqual(p.issues, []);
  assert.deepEqual(p.speakers, ['Alex', 'Sam']);
  assert.equal(p.lines.length, 5);
  assert.deepEqual(
    p.scenes.map((s) => [s.name, s.firstLineIndex]),
    [['cozy-studio', 0], ['city-rooftop', 2], ['cozy-studio', 4]],
  );
  assert.equal(p.lines[1].text, '[laughs] Glad to be here.');
  assert.equal(p.lines[2].text, "[whispers] Let me tell you a secret: it's 5pm.");
  assert.equal(p.lines[3].scene, 'city-rooftop');
});

test('reports malformed lines and dialogue before the first scene', () => {
  const p = parseScript('Alex: hi\nthis line has no speaker\n[SCENE: a]\nSam: yo');
  assert.equal(p.issues.filter((i) => i.severity === 'error').length, 1);
  assert.equal(p.issues.find((i) => i.severity === 'error')?.sourceLine, 2);
  assert.ok(p.issues.some((i) => i.severity === 'warning' && /before the first/.test(i.message)));
});

test('chunks on turn boundaries under the limit', () => {
  const lines = Array.from({ length: 10 }, (_, i) => ({ text: 'x'.repeat(500), i }));
  const chunks = chunkLines(lines, 1800);
  assert.deepEqual(chunks.map((c) => c.length), [3, 3, 3, 1]);
});

test('input hash changes with voices', () => {
  const p = parseScript(SAMPLE);
  assert.notEqual(ttsInputHash(p.lines, { Alex: 'a', Sam: 'b' }), ttsInputHash(p.lines, { Alex: 'a', Sam: 'c' }));
});

test('auto layout places one clip per scene change', () => {
  const p = parseScript(SAMPLE);
  const ts: Timestamps = {
    duration: 20,
    alignment: { characters: [], starts: [], ends: [] },
    lines: [
      { index: 0, speaker: 'Alex', start: 0.2, end: 3 },
      { index: 1, speaker: 'Sam', start: 3.4, end: 6 },
      { index: 2, speaker: 'Alex', start: 6.5, end: 11 },
      { index: 3, speaker: 'Sam', start: 11.2, end: 14 },
      { index: 4, speaker: 'Alex', start: 14.5, end: 19.5 },
    ],
  };
  const clips = autoLayout(p, ts);
  assert.deepEqual(
    clips.map((c) => [c.scene, c.start, c.end]),
    [['cozy-studio', 0, 6.5], ['city-rooftop', 6.5, 14.5], ['cozy-studio', 14.5, 20]],
  );
});

test('snap picks the nearest point within threshold', () => {
  assert.equal(snap(6.42, [0, 6.5, 11], 0.2), 6.5);
  assert.equal(snap(8, [0, 6.5, 11], 0.2), 8);
});
