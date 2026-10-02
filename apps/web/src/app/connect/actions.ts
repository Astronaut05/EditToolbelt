'use server';

/**
 * /connect's answers: approve or decline a panel's request. Next checks the
 * Origin (CSRF). A code that isn't waiting is a miss, counted like a wrong
 * one typed on the page; locked out, nothing is looked up.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { log } from '../../lib/log';
import { currentUser } from '../../server/account';
import { addressOf } from '../../server/api';
import {
  connectLockout,
  connectMiss,
  decide,
  formatUserCode,
  normalizeUserCode,
} from '../../server/device';
import { field } from '../../server/form';

async function answer(formData: FormData, approve: boolean): Promise<void> {
  const me = await currentUser();
  if (!me) redirect('/sign-in?next=/connect');
  const address = addressOf(await headers());
  if (connectLockout(me.user.id, address) > 0) redirect('/connect?locked=1');
  const code = normalizeUserCode(field(formData, 'code'));
  const outcome = code ? await decide(me.user.id, code, approve) : 'gone';
  if (outcome === 'gone' || !code) {
    connectMiss(me.user.id, address);
    redirect('/connect?gone=1');
  }
  // The account filled up since the page was shown: the page says so.
  if (outcome === 'full') redirect(`/connect?code=${formatUserCode(code)}`);
  log.info({ user_ref: me.user.id, approved: approve }, 'device.decided');
  redirect(`/connect?done=${approve ? 'approved' : 'declined'}`);
}

export async function approveDevice(formData: FormData): Promise<void> {
  await answer(formData, true);
}

export async function declineDevice(formData: FormData): Promise<void> {
  await answer(formData, false);
}
