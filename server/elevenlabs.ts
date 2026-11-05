import { ElevenLabs, ElevenLabsClient, ElevenLabsError, ElevenLabsTimeoutError } from '@elevenlabs/elevenlabs-js';
import type { Voice } from '../shared/types.ts';
import { HttpError } from './projects.ts';

/** Text to Dialogue accepts the Eleven v3 and v4 models; both support inline [audio tags]. */
export const DIALOGUE_MODEL = () => process.env.ELEVENLABS_MODEL || 'eleven_v4';

let client: ElevenLabsClient | null = null;

/** Created lazily so `.env` (loaded by dotenv in server/index.ts) is in place. The SDK reads ELEVENLABS_API_KEY itself. */
function elevenlabs(): ElevenLabsClient {
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new HttpError(500, 'ELEVENLABS_API_KEY is not set. Run `npx -y @elevenlabs/cli@latest onboard init` or add it to .env, then restart the server.');
  }
  client ??= new ElevenLabsClient({ timeoutInSeconds: 300, maxRetries: 2 });
  return client;
}

/** Turns SDK errors into HttpErrors with a readable message for the UI. */
async function call<T>(what: string, fn: (c: ElevenLabsClient) => Promise<T>): Promise<T> {
  try {
    return await fn(elevenlabs());
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof ElevenLabsTimeoutError) throw new HttpError(504, `ElevenLabs timed out while ${what}. Try again.`);
    if (err instanceof ElevenLabsError) {
      const status = err.statusCode ?? 502;
      const detail = describe(err.body) ?? err.message;
      if (status === 401) throw new HttpError(401, `ElevenLabs rejected the API key (${detail}).`);
      if (status === 429) throw new HttpError(429, `ElevenLabs rate limit or quota reached (${detail}).`);
      throw new HttpError(status >= 400 && status < 500 ? 400 : 502, `ElevenLabs error while ${what}: ${detail}`);
    }
    throw err;
  }
}

function describe(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return typeof body === 'string' ? body : undefined;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? JSON.stringify(d)).join('; ');
  if (detail && typeof detail === 'object') return (detail as { message?: string }).message ?? JSON.stringify(detail);
  return JSON.stringify(body);
}

export async function listVoices(): Promise<Voice[]> {
  const voices: Voice[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await call('loading voices', (c) => c.voices.search({ pageSize: 100, nextPageToken }));
    voices.push(
      ...page.voices.map((v) => ({
        voice_id: v.voiceId,
        name: v.name ?? v.voiceId,
        category: v.category,
        labels: v.labels,
        preview_url: v.previewUrl,
      })),
    );
    nextPageToken = page.hasMore ? page.nextPageToken : undefined;
  } while (nextPageToken);
  return voices.sort((a, b) => a.name.localeCompare(b.name));
}

export interface Quota {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string | null;
}

/** Character quota for the current billing cycle; null if the key can't read it. */
export async function getQuota(): Promise<Quota | null> {
  try {
    const user = await call('reading your plan', (c) => c.user.get());
    const sub = user.subscription;
    if (!sub) return null;
    return {
      used: sub.characterCount,
      limit: sub.characterLimit,
      remaining: Math.max(0, sub.characterLimit - sub.characterCount),
      resetsAt: sub.nextCharacterCountResetUnix ? new Date(sub.nextCharacterCountResetUnix * 1000).toISOString() : null,
    };
  } catch (err) {
    console.warn('Could not read ElevenLabs quota:', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface DialogueInput {
  text: string;
  voiceId: string;
}

export type DialogueResult = ElevenLabs.AudioWithTimestampsAndVoiceSegmentsResponseModel;

/** Text to Dialogue with timestamps. Keep each request at or below ~2,000 characters in total. */
export function textToDialogue(inputs: DialogueInput[], context: { previousText?: string; futureText?: string } = {}): Promise<DialogueResult> {
  return call('generating dialogue', (c) =>
    c.textToDialogue.convertWithTimestamps({
      inputs,
      modelId: DIALOGUE_MODEL(),
      outputFormat: 'mp3_44100_128',
      // Request stitching: a little context either side keeps tone consistent across chunk boundaries.
      ...(context.previousText ? { previousText: context.previousText.slice(-100) } : {}),
      ...(context.futureText ? { futureText: context.futureText.slice(0, 100) } : {}),
    }),
  );
}
