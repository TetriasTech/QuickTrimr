import { postgresUuidSchema, userRoleSchema } from '@quicktrimr/validation';
import { z } from 'zod';

import { createSupabaseUserVerifier } from './supabase-user.mts';

const roleRows = z.array(z.strictObject({ role: userRoleSchema })).max(1);
type Result =
  | { userId: string }
  | { error: 'unauthenticated' | 'forbidden'; status: 401 | 403 };

export function createStoredRoleVerifier({
  baseUrl,
  anonKey,
  fetcher = fetch,
}: {
  baseUrl: URL;
  anonKey: string;
  fetcher?: typeof fetch;
}) {
  const verifyUser = createSupabaseUserVerifier({ baseUrl, anonKey, fetcher });
  return async (
    authorization: string | null,
    requiredRole: z.infer<typeof userRoleSchema>,
  ): Promise<Result> => {
    const identity = postgresUuidSchema.safeParse(
      await verifyUser(authorization),
    );
    if (!identity.success) return { error: 'unauthenticated', status: 401 };
    const url = new URL('/rest/v1/profiles', baseUrl);
    url.search = new URLSearchParams({
      id: `eq.${identity.data}`,
      select: 'role',
      limit: '1',
    }).toString();
    const response = await fetcher(url, {
      headers: { apikey: anonKey, authorization: authorization! },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Role lookup unavailable.');
    if (roleRows.parse(await response.json())[0]?.role !== requiredRole)
      return { error: 'forbidden', status: 403 };
    return { userId: identity.data };
  };
}
