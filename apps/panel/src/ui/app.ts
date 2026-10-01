/**
 * The panel's screens: connect, the tool list (with the account's balance),
 * and each tool. A server tool uploads the selected clip and runs as a job;
 * calculators and text tools run here; the browser media tools open on the
 * website.
 */
import { ApiError, type Client, type Me } from '@etb/api-client';
import type { Tool } from '@etb/core/api';

import type { Host } from '../host/types';
import { connect, ConnectError } from '../lib/connect';
import { costLabel, grouped, placeOf, PLACE_LABELS, PANEL_TOOLS } from '../lib/tools';
import { h } from './dom';
import { calculatorView, fileToolView } from './local';
import { serverToolView } from './server';

export interface AppDeps {
  host: Host;
  /** An API client, with the panel's key once it has one. */
  makeClient: (apiKey?: string) => Client;
  siteUrl: string;
  version: string;
}

const KEY = 'api-key';

export function startApp(root: HTMLElement, deps: AppDeps): void {
  const { host, siteUrl } = deps;
  let client = deps.makeClient();
  let me: Me | null = null;
  let tools: Tool[] = [];

  const show = (...nodes: Node[]) => {
    root.replaceChildren(...nodes);
    const heading = root.querySelector('h1');
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1;
      heading.focus();
    }
  };
  const open = (path: string) => {
    void host.openUrl(`${siteUrl}${path}`);
  };

  async function signedOut(message = '') {
    await host.writeSecret(KEY, null);
    client = deps.makeClient();
    me = null;
    connectView(message);
  }

  /** A call that answers 401 means the key was removed: back to connecting. */
  async function guarded<T>(call: () => Promise<T>): Promise<T | null> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await signedOut('This panel’s key was removed. Connect again to carry on.');
        return null;
      }
      throw error;
    }
  }

  function connectView(message = '') {
    const status = h('p', { role: 'status', className: message ? 'error' : 'muted' }, message);
    const start = h('button', { className: 'primary', type: 'button' }, 'Connect');
    const body = h('div', { className: 'card' });
    start.addEventListener('click', () => {
      const controller = new AbortController();
      start.disabled = true;
      status.className = 'muted';
      status.textContent = 'Asking for a code…';
      connect(client, {
        signal: controller.signal,
        onCode: (code) => {
          const openPage = h(
            'button',
            { type: 'button', className: 'primary' },
            'Open the connect page',
          );
          openPage.addEventListener('click', () => {
            void host.openUrl(code.url);
          });
          const cancel = h('button', { type: 'button' }, 'Cancel');
          cancel.addEventListener('click', () => {
            controller.abort();
            connectView();
          });
          body.replaceChildren(
            h('p', {}, 'Approve this code on the website, signed in to your account:'),
            h(
              'p',
              { className: 'code', 'aria-label': `Code ${code.userCode.split('').join(' ')}` },
              code.userCode,
            ),
            h('div', { className: 'row' }, openPage, cancel),
          );
          status.textContent = 'Waiting for you to approve it…';
          void host.openUrl(code.url);
        },
      })
        .then(async (apiKey) => {
          await host.writeSecret(KEY, apiKey);
          client = deps.makeClient(apiKey);
          await home();
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          connectView(
            error instanceof ConnectError
              ? error.message
              : 'The website couldn’t be reached. Check your connection and try again.',
          );
        });
    });
    body.replaceChildren(
      h(
        'p',
        {},
        'Connect your EditToolbelt account to run our server tools on your clips with your credits. Calculators and text tools work without it.',
      ),
      start,
    );
    show(
      h('h1', {}, 'EditToolbelt'),
      body,
      status,
      h('p', { className: 'hint' }, `Panel ${deps.version}`),
    );
  }

  function header(): HTMLElement {
    const buy = h('button', { type: 'button' }, 'Buy credits');
    buy.addEventListener('click', () => {
      open('/account');
    });
    const out = h('button', { type: 'button', className: 'link' }, 'Disconnect');
    out.addEventListener('click', () => {
      void signedOut();
    });
    return h(
      'div',
      { className: 'card' },
      h(
        'div',
        { className: 'row spread' },
        h('strong', {}, `${String(me?.credit_balance ?? 0)} credits`),
        buy,
      ),
      h(
        'p',
        { className: 'muted' },
        me
          ? `${me.email} · ${String(me.free_jobs_left)} free ${me.free_jobs_left === 1 ? 'job' : 'jobs'} left today`
          : '',
      ),
      out,
    );
  }

  function listView() {
    const sections = grouped(tools).map(({ place, tools: group }) =>
      h(
        'section',
        { 'aria-label': PLACE_LABELS[place] },
        h('h2', {}, PLACE_LABELS[place]),
        h(
          'ul',
          { className: 'tools' },
          group.map((tool) => {
            const button = h(
              'button',
              { type: 'button' },
              h('span', {}, tool.name),
              h(
                'span',
                { className: 'muted' },
                place === 'server'
                  ? costLabel(tool)
                  : place === 'panel'
                    ? 'Here'
                    : place === 'website'
                      ? 'Website'
                      : 'Soon',
              ),
            );
            button.addEventListener('click', () => {
              toolView(tool);
            });
            return h('li', {}, button);
          }),
        ),
      ),
    );
    show(h('h1', {}, 'EditToolbelt'), header(), ...sections);
  }

  function toolView(tool: Tool) {
    const back = h('button', { type: 'button', className: 'link' }, '← All tools');
    back.addEventListener('click', () => {
      void refreshMe().then(listView);
    });
    const place = placeOf(tool);
    let body: HTMLElement;
    if (place === 'server') {
      body = serverToolView(tool, {
        client,
        host,
        guarded,
        buyCredits: () => {
          open('/account');
        },
      });
    } else if (place === 'panel') {
      body =
        PANEL_TOOLS[tool.id] === 'calculator'
          ? calculatorView(tool.id)
          : fileToolView(tool.id, host);
    } else if (place === 'website') {
      const go = h('button', { type: 'button', className: 'primary' }, 'Open on the website');
      go.addEventListener('click', () => {
        open(`/${tool.id}`);
      });
      body = h(
        'div',
        { className: 'card' },
        h(
          'p',
          {},
          'This tool runs in your browser on the website, where it can read video and audio. Export the clip, then drop it there.',
        ),
        go,
      );
    } else {
      body = h('p', { className: 'muted' }, tool.maintenance ?? 'Coming soon.');
    }
    show(back, h('h1', {}, tool.name), h('p', { className: 'muted' }, PLACE_LABELS[place]), body);
  }

  async function refreshMe() {
    const answer = await guarded(() => client.me()).catch(() => null);
    if (answer) me = answer;
  }

  async function home() {
    root.replaceChildren(h('p', { className: 'muted', role: 'status' }, 'Loading…'));
    try {
      const [account, list] = await Promise.all([
        guarded(() => client.me()),
        guarded(() => client.tools('panel')),
      ]);
      if (!account || !list) return;
      me = account;
      tools = list.tools;
      listView();
    } catch {
      show(
        h('h1', {}, 'EditToolbelt'),
        h(
          'p',
          { className: 'error', role: 'status' },
          'The website couldn’t be reached. Check your connection.',
        ),
        (() => {
          const retry = h('button', { type: 'button' }, 'Try again');
          retry.addEventListener('click', () => {
            void home();
          });
          return retry;
        })(),
      );
    }
  }

  void (async () => {
    const key = await host.readSecret(KEY);
    if (!key) {
      connectView();
      return;
    }
    client = deps.makeClient(key);
    await home();
  })();
}
