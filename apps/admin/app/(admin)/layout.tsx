import type { ReactNode } from 'react';
import { requireAdmin } from '@/lib/auth/require-admin';

// Do not prerender protected content or cache it across users.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdmin();
  return <main className="mx-auto max-w-5xl px-6 py-16">{children}</main>;
}
