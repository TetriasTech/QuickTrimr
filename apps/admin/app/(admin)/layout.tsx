import { AdminShell } from '@/components/admin/layout';
import { requireAdmin } from '@/lib/auth/require-admin';

import type { ReactNode } from 'react';

// Do not prerender protected content or cache it across users.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const admin = await requireAdmin();
  return <AdminShell adminUserId={admin.userId}>{children}</AdminShell>;
}
