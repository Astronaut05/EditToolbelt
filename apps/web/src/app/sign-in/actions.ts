'use server';

/** Sign-in form actions (server build). Next checks the Origin on every action (CSRF). */
import { isAPIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { log } from '../../lib/log';
import { addressOf } from '../../server/api';
import { auth, signInLinkRefused } from '../../server/auth';
import { field } from '../../server/form';
import { safeNext } from '../../server/next-path';

const Form = z.strictObject({
  email: z.email().max(254),
  next: z.string().max(512).optional(),
});

export async function sendSignInLink(formData: FormData): Promise<void> {
  const parsed = Form.safeParse({
    email: field(formData, 'email').trim(),
    next: field(formData, 'next') || undefined,
  });
  if (!parsed.success) redirect('/sign-in?error=invalid_email');
  const next = safeNext(parsed.data.next);
  const sent = await headers();
  // Counted before Better Auth writes or sends anything for this request.
  const refused = signInLinkRefused(parsed.data.email, addressOf(sent));
  if (refused) redirect(`/sign-in?error=${refused}`);
  let outcome = 'sent=1';
  try {
    await auth().api.signInMagicLink({
      body: { email: parsed.data.email, callbackURL: next, errorCallbackURL: '/sign-in' },
      headers: sent,
    });
  } catch (error) {
    const code = isAPIError(error) ? error.body?.code : undefined;
    if (code === 'ACCOUNT_DISABLED') {
      outcome = `error=${code}`;
    } else {
      log.error({ err: error }, 'auth.link_failed');
      outcome = 'error=send_failed';
    }
  }
  redirect(`/sign-in?${outcome}`);
}

export async function continueWithGoogle(formData: FormData): Promise<void> {
  const next = safeNext(formData.get('next'));
  const result = await auth().api.signInSocial({
    body: { provider: 'google', callbackURL: next, errorCallbackURL: '/sign-in' },
    headers: await headers(),
  });
  redirect(result.url ?? '/sign-in?error=send_failed');
}
