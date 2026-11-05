import type { Voice } from './types.ts';

export type VoiceSource = 'remembered' | 'default' | 'name';

export interface VoiceSuggestion {
  voiceId: string;
  source: VoiceSource;
}

export interface DefaultVoice {
  voiceId: string;
  name: string;
  gender: 'female' | 'male';
  /** Character names this voice plays (see characters/README.md). */
  characters?: string[];
}

/**
 * House voices (ElevenLabs Voice Library). Speakers without a voice get these: by character or voice name first
 * ("Shilpa" or "Monika" → Monika Sogam), otherwise in this order (first speaker → female voice, second → male voice).
 * Voice Library voices can be used by ID directly (paid plans); they don't need to be in "My Voices".
 */
export const DEFAULT_VOICES: DefaultVoice[] = [
  { voiceId: 'f1abxvIEijusskcPWE5x', name: 'Monika Sogam - Premium Hindi Commercial', gender: 'female', characters: ['Shilpa'] },
  { voiceId: '3AMU7jXQuQa3oRvRqUmb', name: 'Viraj - Rich, Confident and Expressive', gender: 'male', characters: ['Arjun'] },
];

/**
 * Picks voices for speakers that don't have one yet. Per speaker, in order:
 * 1. the voice last picked for that speaker name (if it still exists in the account),
 * 2. a default voice that plays this character, or whose name starts with the speaker name,
 * 3. an account voice whose name starts with the speaker name ("Jessica" → "Jessica - Playful"),
 * 4. the next unused default voice.
 * Speakers that already have a voice are never touched.
 */
export function suggestVoices(
  speakers: string[],
  current: Record<string, string>,
  voices: Voice[],
  remembered: Record<string, string>,
  defaults: DefaultVoice[] = DEFAULT_VOICES,
): Record<string, VoiceSuggestion> {
  // Default voices count as available even though Voice Library voices are not listed in the account.
  const available = new Set([...voices.map((v) => v.voice_id), ...defaults.map((d) => d.voiceId)]);
  const out: Record<string, VoiceSuggestion> = {};
  const open = speakers.filter((s) => !current[s]);

  for (const speaker of open) {
    const memory = remembered[speaker];
    const byDefault = defaults.find((d) => d.characters?.some((c) => c.toLowerCase() === speaker.trim().toLowerCase()) || nameMatches(d.name, speaker));
    const byName = voices.find((v) => nameMatches(v.name, speaker));
    if (memory && available.has(memory)) out[speaker] = { voiceId: memory, source: 'remembered' };
    else if (byDefault) out[speaker] = { voiceId: byDefault.voiceId, source: 'default' };
    else if (byName) out[speaker] = { voiceId: byName.voice_id, source: 'name' };
  }

  const used = new Set([...Object.values(current), ...Object.values(out).map((s) => s.voiceId)]);
  const spare = defaults.filter((d) => !used.has(d.voiceId));
  for (const speaker of open) {
    if (out[speaker] || spare.length === 0) continue;
    out[speaker] = { voiceId: spare.shift()!.voiceId, source: 'default' };
  }
  return out;
}

function nameMatches(voiceName: string, speaker: string): boolean {
  const name = voiceName.trim().toLowerCase();
  const who = speaker.trim().toLowerCase();
  if (!who || !name.startsWith(who)) return false;
  const next = name.charAt(who.length);
  return next === '' || !/\p{L}/u.test(next);
}
