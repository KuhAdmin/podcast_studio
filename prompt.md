# Episode prompt: "Busy as a bee" (general audience, 6–8 min, 2 speakers)

## Context
The user wants a ChatGPT prompt for an episode about the idiom "busy as a bee". The result must paste straight into the app with no blockers.

The standard idiom is **"(as) busy as a bee"**. "Busy bee" is a related noun. "Busybody" means something different: a nosy person. That mix-up becomes a segment of the episode.

Decisions from the user:
- **Audience:** general.
- **Length:** 6–8 minutes, about 1,000 words or 6,000 characters, which means about 4 ElevenLabs requests.
- **Speakers:** 2. The user already has **two premade ElevenLabs voices**.
- **Speaker names:** the speakers in the script carry **those voices' own names**.
- **Auto-assign:** the app should **remember the voice per speaker name**, so voices don't have to be picked for every episode.

## What would block the app, and the prompt rule that prevents it

| App behaviour (verified in code) | Rule in the prompt |
|---|---|
| `shared/script.ts` `parseScript`: any non-empty line that is not `Name: text` or `[SCENE: x]` is an **error**, and errors block generation. | Output only script lines in one code block, copied with ChatGPT's Copy button so the ``` fences are not pasted. |
| `Title: …`, `Episode: …` or `Note: …` lines parse as extra **speakers**. | Never write a title, label or notes line. |
| Dialogue before the first `[SCENE]` gives a warning, and a scene with no lines after it also gives a warning. | The first line must be a `[SCENE]` marker, and every scene must have at least 6 lines. |
| Every spelling variant of a name becomes a new speaker that needs its own voice. | Use the two names spelled exactly as given, on every line. |
| ElevenLabs reads `(laughs)` and `*laughs*` aloud. Only `[tags]` work (Eleven v4, the app default, and v3). | Only use square-bracket audio tags. |
| Requests are capped at 2,000 characters, and the app splits at 1,800 on line boundaries. | Every turn must be under 300 characters. |
| Images are matched by scene name, which is normalised to kebab-case. | Use these fixed kebab-case scene names, and reuse the exact name when a setting returns. |
| TTS can misread digits, symbols and emoji. | Write numbers as words. No emoji, URLs or symbols. |

## How speaker names connect to your two voice IDs
ChatGPT never outputs voice IDs. The speaker names in the script are labels, and the app maps each one to a `voice_id`. The mapping is stored in `project.json` as `voices: { "<Name>": "<voice_id>" }`, and `server/audio.ts` sends each line with its speaker's `voice_id`.

Because the script uses the voices' own names, the app can pick the voices automatically (see the code change below):
0. **Default voices:** Monika Sogam (`f1abxvIEijusskcPWE5x`, female) and Viraj (`3AMU7jXQuQa3oRvRqUmb`, male) are the app defaults, set in `shared/voices.ts` `DEFAULT_VOICES`. A speaker named `Monika` or `Viraj` gets that voice. Any other speakers get them in order: the first speaker gets Monika, the second gets Viraj. Both are Voice Library voices. The app uses them directly by ID, which ElevenLabs allows on paid plans, so they don't need to be added to *My Voices*.
1. **Remembered mapping:** if this speaker name was mapped to a voice in any earlier project, reuse that voice.
2. **Name match:** otherwise, choose the voice in your account whose name starts with the speaker name. For example, speaker `Jessica` matches the voice "Jessica" or "Jessica - Playful". The match ignores case.
3. **No match:** the dropdown stays empty, and you pick once. From then on that choice is remembered.

What this means for you: in the prompt, use **only the first name** of each voice exactly as ElevenLabs shows it (e.g. `Jessica`, not `Jessica - Playful`). The name must not contain `[ ] : *`.

## Prompt 1: script with audio tags (paste into a new ChatGPT chat)
The speakers are the two default voices: **Monika** (Monika Sogam - Premium Hindi Commercial, female) and **Viraj** (Viraj - Rich, Confident and Expressive, male). The personality lines are written to suit how each voice sounds.

```
You are an award-winning podcast writer. Write a 6–8 minute podcast episode (about 1,000 spoken words) for a general audience about the English idiom "as busy as a bee".

SPEAKERS — use exactly these two names, spelled identically on every line:
- Monika: the host. Warm, bright, polished and quick-witted; keeps the episode moving.
- Viraj: the co-host. Deep-voiced, calm, dry sense of humour; tells facts like a mystery being revealed; sometimes gets things slightly wrong so Monika can correct him.

EPISODE FLOW — exactly 5 scenes, in this order, with these exact scene names:
1. [SCENE: cozy-studio] — Cold open: Viraj admits he has been "busy as a busybee" all week; Monika teases him and sets up the topic.
2. [SCENE: sunny-meadow] — What the idiom means, how and when people use it, three natural everyday example sentences, and how it differs from "busy bee" and "busybody" (Viraj mixes these up).
3. [SCENE: inside-the-hive] — Why bees earned this reputation: real, well-established honeybee facts (foraging trips, the waggle dance, division of work in the hive, how little honey one bee makes in its lifetime). Only include facts that are widely accepted; no made-up numbers.
4. [SCENE: busy-city-street] — Modern life: is being busy as a bee a compliment or a warning sign? Busy versus productive. Two or three related expressions (for example "a hive of activity", "worker bee", "the bee's knees"), each explained in one line.
5. [SCENE: cozy-studio] — Wrap-up: a quick recap of the meaning and one example sentence, a light joke callback to the cold open, and a friendly sign-off.

OUTPUT FORMAT — this is pasted straight into software, so follow it exactly:
- The very first line is [SCENE: cozy-studio].
- After that, every line is either a scene marker exactly as listed above, or one spoken turn in the form
  Name: what they say
- Every scene has at least 6 spoken lines.
- Nothing else: no title, no episode name, no "Title:", "Intro:", "Note:" or "Narrator:" lines, no headings, no blank-speaker lines, no summary, no explanations before or after.
- Put the whole script inside ONE plain-text code block.

SPOKEN-AUDIO RULES (the script is voiced by ElevenLabs Eleven v4 text-to-speech):
- Add expressive audio tags in square brackets right before the words they affect, e.g. [laughs] [chuckles] [excited] [curious] [whispers] [sighs] [surprised] [playfully] [thoughtful] [sarcastic] [warmly] [interrupting] [pause].
- About one tag per line on average. Never more than two in a row. Never a line that is only a tag. Vary them.
- Never use parentheses or asterisks for actions or emotions, e.g. not (laughs) or *laughs*, because they would be read aloud.
- Square brackets are only for audio tags and scene markers.
- Keep each spoken turn under 300 characters. Prefer short, natural back-and-forth with reactions ("Wait, really?", "Exactly!").
- Write numbers as words ("twelve", not "12"). No emoji, no URLs, no symbols like & or %, no abbreviations.
- Use ellipses (…) and dashes (—) for natural pauses and hesitations; CAPITALISE a single word occasionally for emphasis.
- No stage directions, no sound-effect descriptions, no narrator.
```

## Prompt 2: scene images (send in the same chat, after the script)

```
Now write one image-generation prompt for each unique scene in the script: cozy-studio, sunny-meadow, inside-the-hive, busy-city-street.

Requirements for every prompt:
- 16:9 landscape background image.
- One shared style for all four, stated identically in each prompt: "warm, softly lit cinematic illustration, rich honey-gold and green palette, gentle depth of field".
- No people, no text, no letters, no logos, no watermarks.
- Keep the lower third of the frame visually calm and slightly darker (a waveform and speaker name sit there).
- Match the mood of what is said in that scene.

Output format, one per line, nothing else:
scene-name: prompt
```

Then ask ChatGPT to generate each image, one at a time ("Generate the image for sunny-meadow, landscape"). ChatGPT's landscape output is about 3:2. The app crops it to fill 16:9, so keep important details away from the top and bottom edges.

## Using it in the app
1. Paste only the code-block contents into **Script**. The Checks panel should show 2 speakers, 4 scenes and 4 TTS requests, with no errors.
2. **Voices & audio:** your two voices are selected automatically (by name match or from memory). Generate. This takes about 1–2 minutes and roughly 6,000 ElevenLabs characters.
3. **Scene images:** upload the 4 images. cozy-studio shows as "used 2×".
4. **Timeline:** check the cuts and set the title badge "Busy as a Bee".
5. **Render.**

## Follow-up changes

### 1. Auto-assign voices (remember per speaker + name match) — ✅ built
- **New `shared/voices.ts`:** a pure function `suggestVoices(speakers, current, voices, remembered)` that returns `Record<speaker, voice_id>` for speakers that have no voice yet.
  - It tries the remembered mapping first, but only if that voice ID is still in the account's voice list.
  - Otherwise it tries a case-insensitive match where the voice's name starts with the speaker name, followed by the end of the name or a non-letter character (so `Jess` doesn't match `Jessica`).
  - Speakers that already have a voice are never overridden.
- **New `shared/voices.test.ts`** covering:
  - The remembered mapping wins over a name match.
  - A stale remembered ID falls back to the name match.
  - A name match on prefixes like `Jessica - Playful`.
  - No partial-word match.
  - Existing mappings are untouched.
- **[web/src/steps/AudioStep.tsx](web/src/steps/AudioStep.tsx):**
  - Once `voices` load, run `suggestVoices` with `remembered` read from `localStorage['voiceDefaults']`. If it returns anything, apply it with a single `update(...)` call, which autosaves.
  - On a manual dropdown change, write `{ ...remembered, [speaker]: voiceId }` back to `localStorage['voiceDefaults']`.
  - Show a small muted note "Auto-selected from your last episode / by name" next to auto-assigned speakers, so the source is visible.
- **[CLAUDE.md](CLAUDE.md):** one line in Conventions describing voice auto-assignment.

### 2. Harden the prompt templates — not built yet
- **[prompts/1-script.md](prompts/1-script.md)** gains these rules:
  - No title/label/notes lines.
  - No parentheses or asterisk actions.
  - Turns under 300 characters.
  - Numbers as words, no emoji.
  - One code block, with a `[SCENE]` marker as the first line.
  - At least 6 lines per scene.
  - Speaker names = ElevenLabs voice first names.
- **[prompts/2-audio-tags.md](prompts/2-audio-tags.md):** add the "no parentheses or asterisk actions" rule.

## Verification
- `npm test`: the new `voices.test.ts` cases pass along with the existing 6 tests.
- `npm run typecheck` is clean.
- **Manual (needs your API key):** paste a script that uses your two voice names. On the Voices step both dropdowns should be pre-selected. Change one, create a second project with the same speaker names, and it should pre-select the changed voice.
