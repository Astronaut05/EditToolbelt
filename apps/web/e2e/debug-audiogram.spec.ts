// Temporary (claude/debug-xbrowser only, never merged): what Audio to Video
// draws in each browser, read back at full size and as thumbnails.
import { readFileSync } from 'node:fs';

import { videoFrameSource } from '@etb/engines';
import { expect, test, type Page } from '@playwright/test';

import { choose } from './fixtures';

const RATE = 44_100;

function toneThenSilence(): Buffer {
  const frames = RATE * 3;
  const bytes = frames * 4;
  const out = Buffer.alloc(44 + bytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + bytes, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(bytes, 40);
  for (let i = 0; i < frames; i += 1) {
    const v =
      i < RATE * 1.5 ? Math.round(0.5 * 32_767 * Math.sin((2 * Math.PI * 1000 * i) / RATE)) : 0;
    out.writeInt16LE(v, 44 + i * 4);
    out.writeInt16LE(v, 46 + i * 4);
  }
  return out;
}

async function analyse(page: Page, file: Buffer, times: number[]) {
  const source = await videoFrameSource(
    new Blob([new Uint8Array(file)]),
    Math.min(...times),
    Math.max(...times),
  );
  if (!source) throw new Error('no video');
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
  console.log(
    'packets',
    source.packets.length,
    source.packets
      .slice(0, 100)
      .map((p) => `${p.timestamp.toFixed(3)}${p.key ? 'K' : ''}`)
      .join(' '),
  );
  return page.evaluate(
    async ({ config, packets, wanted }) => {
      const bytes = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const pink = (r: number, g: number, b: number) => r > 150 && g < 110 && b > 40 && b < 160;
      const look = (frame: VideoFrame) => {
        const W = frame.displayWidth;
        const H = frame.displayHeight;
        const full = new OffscreenCanvas(W, H);
        const f = full.getContext('2d', { willReadFrequently: true });
        if (!f) throw new Error('no canvas');
        f.drawImage(frame, 0, 0);
        const px = f.getImageData(0, 0, W, H).data;
        // Square layout: visual band x 81..999, y 335..724, 40 bars.
        const heights: number[] = [];
        for (let b = 0; b < 40; b += 1) {
          const cx = Math.round(81 + b * 22.95 + 11.475);
          let n = 0;
          for (let y = 300; y < 760; y += 1) {
            const i = (y * W + cx) * 4;
            if (pink(px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0)) n += 1;
          }
          heights.push(n);
        }
        let fullPink = 0;
        for (let y = 340; y < 720; y += 1) {
          for (let x = 0; x < W; x += 1) {
            const i = (y * W + x) * 4;
            if (pink(px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0)) fullPink += 1;
          }
        }
        const count = (data: Uint8ClampedArray) => {
          let n = 0;
          for (let y = 34; y < 72; y += 1) {
            for (let x = 0; x < 108; x += 1) {
              const i = (y * 108 + x) * 4;
              if (pink(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)) n += 1;
            }
          }
          return n;
        };
        const tallest = (data: Uint8ClampedArray) => {
          let most = 0;
          for (let x = 0; x < 108; x += 1) {
            let run = 0;
            for (let y = 34; y < 72; y += 1) {
              const i = (y * 108 + x) * 4;
              run = pink(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0) ? run + 1 : 0;
              most = Math.max(most, run);
            }
          }
          return most;
        };
        const thumb = new OffscreenCanvas(108, 108);
        const t = thumb.getContext('2d', { willReadFrequently: true });
        if (!t) throw new Error('no canvas');
        t.drawImage(frame, 0, 0, 108, 108);
        const direct = count(t.getImageData(0, 0, 108, 108).data);
        const directTallest = tallest(t.getImageData(0, 0, 108, 108).data);
        t.clearRect(0, 0, 108, 108);
        t.drawImage(full, 0, 0, 108, 108);
        const fromCanvas = count(t.getImageData(0, 0, 108, 108).data);
        t.imageSmoothingQuality = 'high';
        t.clearRect(0, 0, 108, 108);
        t.drawImage(frame, 0, 0, 108, 108);
        const high = count(t.getImageData(0, 0, 108, 108).data);
        // Box average, 10 × 10.
        const box = new Uint8ClampedArray(108 * 108 * 4);
        for (let y = 0; y < 108; y += 1) {
          for (let x = 0; x < 108; x += 1) {
            for (let c = 0; c < 4; c += 1) {
              let s = 0;
              for (let dy = 0; dy < 10; dy += 1) {
                for (let dx = 0; dx < 10; dx += 1) {
                  s += px[((y * 10 + dy) * W + x * 10 + dx) * 4 + c] ?? 0;
                }
              }
              box[(y * 108 + x) * 4 + c] = s / 100;
            }
          }
        }
        return {
          ts: frame.timestamp,
          W,
          H,
          heights: heights.join(','),
          fullPink,
          direct,
          directTallest,
          fromCanvas,
          high,
          box: count(box),
          boxTallest: tallest(box),
        };
      };
      const order = wanted
        .map((t, i) => ({ at: Math.round(t * 1e6), i }))
        .sort((a, b) => a.at - b.at);
      const out: unknown[] = [];
      const seen: number[] = [];
      let next = 0;
      let shown: VideoFrame | null = null;
      const decoder = new VideoDecoder({
        output: (frame) => {
          seen.push(frame.timestamp);
          for (
            ;
            next < order.length && shown && frame.timestamp > (order[next]?.at ?? 0);
            next += 1
          )
            out[order[next]?.i ?? 0] = look(shown);
          shown?.close();
          shown = frame;
        },
        error: (e) => {
          console.log('decoder error', e.message);
        },
      });
      decoder.configure({
        codec: config.codec,
        codedWidth: config.codedWidth,
        codedHeight: config.codedHeight,
      });
      for (const p of packets) {
        decoder.decode(
          new EncodedVideoChunk({
            type: p.key ? 'key' : 'delta',
            timestamp: Math.round(p.timestamp * 1e6),
            data: bytes(p.data),
          }),
        );
      }
      await decoder.flush();
      const last = shown as VideoFrame | null;
      if (last) {
        for (; next < order.length; next += 1) out[order[next]?.i ?? 0] = look(last);
        last.close();
      }
      return { out, seen: seen.slice(0, 100).join(' ') };
    },
    {
      config: {
        codec: source.config.codec,
        codedWidth: source.config.codedWidth,
        codedHeight: source.config.codedHeight,
      },
      packets: source.packets.map((p) => ({
        data: b64(p.data),
        timestamp: p.timestamp,
        key: p.key,
      })),
      wanted: times,
    },
  );
}

test('audiogram bars, measured', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('console', (m) => {
    console.log(`console.${m.type()}: ${m.text()}`);
  });
  await page.goto('/audio-to-video');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneThenSilence() });
  await expect(
    page.getByText('PCM 16-bit · 44.1 kHz · stereo · 0:03').filter({ visible: true }),
  ).toBeVisible();
  const settings = page.getByRole('region', { name: 'Settings' });
  await settings.getByRole('radio', { name: '1:1', exact: true }).click();
  await settings.locator('input[type=color][aria-label="Colour"]').fill('#ff2d55');
  await settings.locator('input[type=color][aria-label="Background"]').fill('#000000');
  await choose(page, false, 'Format', 'WebM');
  await page.getByRole('button', { name: 'Make video', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 100_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const bytes = readFileSync(await (await saved).path());
  const times = [0.6, 1.4, 1.6, 1.8, 2.0, 2.6];
  const result = await analyse(page, bytes, times);
  console.log('decoded timestamps', result.seen);
  result.out.forEach((r, i) => {
    console.log(`t=${String(times[i])}`, JSON.stringify(r));
  });
});
