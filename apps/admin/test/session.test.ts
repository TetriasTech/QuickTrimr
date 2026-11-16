import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [{ name: 'role', value: 'admin' }] }),
}));
import { readAdminSession } from '@/lib/auth/session';

it('a role cookie cannot substitute for a session', async () => {
  expect(await readAdminSession()).toEqual({ status: 'anonymous' });
});
