import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestVoices, type DefaultVoice } from './voices.ts';
import type { Voice } from './types.ts';

const voices: Voice[] = [
  { voice_id: 'v-jessica', name: 'Jessica - Playful, Bright, Warm' },
  { voice_id: 'v-brian', name: 'Brian' },
  { voice_id: 'v-jess', name: 'Jessamine' },
  { voice_id: 'v-monika-other', name: 'Monika Sogam – Smooth' },
];
const defaults: DefaultVoice[] = [
  { voiceId: 'd-monika', name: 'Monika Sogam - Premium', gender: 'female' },
  { voiceId: 'd-viraj', name: 'Viraj - Deep', gender: 'male' },
];

test('remembered voice wins over a name match', () => {
  assert.deepEqual(suggestVoices(['Brian'], {}, voices, { Brian: 'v-jessica' }, []), {
    Brian: { voiceId: 'v-jessica', source: 'remembered' },
  });
});

test('stale remembered voice falls back to the name match', () => {
  assert.deepEqual(suggestVoices(['Brian'], {}, voices, { Brian: 'deleted-voice' }, []), {
    Brian: { voiceId: 'v-brian', source: 'name' },
  });
});

test('matches a voice name with a descriptive suffix, case-insensitively', () => {
  assert.deepEqual(suggestVoices(['jessica'], {}, voices, {}, []), { jessica: { voiceId: 'v-jessica', source: 'name' } });
});

test('does not match part of a word', () => {
  assert.deepEqual(suggestVoices(['Jess'], {}, voices, {}, []), {});
});

test('never overrides an existing mapping', () => {
  assert.deepEqual(suggestVoices(['Brian', 'Jessica'], { Brian: 'v-jess' }, voices, { Brian: 'v-brian' }, []), {
    Jessica: { voiceId: 'v-jessica', source: 'name' },
  });
});

test('a default voice named like the speaker beats an account voice with the same name', () => {
  assert.deepEqual(suggestVoices(['Monika', 'Viraj'], {}, voices, {}, defaults), {
    Monika: { voiceId: 'd-monika', source: 'default' },
    Viraj: { voiceId: 'd-viraj', source: 'default' },
  });
});

test('unmatched speakers get the defaults in order, skipping ones already in use', () => {
  assert.deepEqual(suggestVoices(['Host', 'Guest'], {}, voices, {}, defaults), {
    Host: { voiceId: 'd-monika', source: 'default' },
    Guest: { voiceId: 'd-viraj', source: 'default' },
  });
  assert.deepEqual(suggestVoices(['Host', 'Guest'], { Host: 'd-monika' }, voices, {}, defaults), {
    Guest: { voiceId: 'd-viraj', source: 'default' },
  });
});

test('an account name match still wins over a default handed out by order', () => {
  assert.deepEqual(suggestVoices(['Jessica', 'Guest'], {}, voices, {}, defaults), {
    Jessica: { voiceId: 'v-jessica', source: 'name' },
    Guest: { voiceId: 'd-monika', source: 'default' },
  });
});

test('a remembered default voice is reused even though it is not in the account list', () => {
  assert.deepEqual(suggestVoices(['Host'], {}, voices, { Host: 'd-viraj' }, defaults), {
    Host: { voiceId: 'd-viraj', source: 'remembered' },
  });
});

test('a character name picks the voice that plays it, regardless of speaking order', () => {
  const cast: DefaultVoice[] = [
    { voiceId: 'd-monika', name: 'Monika Sogam - Premium', gender: 'female', characters: ['Shilpa'] },
    { voiceId: 'd-viraj', name: 'Viraj - Deep', gender: 'male', characters: ['Arjun'] },
  ];
  assert.deepEqual(suggestVoices(['Arjun', 'Shilpa'], {}, voices, {}, cast), {
    Arjun: { voiceId: 'd-viraj', source: 'default' },
    Shilpa: { voiceId: 'd-monika', source: 'default' },
  });
});
