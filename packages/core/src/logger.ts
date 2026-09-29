/**
 * Structured JSON logging for Node processes (docs/07-admin-and-logging.md).
 *
 * One event per line, same field names as the worker's structlog setup:
 *   ts, level, service, env, version, event, plus request_id, job_id, tool_id,
 *   user_ref, duration_ms, error_code where they apply.
 *
 * Usage: `log.info({ tool_id, duration_ms }, 'job.succeeded')`. The message
 * argument is the event name. Every payload passes through `redact()`.
 */
import {
  pino,
  type Bindings,
  type ChildLoggerOptions,
  type DestinationStream,
  type Logger,
} from 'pino';

import type { AppEnv, LogLevel } from './env';
import { redact, redactString } from './redact';

export type Service = 'web' | 'worker' | 'sweeper';

/** Optional context fields shared with the worker. Use these names, don't invent synonyms. */
export interface LogContext {
  request_id?: string;
  job_id?: string;
  tool_id?: string;
  /** User id, never an email. */
  user_ref?: string;
  duration_ms?: number;
  error_code?: string;
}

export interface LoggerOptions {
  service: Service;
  env: AppEnv;
  version: string;
  level: LogLevel;
  /** Defaults to stdout. Tests pass a stream to capture lines. */
  destination?: DestinationStream;
}

export type { Logger };

export function createLogger({ service, env, version, level, destination }: LoggerOptions): Logger {
  const logger = pino(
    {
      level,
      messageKey: 'event',
      errorKey: 'err',
      base: { service, env, version },
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      // redact() already turns errors into { type, message, stack }; pino's
      // default err serializer would wrap that plain object a second time.
      serializers: { err: (value: unknown) => value },
      formatters: {
        level: (label) => ({ level: label }),
        log: (payload) => redact(payload) as Record<string, unknown>,
      },
      hooks: {
        // Last line of defence: pattern-scrub the finished JSON line, which also
        // covers event names and messages pino derives from errors.
        streamWrite: (line) => redactString(line),
      },
    },
    destination,
  );

  // pino skips formatters for child bindings, so redact them on the way in.
  // Children are created with Object.create(parent) and inherit this override.
  // Not bound: `this` must stay the instance being extended, or grandchildren
  // would lose their parent's bindings.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const pinoChild = logger.child;
  function redactingChild(this: Logger, bindings: Bindings, options?: ChildLoggerOptions): Logger {
    return Reflect.apply(pinoChild, this, [redact(bindings), options]) as Logger;
  }
  // pino's generic child() signature can't be expressed for a wrapper; the runtime shape matches.
  logger.child = redactingChild as unknown as Logger['child'];
  return logger;
}
