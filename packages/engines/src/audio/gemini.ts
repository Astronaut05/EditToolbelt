/**
 * Gemini's generateContent, called from the browser with the person's own API
 * key (T09 Subtitle Generator; docs/decisions/2026-10-15-subtitles-with-gemini.md).
 * The key goes to Google in a header, never in a URL, and nowhere else. Busy
 * and rate-limited answers are tried again after a wait; a request field the
 * model or API version doesn't take is dropped for the next try; everything
 * else becomes one plain sentence for the page.
 */
import { GEMINI_API_ORIGIN } from '@etb/core/third-party';

import { EngineAbortError } from '../dummy';

export class GeminiError extends Error {
  override name = 'GeminiError';
}

export interface GeminiCall {
  system: string;
  prompt: string;
  audio: { mimeType: string; base64: string };
  schema: object;
  signal: AbortSignal;
  /** Called while waiting to try again: seconds left, and why. */
  onWait?: (seconds: number, why: string) => void;
}

export interface GeminiAnswer {
  text: string;
  /** Why the model stopped: "STOP", or "MAX_TOKENS" when the answer was cut off. */
  finish: string;
}

/** Tries after the first, for a busy server, a dropped connection or a short rate limit. */
const RETRIES = 4;

/** Wait before try n (from 0): 2, 4, 8, 16 s. */
const backoff = (attempt: number) => 2 ** (attempt + 1);

/** A 400 about a field the model doesn't take, rather than about the audio or the key. */
const FIELD_PROBLEM =
  /unknown name|invalid json payload|response_?json_?schema|response_?mime_?type|thinking|cannot find field/i;

/** Read afresh after an await (a narrowed `signal.aborted` would read as still false). */
const stopped = (signal: AbortSignal) => signal.aborted;

function sleep(seconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new EngineAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, seconds * 1000);
    const stop = () => {
      clearTimeout(timer);
      reject(new EngineAbortError());
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

interface Problem {
  message: string;
  status: string;
  /** From a RetryInfo detail ("17s"), seconds. */
  retryAfter: number | null;
}

async function problemOf(response: Response): Promise<Problem> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; status?: string; details?: { retryDelay?: string }[] };
    };
    const delay = body.error?.details?.find((d) => typeof d.retryDelay === 'string')?.retryDelay;
    const seconds = delay ? Number.parseFloat(delay) : NaN;
    return {
      message: (body.error?.message ?? '').trim(),
      status: body.error?.status ?? '',
      retryAfter: Number.isFinite(seconds) ? seconds : null,
    };
  } catch {
    return { message: '', status: '', retryAfter: null };
  }
}

/** A model name as typed: "models/gemini-3.5-flash" and " gemini-3.5-flash " both work. */
export function modelId(model: string | undefined): string {
  const id = (model ?? '').trim().replace(/^models\//, '');
  return id || 'gemini-3.5-flash';
}

export class GeminiClient {
  /** Which of `configs` to send; moves on (and stays) when a field is refused. */
  private level = 0;
  private readonly model: string;

  constructor(
    private readonly apiKey: string,
    model: string,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly wait: (seconds: number, signal: AbortSignal) => Promise<void> = sleep,
  ) {
    this.model = modelId(model);
  }

  /**
   * Generation settings from the fullest to the barest: JSON to the schema
   * with little thinking (Gemini 3 and later), then without thinking, then
   * JSON with the schema left to the prompt, then nothing.
   */
  private config(schema: object): Record<string, unknown> {
    const thinking = /^gemini-([3-9]|\d{2})/.test(this.model)
      ? { thinkingConfig: { thinkingLevel: 'low' } }
      : {};
    const all = [
      { responseMimeType: 'application/json', responseJsonSchema: schema, ...thinking },
      { responseMimeType: 'application/json', responseJsonSchema: schema },
      { responseMimeType: 'application/json' },
      {},
    ];
    return all[Math.min(this.level, all.length - 1)] ?? {};
  }

  async generate(call: GeminiCall): Promise<GeminiAnswer> {
    const url = `${GEMINI_API_ORIGIN}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    for (let attempt = 0; ;) {
      if (call.signal.aborted) throw new EngineAbortError();
      const body = {
        systemInstruction: { parts: [{ text: call.system }] },
        // The audio before the request, as Gemini's guide has it.
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: call.audio.mimeType, data: call.audio.base64 } },
              { text: call.prompt },
            ],
          },
        ],
        generationConfig: this.config(call.schema),
      };
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify(body),
          signal: call.signal,
        });
      } catch (error) {
        if (stopped(call.signal)) throw new EngineAbortError();
        // A busy Gemini can answer 503 without CORS headers, which the browser reports as a failed fetch.
        if (attempt < RETRIES) {
          const seconds = backoff(attempt);
          call.onWait?.(seconds, 'Gemini didn’t answer');
          await this.wait(seconds, call.signal);
          attempt += 1;
          continue;
        }
        throw new GeminiError(
          `Couldn’t reach Gemini (${error instanceof Error ? error.message : 'no answer'}). Check your connection; if it keeps failing, Gemini may be busy`,
        );
      }

      if (response.ok) return this.answer(response);

      const problem = await problemOf(response);
      const said = problem.message ? `: ${problem.message.replace(/\.$/, '')}` : '';
      if (/api[_ ]key[_ ]not[_ ]valid|API_KEY_INVALID/i.test(problem.message)) {
        throw new GeminiError(
          'Gemini says this API key isn’t valid. Copy it again from Google AI Studio (aistudio.google.com/apikey)',
        );
      }
      if (response.status === 400 && FIELD_PROBLEM.test(problem.message) && this.level < 3) {
        this.level += 1;
        continue;
      }
      if (/REFERRER|referer/i.test(problem.message)) {
        throw new GeminiError(
          'This API key is limited to other websites. In Google AI Studio, allow this site for the key, or use a key without website limits',
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new GeminiError(`Gemini refused this API key${said}`);
      }
      if (response.status === 404) {
        throw new GeminiError(
          `Gemini has no model called “${this.model}” for this key. Check the Model setting`,
        );
      }
      if (response.status === 429) {
        // A daily quota won't come back in seconds; a per-minute one will.
        if (/per ?day|daily/i.test(problem.message) || attempt >= RETRIES + 1) {
          throw new GeminiError(`Gemini’s usage limit for this key is used up${said}`);
        }
        const seconds = Math.min(60, problem.retryAfter ?? backoff(attempt) * 2);
        call.onWait?.(seconds, 'Gemini’s rate limit');
        await this.wait(seconds, call.signal);
        attempt += 1;
        continue;
      }
      if (response.status >= 500 && attempt < RETRIES) {
        const seconds = backoff(attempt);
        call.onWait?.(seconds, 'Gemini is busy');
        await this.wait(seconds, call.signal);
        attempt += 1;
        continue;
      }
      throw new GeminiError(`Gemini answered HTTP ${String(response.status)}${said}`);
    }
  }

  private async answer(response: Response): Promise<GeminiAnswer> {
    const data = (await response.json()) as {
      candidates?: {
        content?: { parts?: { text?: unknown; thought?: boolean }[] };
        finishReason?: string;
      }[];
      promptFeedback?: { blockReason?: string };
    };
    const candidate = data.candidates?.[0];
    if (!candidate) {
      const reason = data.promptFeedback?.blockReason;
      throw new GeminiError(
        reason ? `Gemini declined this audio (${reason})` : 'Gemini sent back no answer',
      );
    }
    const finish = candidate.finishReason ?? '';
    if (/SAFETY|RECITATION|PROHIBITED|BLOCKLIST|SPII/.test(finish)) {
      throw new GeminiError(`Gemini stopped before finishing (${finish})`);
    }
    const text = (candidate.content?.parts ?? [])
      .filter((part) => !part.thought && typeof part.text === 'string')
      .map((part) => String(part.text))
      .join('');
    return { text, finish };
  }
}

/** Bytes as base64, in slices so no call gets too many arguments. */
export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
