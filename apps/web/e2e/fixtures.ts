import { test as base, expect, type Page } from '@playwright/test';

/**
 * Every page records CSP violations from the first byte on. When a test
 * fails, the page's errors and any alert on screen go to the log, so a CI
 * failure in a browser we can't run locally still says what went wrong.
 */
export const test = base.extend({
  page: async ({ page }, provide, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        );
      });
    });
    await provide(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      const alerts = await page
        .getByRole('alert')
        .allInnerTexts()
        .catch(() => [] as string[]);
      const report = [...errors, ...alerts.map((text) => `alert: ${text}`)];
      if (report.length > 0) {
        console.log(`[${testInfo.project.name}] ${testInfo.title}\n  ${report.join('\n  ')}`);
      }
    }
  },
});

export { expect };

export async function cspViolations(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/** One page of each kind (docs/12 → axe on every page type). */
export const PAGES = [
  { name: 'home', path: '/' },
  { name: 'hub', path: '/photo' },
  { name: 'coming soon', path: '/upscale-image' },
  { name: 'calculator', path: '/aspect-ratio-calculator' },
  { name: 'color converter', path: '/color-converter' },
  { name: 'qr generator', path: '/qr-code-generator' },
  { name: 'file tool', path: '/subtitle-converter' },
  { name: 'image tool', path: '/image-converter' },
  { name: 'editor tool', path: '/crop-image' },
  { name: 'pair page', path: '/convert/srt-to-vtt' },
  { name: 'video tool', path: '/video-converter' },
  { name: 'legal', path: '/privacy' },
  { name: 'licenses', path: '/licenses' },
  { name: 'share', path: '/share' },
  { name: 'not found', path: '/no-such-page' },
] as const;

/** Picks a setting: a segmented control on desktop, a row that opens a sheet on phones. */
export async function choose(page: Page, isMobile: boolean, label: string, value: string) {
  if (isMobile) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const sheet = page.getByRole('dialog', { name: 'Settings' });
    await sheet.getByRole('radio', { name: value, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  } else {
    await page.getByRole('radio', { name: value, exact: true }).click();
  }
}

/** Picks from a dropdown setting: in place on desktop, in the settings sheet on phones. */
export async function pick(page: Page, isMobile: boolean, label: string, value: string) {
  if (isMobile) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const sheet = page.getByRole('dialog', { name: 'Settings' });
    await sheet.getByRole('combobox', { name: label }).selectOption(value);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  } else {
    await page.getByRole('combobox', { name: label }).selectOption(value);
  }
}

/** A time as the timeline's In and Out fields show it: "00:00:05.000". */
function shownTime(seconds: string): string {
  const total = Number(seconds);
  const m = Math.floor(total / 60);
  return `00:${String(m).padStart(2, '0')}:${(total % 60).toFixed(3).padStart(6, '0')}`;
}

/**
 * Types Out, then In, into the timeline and waits until both show them. Two
 * commits in a row can land before the page has re-rendered the first (seen
 * once in WebKit: In applied to the old Out), so the pair is typed again
 * until the selection holds both.
 */
export async function setRange(page: Page, start: string, end: string): Promise<void> {
  const inPoint = page.getByRole('textbox', { name: 'In point' });
  const outPoint = page.getByRole('textbox', { name: 'Out point' });
  await expect(async () => {
    await outPoint.fill(end);
    await outPoint.press('Enter');
    await inPoint.fill(start);
    await inPoint.press('Enter');
    await expect(inPoint).toHaveValue(shownTime(start), { timeout: 1000 });
    await expect(outPoint).toHaveValue(shownTime(end), { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * A video's frames at `times` (seconds), drawn at `width` × `height` (the
 * coded size when left out), as RGBA pixels: the frame showing at each time.
 * Decoded with WebCodecs in the page, not played in a <video> element: which
 * files that plays differs by browser, and Playwright's Linux WebKit
 * (GStreamer) crashed playing results back. The packets come from Node
 * (@etb/engines → videoFrameSource), so any container the tools write works.
 * Frames are drawn as they arrive and closed at once, so the decoder never
 * runs out of frames to hand out.
 */
export async function framePixels(
  page: Page,
  file: Buffer,
  times: number[],
  size?: { width: number; height: number },
): Promise<{ width: number; height: number; frames: number[][] }> {
  const { videoFrameSource } = await import('@etb/engines');
  const source = await videoFrameSource(
    new Blob([new Uint8Array(file)]),
    Math.min(...times),
    Math.max(...times),
  );
  if (!source) throw new Error('no video track to read');
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
  const width = size?.width ?? source.config.codedWidth;
  const height = size?.height ?? source.config.codedHeight;
  const frames = await page.evaluate(
    async ({ config, packets, wanted, w, h }) => {
      const bytes = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no canvas');
      const draw = (frame: VideoFrame) => {
        ctx.drawImage(frame, 0, 0, w, h);
        return Array.from(ctx.getImageData(0, 0, w, h).data);
      };
      // Each wanted time gets the last frame that starts at or before it.
      const order = wanted
        .map((t, i) => ({ at: Math.round(t * 1e6), i }))
        .sort((a, b) => a.at - b.at);
      const out: number[][] = [];
      let next = 0;
      let shown: VideoFrame | null = null;
      const state: { failure: string | null } = { failure: null };
      const decoder = new VideoDecoder({
        output: (frame) => {
          for (
            ;
            next < order.length && shown && frame.timestamp > (order[next]?.at ?? 0);
            next += 1
          )
            out[order[next]?.i ?? 0] = draw(shown);
          shown?.close();
          shown = frame;
        },
        error: (error) => {
          state.failure = error.message;
        },
      });
      decoder.configure({
        codec: config.codec,
        codedWidth: config.codedWidth,
        codedHeight: config.codedHeight,
        ...(config.description ? { description: bytes(config.description) } : {}),
      });
      for (const packet of packets) {
        decoder.decode(
          new EncodedVideoChunk({
            type: packet.key ? 'key' : 'delta',
            timestamp: Math.round(packet.timestamp * 1e6),
            data: bytes(packet.data),
          }),
        );
      }
      await decoder.flush();
      decoder.close();
      if (state.failure !== null) throw new Error(`decoding failed: ${state.failure}`);
      const last = shown as VideoFrame | null;
      if (!last) throw new Error('no frame decoded');
      for (; next < order.length; next += 1) out[order[next]?.i ?? 0] = draw(last);
      last.close();
      return out;
    },
    {
      config: {
        codec: source.config.codec,
        codedWidth: source.config.codedWidth,
        codedHeight: source.config.codedHeight,
        description: source.config.description ? b64(source.config.description) : null,
      },
      packets: source.packets.map((p) => ({
        data: b64(p.data),
        timestamp: p.timestamp,
        key: p.key,
      })),
      wanted: times,
      w: width,
      h: height,
    },
  );
  return { width, height, frames };
}

/** The mean colour of each of `count` vertical bands of the frame at `atSec` (see framePixels). */
export async function frameBands(
  page: Page,
  file: Buffer,
  atSec: number,
  count = 3,
): Promise<{ width: number; height: number; bands: number[][] }> {
  const { width, height, frames } = await framePixels(page, file, [atSec]);
  const px = frames[0] ?? [];
  const bands = Array.from({ length: count }, () => [0, 0, 0]);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const band = bands[Math.min(count - 1, Math.floor((x * count) / width))];
      if (!band) continue;
      for (let c = 0; c < 3; c += 1) band[c] = (band[c] ?? 0) + (px[(y * width + x) * 4 + c] ?? 0);
    }
  }
  const per = (width / count) * height;
  return { width, height, bands: bands.map((b) => b.map((v) => v / per)) };
}

/** The entries of a stored (uncompressed) ZIP, in order: enough for the ZIPs the tools make. */
export function unzipStored(zip: Buffer): { name: string; data: Buffer }[] {
  const entries: { name: string; data: Buffer }[] = [];
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const method = zip.readUInt16LE(at + 8);
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extraLength = zip.readUInt16LE(at + 28);
    expect(method).toBe(0);
    const start = at + 30 + nameLength + extraLength;
    entries.push({
      name: zip.toString('utf8', at + 30, at + 30 + nameLength),
      data: zip.subarray(start, start + size),
    });
    at = start + size;
  }
  return entries;
}
