/**
 * A server tool in the panel: the clip (the one selected on the timeline, or
 * a file), the tool's settings from its option schema, the price, and the
 * job, with its result imported into the project.
 */
import { ApiError, type Client } from '@etb/api-client';
import type { Tool } from '@etb/core/api';

import type { Host, PickedFile } from '../host/types';
import { fieldsFor, optionsFrom, type Field } from '../lib/form';
import { JobFailed, prepare, run, type Prepared, type Stage } from '../lib/run';
import { field, h } from './dom';

export interface ServerDeps {
  client: Client;
  host: Host;
  guarded: <T>(call: () => Promise<T>) => Promise<T | null>;
  buyCredits: () => void;
}

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;

/** Extensions a tool takes, from its accepted types ("video/mp4" → mp4, ".srt" → srt). */
function extensionsOf(accepts: string[]): string[] {
  const out = new Set<string>();
  for (const type of accepts) {
    if (type.startsWith('.')) out.add(type.slice(1));
    else if (type.includes('/') && !type.endsWith('/*')) out.add(type.split('/')[1] ?? '');
  }
  return [...out].filter(Boolean);
}

function control(f: Field, onFile: (name: string, file: PickedFile | null) => void, host: Host) {
  switch (f.kind) {
    case 'choice': {
      const select = h(
        'select',
        {},
        f.choices.map((choice) => h('option', { value: choice }, choice)),
      );
      select.value = f.value;
      select.addEventListener('change', () => {
        f.value = select.value;
      });
      return field(f.label, select);
    }
    case 'number': {
      const input = h('input', {
        type: 'number',
        inputmode: 'decimal',
        min: f.min,
        max: f.max,
        value: f.value,
      });
      input.addEventListener('input', () => {
        f.value = input.value;
      });
      return field(f.label, input);
    }
    case 'toggle': {
      const box = h('input', { type: 'checkbox', checked: f.value });
      box.addEventListener('change', () => {
        f.value = box.checked;
      });
      return h('label', { className: 'row' }, box, f.label);
    }
    case 'colour':
    case 'text': {
      const input = h('input', { type: 'text', value: f.value, spellcheck: 'false' });
      input.addEventListener('input', () => {
        f.value = input.value;
      });
      return field(f.label, input);
    }
    case 'file': {
      const name = h('span', { className: 'muted' }, 'None chosen');
      const choose = h('button', { type: 'button' }, 'Choose…');
      choose.addEventListener('click', () => {
        void host.pickFile(['srt', 'vtt', 'ass']).then((file) => {
          onFile(f.name, file);
          name.textContent = file ? file.name : 'None chosen';
        });
      });
      return h(
        'div',
        { className: 'field' },
        h('span', { className: 'muted' }, f.label),
        h('div', { className: 'row' }, choose, name),
      );
    }
  }
}

export function serverToolView(tool: Tool, deps: ServerDeps): HTMLElement {
  const { client, host, guarded } = deps;
  const root = h('div', { className: 'card' });
  let source: PickedFile | null = null;
  let fields: Field[] = [];
  const extra: Record<string, PickedFile> = {};
  let controller: AbortController | null = null;

  const status = h('p', { role: 'status', className: 'muted' });
  const sourceLine = h('p', {}, 'No clip yet.');
  const settings = h('div', { className: 'card', 'aria-label': 'Settings', role: 'group' });
  const price = h(
    'button',
    { type: 'button', className: 'primary', disabled: true },
    'Get the price',
  );

  const setSource = (file: PickedFile | null, how: string) => {
    source = file;
    sourceLine.textContent = file
      ? `${how}: ${file.name} (${mb(file.size)})`
      : 'No clip selected on the timeline.';
    price.disabled = !file;
  };

  const useSelected = h('button', { type: 'button' }, 'Use the selected clip');
  useSelected.addEventListener('click', () => {
    void host.selectedMedia().then((file) => {
      setSource(file, 'Clip');
    });
  });
  const chooseFile = h('button', { type: 'button' }, 'Choose a file…');
  chooseFile.addEventListener('click', () => {
    void host.pickFile(extensionsOf(tool.accepts)).then((file) => {
      if (file) setSource(file, 'File');
    });
  });

  const fail = (error: unknown) => {
    if (controller?.signal.aborted) {
      status.className = 'muted';
      status.textContent = 'Cancelled.';
    } else {
      status.className = 'error';
      status.textContent =
        error instanceof JobFailed
          ? `${error.message}${error.creditsReturned ? ' Your credits were returned.' : ''}`
          : error instanceof ApiError
            ? (error.detail ?? error.title)
            : error instanceof Error
              ? error.message
              : 'Something went wrong.';
    }
    controller = null;
    form();
  };

  const progress = (stage: Stage) => {
    status.className = 'muted';
    switch (stage.stage) {
      case 'uploading':
        status.textContent = `Uploading ${stage.name}: ${String(Math.floor((stage.sent / Math.max(1, stage.total)) * 100))}%`;
        break;
      case 'checking':
        status.textContent = 'Checking the file…';
        break;
      case 'running':
        status.textContent =
          stage.job.status === 'queued'
            ? `Waiting for a free server${stage.job.position ? ` (number ${String(stage.job.position)} in line)` : ''}…`
            : `${stage.job.stage ?? 'Working'}: ${String(stage.job.progress)}%`;
        break;
      case 'importing':
        status.textContent = 'Bringing the result into the project…';
        break;
    }
  };

  const cancelButton = () => {
    const cancel = h('button', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', () => {
      controller?.abort();
    });
    return cancel;
  };

  function confirmView(prepared: Prepared) {
    const { quote } = prepared;
    const go = h(
      'button',
      { type: 'button', className: 'primary', disabled: !quote.can_start },
      quote.credits > 0
        ? `Run for ${String(quote.credits)} ${quote.credits === 1 ? 'credit' : 'credits'}`
        : 'Run',
    );
    const lines: (HTMLElement | null)[] = [
      h(
        'p',
        {},
        quote.funding === 'daily'
          ? `Free: one of today’s free jobs (${String(quote.free_jobs_left)} left).`
          : quote.funding === 'credits'
            ? `${String(quote.credits)} credits. Your balance after: ${String(quote.balance_after)}.`
            : 'Free.',
      ),
      quote.estimate_seconds
        ? h(
            'p',
            { className: 'muted' },
            `About ${String(Math.max(1, Math.round(quote.estimate_seconds / 60)))} min`,
          )
        : null,
    ];
    if (!quote.can_start) {
      const buy = h('button', { type: 'button' }, 'Buy credits');
      buy.addEventListener('click', deps.buyCredits);
      lines.push(
        h(
          'p',
          { className: 'error' },
          quote.blocked_by === 'QUOTA_EXCEEDED'
            ? 'Today’s free jobs are used up, and this needs credits.'
            : `This needs ${String(quote.credits)} credits; you have ${String(quote.balance)}.`,
        ),
        buy,
      );
    }
    const back = h('button', { type: 'button' }, 'Change settings');
    back.addEventListener('click', form);
    go.addEventListener('click', () => {
      const clip = source;
      if (!clip) return;
      controller = new AbortController();
      root.replaceChildren(sourceLine, status, cancelButton());
      void guarded(() =>
        run(client, host, tool.id, clip.name, prepared, {
          signal: controller?.signal,
          onStage: progress,
        }),
      )
        .then((done) => {
          controller = null;
          if (!done) return;
          status.className = '';
          status.textContent = done.message;
          const again = h('button', { type: 'button' }, 'Run again');
          again.addEventListener('click', form);
          root.replaceChildren(
            sourceLine,
            status,
            done.notes.length > 0
              ? h(
                  'ul',
                  { className: 'notes' },
                  done.notes.map((note) => h('li', {}, note)),
                )
              : '',
            again,
          );
        })
        .catch(fail);
    });
    root.replaceChildren(
      sourceLine,
      ...lines.filter((line) => line !== null),
      h('div', { className: 'row' }, go, back),
      status,
    );
  }

  price.addEventListener('click', () => {
    const clip = source;
    if (!clip) return;
    controller = new AbortController();
    root.replaceChildren(sourceLine, status, cancelButton());
    const missing = fields.find((f) => f.kind === 'file' && !Object.hasOwn(extra, f.name));
    if (missing) {
      fail(new Error(`Choose the ${missing.label.toLowerCase()} first.`));
      return;
    }
    void guarded(() =>
      prepare(client, tool.id, clip, extra, optionsFrom(fields), {
        signal: controller?.signal,
        onStage: progress,
      }),
    )
      .then((prepared) => {
        controller = null;
        status.textContent = '';
        if (prepared) confirmView(prepared);
      })
      .catch(fail);
  });

  function form() {
    root.replaceChildren(
      h('h2', {}, 'Clip'),
      sourceLine,
      h('div', { className: 'row' }, host.kind === 'premiere' ? useSelected : null, chooseFile),
      fields.length > 0 ? settings : '',
      price,
      status,
    );
  }

  settings.replaceChildren(h('p', { className: 'muted' }, 'Loading the settings…'));
  form();
  void guarded(() => client.tool(tool.id))
    .then((detail) => {
      if (!detail) return;
      fields = fieldsFor(detail.options, detail.extra_uploads);
      settings.replaceChildren(
        h('h2', {}, 'Settings'),
        ...fields.map((f) =>
          control(
            f,
            (name, file) => {
              if (file) extra[name] = file;
              else Reflect.deleteProperty(extra, name);
            },
            host,
          ),
        ),
      );
      form();
    })
    .catch(() => {
      settings.replaceChildren(h('p', { className: 'error' }, 'The settings couldn’t be loaded.'));
    });
  // In Premiere, the clip selected on the timeline is the one to use.
  if (host.kind === 'premiere') {
    void host.selectedMedia().then((file) => {
      if (file) setSource(file, 'Clip');
    });
  }
  return root;
}
