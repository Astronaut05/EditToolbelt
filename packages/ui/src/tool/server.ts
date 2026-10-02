/**
 * A hybrid tool's server path, as the ToolShell sees it (docs/02 → Routing):
 * the shell decides when to offer it and asks first; the app supplies the
 * account and the run (upload, quote, job, progress, download). Nothing is
 * uploaded until the person presses the button that says so.
 */
import type { CreditRule } from '@etb/registry/schema';

import { formatBytes } from './format';

/** What a page knows about a tool's server path (serialisable, from the registry). */
export interface ServerInfo {
  rule: CreditRule;
  /** The rule in words: "1 credit a minute, at least 2". */
  price: string;
  maxBytes: { free: number; paid: number };
}

export interface ServerAccount {
  tier: 'free' | 'paid';
  balance: number;
  /** Free server jobs left today (never-paid accounts). */
  freeJobsLeft: number;
}

/** The server's price once it has checked the file. */
export interface ServerQuote {
  credits: number;
  funding: 'none' | 'daily' | 'credits';
  balance: number;
}

export interface ServerStage {
  stage: string;
  fraction?: number;
  /** "340 MB of 1.2 GB" */
  amount?: string;
  /** "2 ahead" */
  step?: string;
}

export interface ServerResult {
  blob: Blob;
  ext: string;
  notes?: string[];
  width?: number;
  height?: number;
}

export interface ServerRunContext {
  signal: AbortSignal;
  /** A04, V12: every file to join, in order (the first is the run's `file`). */
  files?: readonly File[];
  /** What the offer said: about this many credits (null: not known yet), or free. */
  offered: { credits: number | null; free: boolean };
  progress: (stage: ServerStage) => void;
  /** The price differs from what the offer said: true to go on. */
  confirm: (quote: ServerQuote) => Promise<boolean>;
}

/** A failure to show as it is: the server's words, and whether credits came back. */
export class ServerRunError extends Error {
  constructor(
    message: string,
    readonly title = 'Our servers couldn’t do this',
    readonly creditsReturned = false,
  ) {
    super(message);
  }
}

export interface ShellServer {
  /** The price rule in words: "1 credit a minute, at least 2". */
  price: string;
  /** Credits for a file this long, before the server has checked it; null if it depends on more. */
  estimate: (durationSec: number | undefined) => number | null;
  maxBytes: { free: number; paid: number };
  /** Where "Sign in" goes; it comes back to this page. */
  signInHref: string;
  /** The signed-in account, or null when signed out. */
  account: () => Promise<ServerAccount | null>;
  run: (
    file: File,
    options: Record<string, string>,
    ctx: ServerRunContext,
  ) => Promise<ServerResult>;
}

/** Whether the account can start a job this size, and the line that says what it costs. */
export function serverTerms(
  server: ShellServer,
  account: ServerAccount,
  bytes: number,
  credits: number | null,
): { ok: boolean; line: string } {
  const limit = server.maxBytes[account.tier];
  if (bytes > limit) {
    return {
      ok: false,
      line:
        account.tier === 'free' && bytes <= server.maxBytes.paid
          ? `Our servers take up to ${formatBytes(limit)} on a free account, and ${formatBytes(server.maxBytes.paid)} once you’ve bought credits.`
          : `Our servers take up to ${formatBytes(limit)} for this tool.`,
    };
  }
  if (credits === 0) return { ok: true, line: 'Free.' };
  if (account.freeJobsLeft > 0) {
    return {
      ok: true,
      line: `Free: uses 1 of your free server jobs today (${String(account.freeJobsLeft)} left).`,
    };
  }
  if (credits === null) {
    return {
      ok: account.balance > 0,
      line: `${server.price}; you have ${plural(account.balance, 'credit')}. The price is confirmed before it starts.`,
    };
  }
  if (account.balance >= credits) {
    return {
      ok: true,
      line: `About ${plural(credits, 'credit')}; you have ${String(account.balance)}.`,
    };
  }
  return {
    ok: false,
    line:
      account.tier === 'free'
        ? `No free server jobs left today, and this needs about ${plural(credits, 'credit')} (you have ${String(account.balance)}). Free jobs come back tomorrow (UTC).`
        : `This needs about ${plural(credits, 'credit')}; you have ${String(account.balance)}.`,
  };
}

export function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}
