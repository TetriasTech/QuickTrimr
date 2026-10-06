import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { readAdminSession } from '@/lib/auth/session';

it('the real placeholder always denies access; fixtures are not wired into the app', async () => {
  expect(await readAdminSession()).toBeNull();
});
