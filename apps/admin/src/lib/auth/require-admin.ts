import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { USER_ROLE_VALUE } from '@quicktrimr/shared';
import { readAdminSession } from './session';

// Request-local React cache, never a persistent/shared authorization cache.
// RULE-ADMIN-01: call this at EVERY data/action boundary, not only the layout.
export const requireAdmin = cache(async () => {
  const session = await readAdminSession();
  if (!session) redirect('/login');
  if (session.role !== USER_ROLE_VALUE.ADMIN) redirect('/forbidden');
  return session;
});
