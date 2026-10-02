// Temporary (claude/debug-xbrowser only, never merged): does AudioData.copyTo
// hang when asked for frames from partway into a block?
import { test } from '@playwright/test';

const CASES = [
  { name: 'f32 → f32-planar, all 960', src: 'f32', dest: 'f32-planar', offset: 0, count: 960 },
  { name: 'f32 → f32-planar, first 336', src: 'f32', dest: 'f32-planar', offset: 0, count: 336 },
  {
    name: 'f32 → f32-planar, 336 from 624',
    src: 'f32',
    dest: 'f32-planar',
    offset: 624,
    count: 336,
  },
  {
    name: 'f32-planar → f32-planar, 336 from 624',
    src: 'f32-planar',
    dest: 'f32-planar',
    offset: 624,
    count: 336,
  },
  { name: 'f32 → f32, 336 from 624', src: 'f32', dest: 'f32', offset: 624, count: 336 },
] as const;

for (const c of CASES) {
  test(`copyTo ${c.name}`, async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    const state = { crashed: false };
    page.on('crash', () => {
      state.crashed = true;
    });
    await page.goto('/');
    const run = page
      .evaluate((k) => {
        const frames = 960;
        const data = new Float32Array(frames * 2);
        for (let i = 0; i < data.length; i += 1) data[i] = (i % 100) / 100;
        const audio = new AudioData({
          format: k.src,
          sampleRate: 48_000,
          numberOfFrames: frames,
          numberOfChannels: 2,
          timestamp: 0,
          data,
        });
        const out = new Float32Array(k.dest === 'f32' ? k.count * 2 : k.count);
        const t0 = performance.now();
        audio.copyTo(out, {
          planeIndex: 0,
          frameOffset: k.offset,
          frameCount: k.count,
          format: k.dest,
        });
        audio.close();
        return `ok in ${(performance.now() - t0).toFixed(1)} ms, first values ${Array.from(out.slice(0, 4)).join(',')}`;
      }, c)
      .catch((e: unknown) => `threw: ${String(e)}`);
    const timeout = new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('NO ANSWER IN 10 s (page hung)');
      }, 10_000);
    });
    const result = await Promise.race([run, timeout]);
    console.log(`[copyTo] ${c.name}: ${result}${state.crashed ? ' (page crashed)' : ''}`);
    await Promise.race([
      context.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  });
}
