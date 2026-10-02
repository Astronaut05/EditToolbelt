import type { Page, TestInfo } from '@playwright/test';

/**
 * DEBUG (claude/debug-webkit-flakes only, never merged). A 250 ms page
 * heartbeat, every media element event, the shell's stage and commit logs
 * (ToolShell's `[dbg]` lines), and for the QR page the Content select's state
 * and whether React has hydrated it. Every line carries Node's clock (ms since
 * the probe started) and the page's own performance.now(). Heartbeats are
 * logged when what they see changes, and any gap over 600 ms between two of
 * them is logged as a GAP, so a frozen page shows as silence.
 */
export async function probe(page: Page, testInfo: TestInfo, kind: 'video' | 'qr') {
  const t0 = Date.now();
  const lines: string[] = [];
  const log = (text: string) => {
    lines.push(`${String(Date.now() - t0).padStart(6)} ${text}`);
  };
  let lastBeat = 0;
  let lastState = '';
  let beats = 0;
  let maxGap = 0;
  page.on('console', (message) => {
    const text = message.text();
    if (!text.startsWith('[dbg]')) return;
    const body = text.slice(6);
    if (body.includes(' hb ')) {
      beats += 1;
      const now = Date.now() - t0;
      if (lastBeat && now - lastBeat > 600) log(`GAP ${String(now - lastBeat)} ms before: ${body}`);
      maxGap = Math.max(maxGap, lastBeat ? now - lastBeat : 0);
      lastBeat = now;
      const state = body.replace(/^\d+ hb /, '');
      if (state !== lastState) log(body);
      lastState = state;
      return;
    }
    log(body);
  });
  page.on('pageerror', (error) => {
    log(`pageerror ${error.message}`);
  });
  page.on('crash', () => {
    log('PAGE CRASH');
  });
  page.on('load', () => {
    log('load (Playwright)');
  });
  page.on('domcontentloaded', () => {
    log('domcontentloaded (Playwright)');
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) log(`navigated ${frame.url()}`);
  });
  await page.addInitScript((which: string) => {
    const say = (text: string) => {
      console.log(`[dbg] ${String(Math.round(performance.now()))} ${text}`);
    };
    say(`init ${location.pathname} ${document.readyState}`);
    document.addEventListener('readystatechange', () => {
      say(`readyState ${document.readyState}`);
    });
    const events = [
      'loadstart',
      'durationchange',
      'loadedmetadata',
      'loadeddata',
      'canplay',
      'canplaythrough',
      'progress',
      'suspend',
      'stalled',
      'waiting',
      'abort',
      'emptied',
      'error',
      'playing',
      'pause',
    ];
    for (const name of events) {
      document.addEventListener(
        name,
        (event) => {
          const media = event.target;
          if (!(media instanceof HTMLMediaElement)) return;
          say(
            `media ${name} ${media.getAttribute('aria-label') ?? media.tagName} preload=${media.preload} rs=${String(media.readyState)} ns=${String(media.networkState)}${media.error ? ` err=${String(media.error.code)} ${media.error.message}` : ''}`,
          );
        },
        true,
      );
    }
    if (which === 'qr') {
      for (const name of ['input', 'change']) {
        document.addEventListener(
          name,
          (event) => {
            const el = event.target as HTMLElement & { value?: string };
            const hydrated = Object.keys(el).some((k) => k.startsWith('__reactFiber$'));
            say(`event ${name} #${el.id} value=${String(el.value)} hydrated=${String(hydrated)}`);
          },
          true,
        );
      }
    }
    const fiberValue = (el: Element) => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
      if (!key) return 'none';
      const props = (el as unknown as Record<string, { value?: unknown }>)[key];
      return String(props?.value);
    };
    setInterval(() => {
      if (which === 'video') {
        const download = [...document.querySelectorAll('button')].find((b) =>
          (b.textContent ?? '').trim().startsWith('Download'),
        );
        const video = document.querySelector<HTMLVideoElement>('video[aria-label="Result"]');
        say(
          `hb download=${download ? (download.disabled ? 'off' : 'on') : 'none'} result=${video ? `rs${String(video.readyState)} ns${String(video.networkState)} ${String(video.videoWidth)}x${String(video.videoHeight)}` : 'none'}`,
        );
      } else {
        const select = document.getElementById('qr-type') as HTMLSelectElement | null;
        const hydrated = select
          ? Object.keys(select).some((k) => k.startsWith('__reactFiber$'))
          : false;
        say(
          `hb ${document.readyState} select=${select ? select.value : 'none'} react=${select ? fiberValue(select) : '-'} hydrated=${String(hydrated)} ssid=${String(Boolean(document.getElementById('qr-ssid')))} url=${String(Boolean(document.getElementById('qr-url')))}`,
        );
      }
    }, 250);
  }, kind);
  return {
    mark: log,
    dump() {
      const failed = testInfo.status !== testInfo.expectedStatus;
      const head = `[probe ${testInfo.project.name} #${String(testInfo.repeatEachIndex)}] ${testInfo.title} → ${String(testInfo.status)} · ${String(beats)} beats, max gap ${String(maxGap)} ms, last beat at ${String(lastBeat)} ms`;
      console.log(`${head}${failed ? ' FAILED' : ''}\n  ${lines.join('\n  ')}`);
    },
  };
}
