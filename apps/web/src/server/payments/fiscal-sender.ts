/**
 * The web server's receipt sender (payments/fiscal.ts): every 30 seconds,
 * and straight after each Click call, it sends the Click receipts that are
 * due. Started once per server process from instrumentation.ts (server build
 * only, never while building). It runs in the web process because the
 * worker has no outbound network but storage and the GPU backend
 * (docs/11 → ffmpeg and native tools), and Click's keys live here.
 *
 * One round at a time per process; rows are locked while sent, so more than
 * one web instance is safe too. While Click's keys or URL are unset a round
 * does nothing, not even a query.
 */
import { log } from '../../lib/log';
import { db } from '../db';
import { canSend, fiscalDeps, sendDueReceipts, type FiscalDeps } from './fiscal';

export const FISCAL_TICK_MS = 30_000;

interface Sender {
  timer: ReturnType<typeof setInterval>;
  busy: boolean;
  again: boolean;
  round: () => void;
}

const holder = globalThis as typeof globalThis & { etbFiscalSender?: Sender };

/** Starts the sender once per process; later calls do nothing. */
export function startFiscalSender(deps: () => FiscalDeps = fiscalDeps): void {
  if (holder.etbFiscalSender) return;
  const sender: Sender = {
    busy: false,
    again: false,
    round: () => {
      if (sender.busy) {
        // A wake during a round: one more round right after it.
        sender.again = true;
        return;
      }
      const current = deps();
      if (!canSend(current.env)) return;
      sender.busy = true;
      sendDueReceipts(db(), current)
        .then((summary) => {
          if (summary.sent + summary.failed > 0) log.info(summary, 'fiscal.round');
        })
        .catch((error: unknown) => {
          log.warn({ err: error }, 'fiscal.round_failed');
        })
        .finally(() => {
          sender.busy = false;
          if (sender.again) {
            sender.again = false;
            sender.round();
          }
        });
    },
    timer: setInterval(() => {
      sender.round();
    }, FISCAL_TICK_MS),
  };
  sender.timer.unref();
  holder.etbFiscalSender = sender;
  log.info({ tick_ms: FISCAL_TICK_MS }, 'fiscal.sender_started');
}

/** A Click call may have queued a receipt: send it now rather than at the next tick. */
export function wakeFiscalSender(): void {
  const sender = holder.etbFiscalSender;
  if (sender) setImmediate(sender.round);
}
