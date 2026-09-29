import { createLogger } from '@etb/core/logger';

import { env } from './env';

/** Server-side logger. Never import this from a client component. */
export const log = createLogger({
  service: 'web',
  env: env.APP_ENV,
  version: env.APP_VERSION,
  level: env.LOG_LEVEL,
});
