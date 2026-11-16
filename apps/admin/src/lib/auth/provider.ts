import 'server-only';
import { postgresUuidSchema } from '@quicktrimr/validation';
import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';

import { adminEnv } from '@/lib/env';

export const adminCookieOptions = {
  name: 'quicktrimr-admin-auth',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;

export function isAdminCookie(name: string) {
  return (
    name === adminCookieOptions.name ||
    name.startsWith(`${adminCookieOptions.name}.`)
  );
}

export function createAdminProvider(cookies: CookieMethodsServer) {
  return createServerClient(adminEnv.supabaseUrl, adminEnv.supabaseAnonKey, {
    cookieOptions: adminCookieOptions,
    cookies,
  });
}

export type AdminAccess =
  | { status: 'active'; userId: string }
  | { status: 'anonymous' | 'expired' | 'forbidden' };

export async function adminSessionOperation(
  provider: ReturnType<typeof createAdminProvider>,
  operation: 'open' | 'check' | 'close',
): Promise<AdminAccess> {
  const { data, error } = await provider.auth.getSession();
  if (error) {
    if (error.status && error.status < 500 && error.status !== 429)
      return { status: 'expired' };
    throw new Error('Admin session verification unavailable.');
  }
  if (!data.session) return { status: 'anonymous' };

  // PostgREST verifies the bearer and the RPC reads auth.uid() and the database
  // role. The local user object and any role metadata are never consulted.
  const result = await provider.rpc('admin_dashboard_session', {
    p_operation: operation,
  });
  if (result.status === 401) return { status: 'expired' };
  if (result.error) throw new Error('Admin session verification unavailable.');

  const response: unknown = result.data;
  if (response && typeof response === 'object' && 'status' in response) {
    if (response.status === 'expired' || response.status === 'forbidden')
      return { status: response.status };
    if (response.status === 'active' && 'userId' in response) {
      return {
        status: 'active',
        userId: postgresUuidSchema.parse(response.userId),
      };
    }
  }
  throw new Error('Invalid admin session response.');
}
