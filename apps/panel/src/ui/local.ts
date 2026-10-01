/**
 * The tools the panel runs itself, with the website's own code: the
 * calculators from @etb/core, and the subtitle and LUT tools' engines from
 * @etb/engines. Subtitles go into the project; a LUT is saved as a file.
 */
import { heightFor, parseRatio, simplify } from '@etb/core/calc/aspect';
import { fileSize, MB, videoBitrateFor } from '@etb/core/calc/bitrate';
import {
  convertFrames,
  formatTimecode,
  FRAME_RATES,
  framesToSeconds,
  getFrameRate,
  parseTimecode,
} from '@etb/core/calc/timecode';
import { formats, parseColor } from '@etb/core/color/color';
import { lutConvertEngine, subtitleEngine, subtitleShiftEngine } from '@etb/engines';

import type { Host, PickedFile } from '../host/types';
import { resultName } from '../lib/tools';
import { field, h } from './dom';

const num = (input: HTMLInputElement) => Number(input.value);

function numberInput(value: string, step = 'any') {
  return h('input', { type: 'number', inputmode: 'decimal', step, value });
}

function rateSelect(id = '25') {
  const select = h(
    'select',
    {},
    FRAME_RATES.map((rate) => h('option', { value: rate.id }, `${rate.label} fps`)),
  );
  select.value = id;
  return select;
}

/** A form whose results update as it's typed in. */
function live(
  form: HTMLElement,
  inputs: HTMLElement[],
  outputs: HTMLElement,
  update: () => void,
): HTMLElement {
  for (const input of inputs) {
    input.addEventListener('input', update);
    input.addEventListener('change', update);
  }
  update();
  return h('div', { className: 'card' }, form, outputs);
}

export function calculatorView(id: string): HTMLElement {
  const out = h('div', { role: 'status', className: 'field' });
  const line = (label: string, value: string) =>
    h('p', {}, h('span', { className: 'muted' }, `${label}: `), h('output', {}, value));

  if (id === 'timecode-calculator') {
    const rate = rateSelect('25');
    const to = rateSelect('29.97');
    const tc = h('input', { type: 'text', value: '00:00:10:00', spellcheck: 'false' });
    const box = h(
      'div',
      {},
      field('Frame rate', rate),
      field('Timecode', tc),
      field('Convert to', to),
    );
    return live(box, [rate, tc, to], out, () => {
      const fr = getFrameRate(rate.value);
      const parsed = parseTimecode(tc.value, fr);
      if (!parsed.ok) {
        out.replaceChildren(h('p', { className: 'error' }, parsed.error));
        return;
      }
      const target = getFrameRate(to.value);
      out.replaceChildren(
        line('Frames', String(parsed.frames)),
        line('Seconds', framesToSeconds(parsed.frames, fr).toFixed(3)),
        line(
          `At ${target.label} fps`,
          formatTimecode(convertFrames(parsed.frames, fr, target), target),
        ),
      );
    });
  }

  if (id === 'aspect-ratio-calculator') {
    const width = numberInput('1920', '1');
    const height = numberInput('1080', '1');
    const ratio = h('input', { type: 'text', value: '2.39:1', spellcheck: 'false' });
    const box = h(
      'div',
      {},
      field('Width (px)', width),
      field('Height (px)', height),
      field('Crop to ratio', ratio),
    );
    return live(box, [width, height, ratio], out, () => {
      const w = num(width);
      const hh = num(height);
      const r = parseRatio(ratio.value);
      if (!(w > 0 && hh > 0)) {
        out.replaceChildren(h('p', { className: 'error' }, 'Type a width and a height in pixels.'));
        return;
      }
      const s = simplify(w, hh);
      out.replaceChildren(
        line(
          'Ratio',
          `${s.label} (${s.decimal.toFixed(3)})${s.nearest ? `, about ${s.nearest}` : ''}`,
        ),
        r === null
          ? h('p', { className: 'error' }, 'Type a ratio like 16:9 or 2.39:1.')
          : line(
              `Height at ${ratio.value.trim()} for ${String(w)} px wide`,
              `${String(heightFor(w, r, true))} px`,
            ),
      );
    });
  }

  if (id === 'bitrate-calculator') {
    const minutes = numberInput('10');
    const video = numberInput('20000', '1');
    const audio = numberInput('320', '1');
    const target = numberInput('500');
    const box = h(
      'div',
      {},
      field('Length (minutes)', minutes),
      field('Video (kbps)', video),
      field('Audio (kbps)', audio),
      field('Or hit a size (MB)', target),
    );
    return live(box, [minutes, video, audio, target], out, () => {
      const seconds = num(minutes) * 60;
      if (!(seconds > 0)) {
        out.replaceChildren(h('p', { className: 'error' }, 'Type a length in minutes.'));
        return;
      }
      const size = fileSize(seconds, num(video), num(audio)) / MB;
      const kbps = videoBitrateFor(num(target) * MB, seconds, num(audio));
      out.replaceChildren(
        line('File size', `${size.toFixed(1)} MB`),
        line(
          `Video bitrate for ${target.value} MB`,
          kbps > 0 ? `${String(Math.floor(kbps))} kbps` : 'too small for the audio',
        ),
      );
    });
  }

  // Colour converter.
  const colour = h('input', { type: 'text', value: '#b9e04c', spellcheck: 'false' });
  const box = h('div', {}, field('Colour', colour, 'HEX, rgb(), hsl() or a CSS name'));
  return live(box, [colour], out, () => {
    const parsed = parseColor(colour.value);
    if (!parsed.ok) {
      out.replaceChildren(h('p', { className: 'error' }, parsed.error));
      return;
    }
    const all = formats(parsed.rgb);
    out.replaceChildren(
      line('HEX', all.hex),
      line('RGB', all.rgb),
      line('HSL', all.hsl),
      line('CMYK', all.cmyk),
      line('Lab', all.lab),
    );
  });
}

interface FileTool {
  extensions: string[];
  controls: () => { nodes: HTMLElement[]; options: () => Record<string, string> };
  run: (
    file: File,
    options: Record<string, string>,
  ) => Promise<{ blob: Blob; ext: string; notes?: string[] }>;
  /** Subtitles go into the project; a LUT can't, so it's saved. */
  into: 'project' | 'file';
}

const ctx = () => ({ progress: () => undefined, signal: new AbortController().signal });

const FILE_TOOLS: Record<string, FileTool> = {
  'subtitle-converter': {
    extensions: ['srt', 'vtt', 'ass', 'ssa', 'sbv'],
    controls: () => {
      const to = h(
        'select',
        {},
        ['srt', 'vtt', 'ass', 'sbv', 'txt'].map((f) => h('option', { value: f }, f.toUpperCase())),
      );
      return { nodes: [field('Convert to', to)], options: () => ({ to: to.value }) };
    },
    run: (file, options) => subtitleEngine.run(file, options, ctx()),
    into: 'project',
  },
  'subtitle-shift': {
    extensions: ['srt', 'vtt', 'ass', 'ssa', 'sbv'],
    controls: () => {
      const shift = numberInput('0.5');
      return {
        nodes: [field('Shift (seconds)', shift, 'Negative is earlier.')],
        options: () => ({ mode: 'shift', shift: shift.value, from: '1' }),
      };
    },
    run: (file, options) => subtitleShiftEngine.run(file, options, ctx()),
    into: 'project',
  },
  'lut-converter': {
    extensions: ['cube', '3dl'],
    controls: () => {
      const to = h(
        'select',
        {},
        h('option', { value: '3dl' }, '.3dl'),
        h('option', { value: 'cube' }, '.cube'),
      );
      return {
        nodes: [field('Convert to', to)],
        options: () => ({ to: to.value, grid: 'keep', shape: 'keep' }),
      };
    },
    run: (file, options) => lutConvertEngine.run(file, options, ctx()),
    into: 'file',
  },
};

export function fileToolView(id: string, host: Host): HTMLElement {
  const tool = FILE_TOOLS[id];
  if (!tool) return h('p', { className: 'error' }, 'This tool isn’t in the panel yet.');
  let picked: PickedFile | null = null;
  const { nodes, options } = tool.controls();
  const name = h('p', { className: 'muted' }, 'No file chosen.');
  const status = h('p', { role: 'status', className: 'muted' });
  const go = h('button', { type: 'button', className: 'primary', disabled: true }, 'Convert');
  const choose = h('button', { type: 'button' }, 'Choose a file…');
  choose.addEventListener('click', () => {
    void host.pickFile(tool.extensions).then((file) => {
      if (!file) return;
      picked = file;
      name.textContent = file.name;
      go.disabled = false;
    });
  });
  go.addEventListener('click', () => {
    const source = picked;
    if (!source) return;
    go.disabled = true;
    status.className = 'muted';
    status.textContent = 'Working…';
    void (async () => {
      const file = new File([await source.slice(0, source.size)], source.name);
      const out = await tool.run(file, options());
      const resultFile = resultName(source.name, id, out.ext);
      const message =
        tool.into === 'project'
          ? await host.importResult(out.blob, resultFile)
          : await host.saveFile(out.blob, resultFile);
      status.className = '';
      status.textContent = message ?? 'Not saved.';
      if (out.notes?.length)
        status.append(
          h(
            'ul',
            { className: 'notes' },
            out.notes.map((note) => h('li', {}, note)),
          ),
        );
    })()
      .catch((error: unknown) => {
        status.className = 'error';
        status.textContent =
          error instanceof Error ? error.message : 'This file couldn’t be converted.';
      })
      .finally(() => {
        go.disabled = false;
      });
  });
  return h(
    'div',
    { className: 'card' },
    h('div', { className: 'row' }, choose),
    name,
    ...nodes,
    go,
    status,
  );
}
