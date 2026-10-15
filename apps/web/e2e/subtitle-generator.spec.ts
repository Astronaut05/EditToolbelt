import { readFileSync } from 'node:fs';

import type { Page, Request } from '@playwright/test';

import { cspViolations, expect, test } from './fixtures';

// T09 Subtitle Generator (tools/subtitles-and-time.md → Tests): Gemini is answered from
// here with words a little off the voice; the SRT must keep the style, sit on the speech
// and close the short pause but not the long one.

const RATE = 48_000;
const LENGTH = 7;
/** Where the voice is, seconds: a tone at −9 dBFS; faint noise elsewhere. */
const SPEECH = [
  [0.5, 2],
  [2.3, 3.6],
  [5.6, 6.3],
];

function speechWav(): Buffer {
  const frames = RATE * LENGTH;
  const out = Buffer.alloc(44 + frames * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + frames * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(frames * 2, 40);
  let seed = 7;
  const noise = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return (seed / 2_147_483_647) * 2 - 1;
  };
  for (let i = 0; i < frames; i += 1) {
    const t = i / RATE;
    const voiced = SPEECH.some(([a = 0, b = 0]) => t >= a && t < b);
    const v = voiced ? 0.5 * Math.sin(2 * Math.PI * 180 * t) : noise() * 0.002;
    out.writeInt16LE(Math.round(v * 32_767), 44 + i * 2);
  }
  return out;
}

/** What "Gemini" hears: words grouped by meaning, each a little off the tone's edges. */
const REPLY = {
  cues: [
    {
      words: [
        { w: 'Assalomu', s: 0.55, e: 1.05 },
        { w: 'alaykum,', s: 1.05, e: 1.95 },
      ],
    },
    {
      words: [
        { w: 'aziz', s: 2.35, e: 2.7 },
        { w: 'do‘stlar.', s: 2.7, e: 3.55 },
      ],
    },
    {
      words: [
        { w: 'Bugun', s: 5.62, e: 5.9 },
        { w: 'boshlaymiz!', s: 5.9, e: 6.25 },
      ],
    },
  ],
};

/** Answers Gemini's API from here and keeps the requests. */
async function fakeGemini(page: Page): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    // The key header makes the call need a preflight, which Google allows.
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'content-type, x-goog-api-key',
        },
      });
      return;
    }
    seen.push(route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // The browser calls it cross-origin, as it does Google.
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(REPLY) }] }, finishReason: 'STOP' },
        ],
      }),
    });
  });
  return seen;
}

/** SRT cues as [start ms, end ms, text]. */
function cues(srt: string): [number, number, string][] {
  return srt
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const [, time = '', ...text] = block.split('\n');
      const ms = (t: string) => {
        const [h = 0, m = 0, s = 0, f = 0] = t.split(/[:,]/).map(Number);
        return ((h * 60 + m) * 60 + s) * 1000 + f;
      };
      const [start = '', end = ''] = time.split(' --> ');
      return [ms(start), ms(end), text.join('\n')];
    });
}

test('turns speech into one-line cues on the voice, closing the short pause only', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'the settings and the run are the same on phones; one layout is enough');
  const requests = await fakeGemini(page);
  await page.goto('/subtitle-generator');
  // The privacy line says where the audio goes.
  await expect(page.getByText(/goes from your browser to Google Gemini/).first()).toBeVisible();

  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'intro.wav', mimeType: 'audio/wav', buffer: speechWav() });
  await expect(page.getByText(/0:07/).filter({ visible: true }).first()).toBeVisible();

  // No key, no run.
  const run = page.getByRole('button', { name: 'Generate subtitles' }).first();
  await expect(page.getByText(/Paste your Gemini API key first/).first()).toBeVisible();
  // With a file in, the settings show beside it: the field that's on screen.
  const key = page.getByLabel('Gemini API key', { exact: true }).filter({ visible: true });
  await key.fill('test-key-123');
  await expect(key).toHaveAttribute('type', 'password');
  await run.click();

  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 60_000 });
  const download = page.waitForEvent('download');
  await button.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('intro_subtitles.srt');
  const out = cues(readFileSync(await file.path(), 'utf8'));

  // One request, the key in its header and nowhere in the URL, the audio as FLAC.
  expect(requests).toHaveLength(1);
  const [request] = requests;
  expect(request?.url()).toContain('/v1beta/models/gemini-3.5-flash:generateContent');
  expect(request?.url()).not.toContain('test-key-123');
  expect(request?.headers()['x-goog-api-key']).toBe('test-key-123');
  const body = request?.postDataJSON() as {
    contents: { parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] }[];
  };
  const audio = body.contents[0]?.parts[0]?.inlineData;
  expect(audio?.mimeType).toBe('audio/flac');
  expect(
    Buffer.from(audio?.data ?? '', 'base64')
      .subarray(0, 4)
      .toString(),
  ).toBe('fLaC');
  expect(body.contents[0]?.parts[1]?.text).toContain('2 to 4 words');

  // Instagram: no period or comma at a cue's end; Uzbek's apostrophe typed plainly.
  expect(out.map((cue) => cue[2])).toEqual([
    'Assalomu alaykum',
    "aziz do'stlar",
    'Bugun boshlaymiz!',
  ]);
  const near = (actual: number | undefined, expected: number) => {
    expect(Math.abs((actual ?? NaN) - expected)).toBeLessThanOrEqual(30);
  };
  // Each cue starts just before the voice; the 0.3 s pause is closed (the first cue
  // stays until the second), the 2 s pause isn't (0.3 s after the voice stops).
  near(out[0]?.[0], 460);
  expect(out[0]?.[1]).toBe(out[1]?.[0]);
  near(out[1]?.[0], 2260);
  near(out[1]?.[1], 3900);
  near(out[2]?.[0], 5560);
  near(out[2]?.[1], 6600);

  expect(await cspViolations(page)).toEqual([]);
});

test('remembers the key on this device only when asked', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the same field on phones');
  await page.goto('/subtitle-generator');
  const key = page.getByLabel('Gemini API key', { exact: true });
  await key.fill('kept-key');
  await page.reload();
  await expect(page.getByLabel('Gemini API key', { exact: true })).toHaveValue('');

  await page.getByLabel('Gemini API key', { exact: true }).fill('kept-key');
  await page.getByLabel('Remember on this device').check();
  await page.reload();
  await expect(page.getByLabel('Gemini API key', { exact: true })).toHaveValue('kept-key');
  await expect(page.getByLabel('Remember on this device')).toBeChecked();

  await page.getByLabel('Remember on this device').uncheck();
  await page.reload();
  await expect(page.getByLabel('Gemini API key', { exact: true })).toHaveValue('');
});
