/**
 * The web server build's env (ETB_TARGET=server), validated on first use:
 * a missing or malformed variable stops the process with a readable list.
 * Server code only; the static build never imports it.
 */
import { loadEnv, webServerEnvSchema, type WebServerEnv } from '@etb/core/env';

let cached: WebServerEnv | undefined;

export function serverEnv(): WebServerEnv {
  cached ??= loadEnv('web (server)', webServerEnvSchema);
  return cached;
}
