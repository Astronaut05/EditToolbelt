'use server';

/** Account settings actions (server build). Next checks the Origin on every action (CSRF). */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { eq, users } from '@etb/db';

import { log } from '../../lib/log';
import { currentUser, deleteAccount } from '../../server/account';
import { auth } from '../../server/auth';
import { field } from '../../server/form';
import { db } from '../../server/db';

async function signedIn() {
  const me = await currentUser();
  if (!me) redirect('/sign-in?next=/account');
  return me.user;
}

const Profile = z.strictObject({
  displayName: z.string().trim().max(80),
  marketingOptIn: z.boolean(),
});

export async function saveProfile(formData: FormData): Promise<void> {
  const user = await signedIn();
  const parsed = Profile.safeParse({
    displayName: field(formData, 'displayName'),
    marketingOptIn: formData.get('marketingOptIn') === 'on',
  });
  if (!parsed.success) redirect('/account?error=profile');
  await db()
    .update(users)
    .set({
      displayName: parsed.data.displayName || null,
      marketingOptIn: parsed.data.marketingOptIn,
    })
    .where(eq(users.id, user.id));
  redirect('/account?saved=1');
}

export async function signOut(): Promise<void> {
  await auth().api.signOut({ headers: await headers() });
  redirect('/');
}

export async function signOutEverywhere(): Promise<void> {
  await signedIn();
  await auth().api.revokeSessions({ headers: await headers() });
  redirect('/sign-in');
}

export async function deleteMyAccount(formData: FormData): Promise<void> {
  const user = await signedIn();
  if (field(formData, 'confirm').trim().toLowerCase() !== 'delete') {
    redirect('/account?error=confirm#delete');
  }
  // Signing out first clears this browser's cookie; deleting ends every other session.
  await auth().api.signOut({ headers: await headers() });
  await deleteAccount(user.id);
  log.info({ user_ref: user.id }, 'account.deleted');
  redirect('/sign-in?deleted=1');
}
