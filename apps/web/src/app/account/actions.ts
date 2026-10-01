'use server';

/** Account settings actions (server build). Next checks the Origin on every action (CSRF). */
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { eq, users } from '@etb/db';

import { log } from '../../lib/log';
import { currentUser, deleteAccount } from '../../server/account';
import { createKey, MAX_KEYS, revokeKey, SCOPES, TooManyKeys } from '../../server/api-keys';
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

const NewKey = z.strictObject({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(SCOPES)).min(1),
});

export interface NewKeyState {
  /** The new key, shown this once. */
  key?: string;
  name?: string;
  error?: string;
}

/** Makes an API key and hands it back once; the page lists it by prefix from then on. */
export async function createApiKey(_state: NewKeyState, formData: FormData): Promise<NewKeyState> {
  const user = await signedIn();
  const parsed = NewKey.safeParse({
    name: field(formData, 'name'),
    scopes: formData.getAll('scopes'),
  });
  if (!parsed.success) {
    return { error: 'Give the key a name (up to 60 characters) and at least one permission.' };
  }
  try {
    const { key, row } = await createKey(user.id, parsed.data.name, parsed.data.scopes);
    log.info({ user_ref: user.id, key_ref: row.id }, 'api_key.created');
    revalidatePath('/account');
    return { key, name: row.name };
  } catch (error) {
    if (error instanceof TooManyKeys) {
      return { error: `You have ${String(MAX_KEYS)} keys already. Revoke one first.` };
    }
    throw error;
  }
}

export async function revokeApiKey(formData: FormData): Promise<void> {
  const user = await signedIn();
  const id = z.uuid().safeParse(field(formData, 'id'));
  if (id.success && (await revokeKey(user.id, id.data))) {
    log.info({ user_ref: user.id, key_ref: id.data }, 'api_key.revoked');
  }
  redirect('/account?revoked=1#api-keys');
}
