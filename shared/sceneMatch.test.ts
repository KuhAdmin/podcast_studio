import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignImagesToScenes } from './sceneMatch.ts';

const scenes = ['cozy-studio', 'sunny-meadow', 'inside-the-hive', 'busy-city-street'];
const file = (name: string, lastModified = 0) => ({ name, lastModified });

test('matches scene names in file names, ignoring case, spaces, underscores and hyphens', () => {
  assert.deepEqual(
    assignImagesToScenes([file('Sunny Meadow.png'), file('busy_city_street-v2.jpg'), file('COZY-STUDIO.webp')], scenes),
    ['sunny-meadow', 'busy-city-street', 'cozy-studio'],
  );
});

test('falls back to download order for unrecognisable ChatGPT file names', () => {
  const files = [
    file('ChatGPT Image Nov 4, 2026, 05_14_10 PM.png', 4),
    file('ChatGPT Image Nov 4, 2026, 05_10_22 PM.png', 1),
    file('ChatGPT Image Nov 4, 2026, 05_12_40 PM.png', 3),
    file('ChatGPT Image Nov 4, 2026, 05_11_05 PM.png', 2),
  ];
  assert.deepEqual(assignImagesToScenes(files, scenes), ['busy-city-street', 'cozy-studio', 'inside-the-hive', 'sunny-meadow']);
});

test('order fallback skips scenes already matched by name', () => {
  assert.deepEqual(assignImagesToScenes([file('a.png', 1), file('inside-the-hive.png', 2), file('b.png', 3)], scenes), [
    'cozy-studio',
    'inside-the-hive',
    'sunny-meadow',
  ]);
});

test('fills scenes without an image before replacing existing ones', () => {
  const taken = new Set(['cozy-studio', 'sunny-meadow']);
  assert.deepEqual(assignImagesToScenes([file('x.png', 1), file('y.png', 2)], scenes, taken), ['inside-the-hive', 'busy-city-street']);
});

test('extra images beyond the number of scenes stay unassigned', () => {
  const files = [1, 2, 3, 4, 5].map((n) => file(`img${n}.png`, n));
  assert.deepEqual(assignImagesToScenes(files, scenes), [...scenes, null]);
});

test('a longer scene name wins over one it contains', () => {
  assert.deepEqual(assignImagesToScenes([file('city-street-night.png')], ['city-street', 'city-street-night']), ['city-street-night']);
});
