'use server';

/** /connect's answers: approve or decline a panel's request. Next checks the Origin (CSRF). */
import { redirect } from 'next/navigation';

import { log } from '../../lib/log';
import { currentUser } from '../../server/account';
import { decide, normalizeUserCode } from '../../server/device';
import { field } from '../../server/form';

async function answer(formData: FormData, approve: boolean): Promise<void> {
  const me = await currentUser();
  const code = normalizeUserCode(field(formData, 'code'));
  if (!me) redirect('/sign-in?next=/connect');
  if (!code || !(await decide(me.user.id, code, approve))) redirect('/connect?gone=1');
  log.info({ user_ref: me.user.id, approved: approve }, 'device.decided');
  redirect(`/connect?done=${approve ? 'approved' : 'declined'}`);
}

export async function approveDevice(formData: FormData): Promise<void> {
  await answer(formData, true);
}

export async function declineDevice(formData: FormData): Promise<void> {
  await answer(formData, false);
}
