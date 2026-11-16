import 'server-only';
import { cookies } from 'next/headers';

import {
  adminSessionOperation,
  createAdminProvider,
  isAdminCookie,
} from './provider';

export async function readAdminSession() {
  const store = await cookies();
  const values = store.getAll();
  if (!values.some(({ name }) => isAdminCookie(name)))
    return { status: 'anonymous' } as const;
  const session = await adminSessionOperation(
    createAdminProvider({ getAll: () => values }),
    'check',
  );
  return session.status === 'anonymous'
    ? ({ status: 'expired' } as const)
    : session;
}
