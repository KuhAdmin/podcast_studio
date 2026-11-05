import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptions, srtTime, stripTags, toSrt } from './captions.ts';
import type { Alignment } from './types.ts';

/** Fake timings: each character takes 0.05 s, tags take ~0, and line i starts at `lineStarts[i]`. */
function align(texts: string[], lineStarts: number[]): Alignment {
  const a: Alignment = { characters: [], starts: [], ends: [] };
  texts.forEach((text, li) => {
    let t = lineStarts[li];
    let inTag = false;
    for (const ch of text) {
      if (ch === '[') inTag = true;
      const d = inTag ? 0.001 : 0.05;
      a.characters.push(ch);
      a.starts.push(t);
      a.ends.push(t + d);
      t += d;
      if (ch === ']') inTag = false;
    }
  });
  return a;
}

test('drops audio tags and times words from their characters', () => {
  const lines = [{ speaker: 'Arjun', text: '[excited] Hello there, friends!' }];
  const [cue] = buildCaptions(lines, align(lines.map((l) => l.text), [1]));
  assert.deepEqual(cue.words.map((w) => w.text), ['Hello', 'there,', 'friends!']);
  assert.ok(cue.words[0].start > 1 && cue.words[0].start < 1.07, 'Hello starts right after the near-zero tag and one space');
  assert.ok(cue.words[1].start > cue.words[0].end);
});

test('tags in the middle of a line and punctuation-only tokens', () => {
  const lines = [{ speaker: 'Shilpa', text: 'Wait — really? [laughs] No way.' }];
  const [cue] = buildCaptions(lines, align([lines[0].text], [0]));
  assert.deepEqual(cue.words.map((w) => w.text), ['Wait —', 'really?', 'No', 'way.']);
});

test('a caption never spans two speakers', () => {
  const lines = [
    { speaker: 'Arjun', text: 'Hi' },
    { speaker: 'Shilpa', text: 'Hello' },
  ];
  const cues = buildCaptions(lines, align(lines.map((l) => l.text), [0, 0.2]));
  assert.deepEqual(cues.map((c) => [c.speaker, c.words.map((w) => w.text).join(' ')]), [['Arjun', 'Hi'], ['Shilpa', 'Hello']]);
});

test('breaks at sentence ends, joins very short sentences, and caps the length', () => {
  const text = 'Exactly! And that is our topic for today, everyone. ' + 'word '.repeat(30).trim();
  const lines = [{ speaker: 'Arjun', text }];
  const cues = buildCaptions(lines, align([text], [0]));
  assert.equal(cues[0].words.map((w) => w.text).join(' '), 'Exactly! And that is our topic for today, everyone.');
  for (const c of cues) assert.ok(c.words.map((w) => w.text).join(' ').length <= 80);
});

test('breaks at a long pause', () => {
  const lines = [{ speaker: 'Arjun', text: 'one two three four five six seven' }];
  const a = align([lines[0].text], [0]);
  const pauseAt = lines[0].text.indexOf('four');
  for (let i = pauseAt; i < a.starts.length; i++) {
    a.starts[i] += 2;
    a.ends[i] += 2;
  }
  assert.deepEqual(buildCaptions(lines, a).map((c) => c.words.length), [3, 4]);
});

test('captions stay up briefly but never overlap the next one', () => {
  const lines = [
    { speaker: 'Arjun', text: 'First sentence that is long enough here.' },
    { speaker: 'Shilpa', text: 'Second one.' },
  ];
  const cues = buildCaptions(lines, align(lines.map((l) => l.text), [0, 2.1]));
  assert.ok(cues[0].end <= cues[1].start);
  assert.ok(cues[0].end > cues[0].words.at(-1)!.end);
});

test('no captions when the timings do not match the text', () => {
  const lines = [{ speaker: 'Arjun', text: 'Hello there' }];
  assert.deepEqual(buildCaptions(lines, align(['Hello'], [0])), []);
  assert.deepEqual(buildCaptions(lines, null), []);
});

test('SRT formatting', () => {
  assert.equal(srtTime(3723.45), '01:02:03,450');
  const lines = [{ speaker: 'Arjun', text: '[warmly] Hello everyone, welcome back to another episode of our show.' }];
  const srt = toSrt(buildCaptions(lines, align([lines[0].text], [1.5])));
  assert.match(srt, /^1\n00:00:01,5\d\d --> 00:00:0\d,\d{3}\nHello everyone, welcome back to\nanother episode of our show\.\n$/);
});

test('stripTags', () => {
  assert.equal(stripTags('[excited] Hello, [laughs] world!'), 'Hello, world!');
});
