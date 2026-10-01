/**
 * Connecting the panel to an account (docs/06 → Auth, device flow): the panel
 * asks for a code, the user approves it on the website, and the panel polls
 * until it gets its API key. The key is made at that moment and kept only in
 * the host's secure storage.
 */
import { ApiError, wait, type Client } from '@etb/api-client';

export class ConnectError extends Error {
  constructor(readonly reason: 'denied' | 'expired') {
    super(
      reason === 'denied'
        ? 'The connection was declined on the website.'
        : 'The code expired before it was approved. Start again for a new one.',
    );
    this.name = 'ConnectError';
  }
}

export interface DeviceCodeShown {
  userCode: string;
  /** The connect page with the code filled in. */
  url: string;
  expiresAt: number;
}

/** Runs the device flow to the end: answers the API key, or throws ConnectError. */
export async function connect(
  client: Pick<Client, 'startDevice' | 'collectDeviceKey'>,
  options: {
    onCode: (code: DeviceCodeShown) => void;
    signal?: AbortSignal;
    clientName?: string;
    now?: () => number;
  },
): Promise<string> {
  const now = options.now ?? Date.now;
  const code = await client.startDevice(options.clientName ?? 'Premiere panel');
  const expiresAt = now() + code.expires_in * 1000;
  options.onCode({ userCode: code.user_code, url: code.verification_uri_complete, expiresAt });
  let interval = Math.max(1, code.interval) * 1000;
  for (;;) {
    await wait(interval, options.signal);
    if (now() > expiresAt) throw new ConnectError('expired');
    try {
      return (await client.collectDeviceKey(code.device_code)).api_key;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code === 'AUTHORIZATION_PENDING') continue;
      // RFC 8628: slow down by 5 s each time the server asks.
      if (error.code === 'SLOW_DOWN') {
        interval += 5000;
        continue;
      }
      if (error.code === 'ACCESS_DENIED') throw new ConnectError('denied');
      if (error.code === 'EXPIRED_TOKEN') throw new ConnectError('expired');
      throw error;
    }
  }
}
