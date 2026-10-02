import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { requireAdmin } from '../../../server/admin';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

/**
 * Every page under /admin (but two-factor) needs an admin who passed TOTP in
 * this browser. Each page checks again: a client navigation can render a page
 * without this layout.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return children;
}
