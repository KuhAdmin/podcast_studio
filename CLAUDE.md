# Podcast Video Creator

A simple local web app that turns a podcast script into a YouTube-ready MP4. The video has expressive multi-speaker audio from ElevenLabs, a scene image track and an animated waveform.

## Workflow (end to end)

1. **ChatGPT:** write the podcast script in the strict format below.
2. **ChatGPT:** add ElevenLabs audio tags (`[laughs]`, `[whispers]`, `[sighs]`, …) and `[SCENE: name]` markers.
3. **ChatGPT:** produce the list of settings (one per scene name) and an image prompt for each. Generate clean 16:9 images.
4. **App:** paste the script and map each speaker to an ElevenLabs voice ID.
5. **App:** generate the audio. The backend calls Text-to-Dialogue (Eleven v4) as a background job and saves `audio.mp3` and `timestamps.json`.
6. **App:** upload the scene images and assign each one to a scene name.
7. **App:** the timeline fills itself in (images placed at their scene start times). Fine-tune by dragging.
8. **App:** preview with the Remotion Player (images + audio + animated waveform).
9. **App:** render a 1080p MP4 into `projects/<id>/output/`.
10. *(Optional)* Final touches in OpenShot (intro/outro, B-roll).
11. Upload to YouTube (manual for v1).

### Script format (contract between ChatGPT and the app)

```
[SCENE: cozy-studio]
Alex: [excited] Welcome back to the show!
Sam: [laughs] Glad to be here.
[SCENE: city-rooftop]
Alex: [whispers] Let me tell you a secret...
```

- One line per turn, written as `Speaker: text`. Speaker names must match the voice mapping.
- `[SCENE: kebab-name]` sits on its own line. It is removed before TTS and used only for the timeline.
- Inline `[tag]` audio tags stay in the text sent to ElevenLabs. They work with the Eleven v4 (default) and v3 models.

## Architecture

```
ChatGPT (manual) ──► script (Speaker: line + [SCENE:x] + audio tags)  
                           │ paste
                           ▼
React (Vite + TS) ──► Node/Express API ──► ElevenLabs Text-to-Dialogue (v4)
  │  Script editor         │  saves audio.mp3 + timestamps.json
  │  Voice mapping         │  saves images/
  │  Timeline (2 tracks)   │  project.json (single source of truth)
  │  Remotion Player       └─► Remotion renderer ──► output/video.mp4
  ▼
(optional) OpenShot ──► YouTube
```

One npm package (no workspaces), plain folders:

- **shared/:** types (`types.ts`), script parser + chunker (`script.ts`), auto-layout/snapping/video-props builder (`timeline.ts`). Used by web, server and video. Unit tests in `script.test.ts`.
- **web/:** Vite + React + TypeScript. Five steps (`web/src/steps/`): Script → Voices & audio → Scene images → Timeline & preview → Render. Custom two-track timeline (`components/Timeline.tsx`) and `@remotion/player` preview. `useProject.ts` autosaves edits (debounced PUT). Deep link: `?project=<id>&step=<script|audio|scenes|editor|export>`.
- **server/:** Express + TypeScript run with tsx. `elevenlabs.ts` (voices, Text-to-Dialogue with timestamps), `audio.ts` (chunk → TTS → ffmpeg concat → timestamps + peaks → auto-layout), `render.ts` (Remotion bundle + renderMedia, in-memory job status), `projects.ts` (file storage).
- **video/:** the Remotion composition (`PodcastVideo.tsx`): image clips with crossfade + Ken Burns, audio, scrolling waveform, speaker name, title badge. `index.ts` is the bundler entry point.
- **prompts/:** ChatGPT prompt templates; also shown with Copy buttons in the Script step.
- **characters/:** character reference sheets (`shilpa.png`, `arjun.png`) and their profiles/voice pairing (`README.md`). The Script step offers them as downloads next to prompt 3, which tells ChatGPT to keep both characters identical across scene images.
- **projects/<id>/:** `project.json`, `audio.mp3`, `timestamps.json`, `peaks.json`, `images/`, `output/video.mp4`. Git-ignored; no database.

### API

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/projects` | List / create |
| GET/PUT | `/api/projects/:id` | Read / save editable fields (name, script, voices, timeline, settings) |
| GET | `/api/voices` | ElevenLabs voice list (proxied) |
| POST/GET | `/api/projects/:id/tts` | Start audio generation (background job; re-runs auto-layout) / poll its progress |
| POST/DELETE | `/api/projects/:id/images[/:scene]` | Upload (multipart `scene`, `file`) / remove a scene image |
| POST/GET | `/api/projects/:id/render` | Start render / poll status |
| GET | `/files/:id/...` | Project media (CORS enabled for the renderer) |

## Running

Requirements: Node 20+, ffmpeg + ffprobe on PATH (or set `FFMPEG_PATH`/`FFPROBE_PATH`).

```
npm install
cp .env.example .env      # add ELEVENLABS_API_KEY
npm run dev               # API on :3001, app on http://localhost:6173
npm test                  # parser / layout unit tests
npm run typecheck
```

The first render downloads Chrome Headless Shell (~130 MB) and bundles the composition, so it is slower than later renders.

## Conventions

- **Never call ElevenLabs from the browser.** `ELEVENLABS_API_KEY` lives only in `.env` (created by `npx -y @elevenlabs/cli@latest onboard init`), loaded by `dotenv` in `server/index.ts`. `server/elevenlabs.ts` uses the official SDK `@elevenlabs/elevenlabs-js`, which reads the key from the environment; never pass it in code.
- Model: `ELEVENLABS_MODEL` in `.env` (default `eleven_v4`; Text to Dialogue also accepts `eleven_v3`). Shown in the Voices step via `/api/health`.
- `project.json` is the single source of truth. Server-owned fields (`audio`, `images`) are only changed by their endpoints; PUT ignores them.
- Times are stored in **seconds** (floats). Convert to frames only inside the Remotion composition / Player.
- Video output is 1920×1080, 30 fps, H.264 + AAC (`VIDEO` in `shared/types.ts`).
- TTS: SDK `textToDialogue.convertWithTimestamps` (`POST /v1/text-to-dialogue/with-timestamps`), max 2,000 chars per request (we chunk at 1,800 on turn boundaries) and max 10 unique voices. Each chunk passes `previousText`/`futureText` for continuity. Chunk timestamps are shifted by the ffprobe duration of the preceding chunks. `voiceSegments[].dialogueInputIndex` gives per-line timing.
- Waveforms (timeline and video) are drawn from `peaks.json` (100 amplitude values per second, computed with ffmpeg at generation time) instead of decoding audio in the browser. This replaced wavesurfer.js / `visualizeAudio` from the original plan so long episodes stay light.
- Default voices: `DEFAULT_VOICES` in `shared/voices.ts`; each lists the `characters` it plays (Shilpa → Monika Sogam, Arjun → Viraj), so those speaker names get the right voice regardless of who speaks first. Monika Sogam (`f1abxvIEijusskcPWE5x`, female) and Viraj (`3AMU7jXQuQa3oRvRqUmb`, male) are Voice Library voices, used directly by ID (allowed on paid plans; they don't need to be in *My Voices*, so they don't appear in `GET /api/voices` and are listed separately in the dropdown). Confirmed working with `eleven_v4` Text to Dialogue on 2026-11-04.
- Voice auto-assignment (`suggestVoices`): a speaker with no voice gets, in order, (1) the voice last picked for that name (browser `localStorage['voiceDefaults']`), (2) a default whose name starts with the speaker name, (3) an account voice whose name starts with the speaker name (`Jessica` → "Jessica - Playful, Bright, Warm"), or (4) the next unused default (first speaker → Monika, second → Viraj). Existing picks are never overridden.
- Pre-flight before any TTS call (`server/audio.ts` `preflight`): the script's characters must fit the plan's remaining quota (`GET /api/quota`). Otherwise generation stops with a clear error and spends no credits.
- Camera motion (`shared/camera.ts` `cameraAt`, used by `video/PodcastVideo.tsx`): one checkbox in the Look panel. When on, each scene image zooms between 103% and 109% (6% range) at a steady speed (15 s in, 15 s out, ≈0.4%/s) and pans gently (±1.3% / ±0.6%, 50–64 s cycles). `glide()` is a triangle wave with rounded 1–2 s turnarounds, so the motion is constant rather than easing to a stop. Nothing is tied to speaker changes or cuts. Shifts never reach the frame edge; tests check the 6% range, the steady speed and that per-frame steps stay tiny.
- `server/render.ts` re-bundles the composition whenever a file in `video/` or `shared/` changed since the last bundle.
- Captions (`shared/captions.ts`): built from the character timings ElevenLabs returns with the voice-over (`timestamps.json` `alignment`), not speech-to-text, so the text matches the script exactly and costs nothing. `buildCaptions` splits the timings by line (each `LineTiming` stores its voiced `text`; older projects fall back to the script and get no captions if lengths differ), drops `[tags]`, and groups words into cues (one speaker, sentence breaks, ≤80 chars, pause >0.8 s). `captionsFor()` in `shared/timeline.ts` feeds both the video (`Captions` in `video/PodcastVideo.tsx`, Look-panel toggle `showCaptions`) and `GET /api/projects/:id/captions.srt`.
- Image filenames are versioned (`<scene>-<stamp>.<ext>`) so replacing an image never shows a cached old one.
- Regenerating audio re-runs auto-layout, which discards manual timeline edits (old timings no longer apply).

## Licensing notes

- ElevenLabs audio needs a **paid plan** for commercial or monetized YouTube use.
- Remotion is free for individuals and companies with 3 or fewer people. Check this if the team grows.

## Todo

### Phase 0: Setup
- [x] Scaffold: `web/` (Vite React TS), `server/` (Express TS), `shared/`, `video/`, plus `.env.example` (`ELEVENLABS_API_KEY`).
- [x] `git init` and `.gitignore` (`.env`, `projects/`, `node_modules/`, `output/`).
- [x] ChatGPT prompt templates in `prompts/` (script, audio tagging, settings and image prompts).

### Phase 1: Script and audio
- [x] Script editor with a parser for `Speaker: line` and `[SCENE: x]`; issues list jumps to the offending line. Tolerates markdown bold speaker names and headings.
- [x] Speaker → voice mapping UI with voice previews (`GET /api/voices`), auto-assigned by remembered pick or matching name.
- [x] ElevenLabs via the official SDK; key set up with the ElevenLabs CLI (`onboard check` passes).
- [x] `POST /api/projects/:id/tts`: chunk, Text-to-Dialogue (v4) with timestamps, run as a polled background job, ffmpeg concat → `audio.mp3`.
- [x] `timestamps.json` (per-line timing + character alignment) and `peaks.json`.
- [x] Map each `[SCENE]` marker to the start time of its first line.
- [x] Stale-audio warning when the script or voices change after generation.

### Phase 2: Images
- [x] Upload (click or drag-and-drop) per scene name; replace / remove.
- [x] Warning for scenes without an image (they render as a dark background).
- [x] Bulk drop: all scene images at once; a tray pre-fills each image's scene (`shared/sceneMatch.ts`: file-name match, else download order) for confirmation. "Unused images" (scene renamed/removed) can be reassigned via `POST /api/projects/:id/images/:scene/assign` without re-uploading.

### Phase 3: Timeline editor
- [x] Audio track waveform (from peaks), ruler, playhead, zoom/fit, click-to-seek.
- [x] Image track auto-filled from scene start times; "Auto-layout from scenes" resets it.
- [x] Drag clip body to move, edges to resize; a shared cut moves both neighbours; snaps to sentence boundaries (Alt bypasses); arrow keys nudge.
- [x] Autosave to `project.json` (`PUT /api/projects/:id`).

### Phase 4: Preview and render
- [x] Remotion composition: images (crossfade + Ken Burns), audio, scrolling waveform, speaker name, title badge; toggles in the "Look" panel.
- [x] `@remotion/player` preview synced with the timeline playhead.
- [x] `POST /api/projects/:id/render` → `projects/<id>/output/video.mp4` with progress polling and an in-app player/download.

### Phase 5: Optional / later
- [x] Captions: words highlighted as spoken in the video, plus a `.srt` download for YouTube.
- [ ] Thumbnail generator.
- [ ] Generate the script with an LLM API inside the app, replacing the manual ChatGPT copy and paste.
- [ ] Upload with the YouTube Data API.
- [ ] Regenerate a single line instead of the whole episode.
- [ ] Persist render job status across server restarts.

## Verification checklist

- [x] **Script parsing:** `npm test` (two speakers, 3 scenes, malformed lines, chunking, layout, snapping).
- [ ] **Audio (real ElevenLabs):** a short test script (under 30 s) produces `audio.mp3` + `timestamps.json` and plays in the app. *Verified so far: the real key lists voices; real Text to Dialogue calls with both default library voices (eleven_v4) return audio + voice segments; the SDK pipeline (endpoint, model, stitching, chunking, concat, timing offsets, peaks, auto-layout) with a stubbed network. A real speech run is still pending.*
- [x] **Timeline:** scene images auto-place at the right times; dragging a cut updates `project.json`.
- [x] **Preview:** Player matches the timeline; seeking from the ruler moves the player; waveform animates.
- [ ] **Render:** verified on synthetic media (1920×1080, 30 fps, H.264/AAC, audio length matches). Still to do: a real episode watched end-to-end and an unlisted YouTube upload.
