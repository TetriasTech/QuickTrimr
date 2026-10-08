import { USER_ROLE_VALUE } from '@quicktrimr/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireAdmin } from '@/lib/auth/require-admin';
import { readAdminSession } from '@/lib/auth/session';

import AdminLayout from '../app/(admin)/layout';
import AdminPage from '../app/(admin)/page';

import type { AdminSession } from '@/lib/auth/session';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({ readAdminSession: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

const sessionReader = vi.mocked(readAdminSession);
afterEach(() => vi.resetAllMocks());

describe('RULE-ADMIN-01 server boundary', () => {
  it('denies missing sessions', async () => {
    sessionReader.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toThrow('REDIRECT:/login');
  });

  it.each([USER_ROLE_VALUE.CLIENT, USER_ROLE_VALUE.BARBER])(
    'denies %s without rendering the page or layout',
    async (role) => {
      sessionReader.mockResolvedValue({ userId: 'server-verified-id', role });
      await expect(requireAdmin()).rejects.toThrow('REDIRECT:/forbidden');
      await expect(AdminPage()).rejects.toThrow('REDIRECT:/forbidden');
      await expect(AdminLayout({ children: 'private child' })).rejects.toThrow(
        'REDIRECT:/forbidden',
      );
    },
  );

  it('allows only a server-resolved admin and renders the guarded shell with its identity', async () => {
    const session = {
      userId: 'server-verified-id',
      role: USER_ROLE_VALUE.ADMIN,
    };
    sessionReader.mockResolvedValue(session);
    expect(await requireAdmin()).toEqual(session);
    const page = await AdminPage();
    const layout = await AdminLayout({ children: page });
    const html = renderToStaticMarkup(layout);
    expect(html).toContain('No operational screens yet.');
    expect(html).toContain('data-admin-shell');
    expect(html).toContain('Account: server-verified-id');
    expect(html).toContain('Admin navigation');
  });

  it('does not continue a protected page while role verification is pending', async () => {
    const pending = Promise.withResolvers<AdminSession | null>();
    sessionReader.mockReturnValue(pending.promise);
    let continued = false;
    const render = AdminPage().then((page) => {
      continued = true;
      return page;
    });
    await Promise.resolve();
    expect(continued).toBe(false);
    pending.resolve(null);
    await expect(render).rejects.toThrow('REDIRECT:/login');
    expect(continued).toBe(false);
  });

  it('fails closed if session verification throws', async () => {
    sessionReader.mockRejectedValue(new Error('verification unavailable'));
    await expect(AdminPage()).rejects.toThrow('verification unavailable');
    await expect(AdminLayout({ children: 'private child' })).rejects.toThrow(
      'verification unavailable',
    );
  });
});
