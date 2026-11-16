import { USER_ROLE_VALUE } from '@quicktrimr/shared';
import {
  createOrSyncProfileRequestSchema,
  createOrSyncProfileResponseSchema,
  postgresUuidSchema,
  type CreateOrSyncProfileRequest,
} from '@quicktrimr/validation';

import { createSupabaseUserVerifier } from './supabase-user.ts';

type Options = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'warn' | 'error'>;
};

function json(body: unknown, status: number, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  return Response.json(body, { status, headers: responseHeaders });
}

function roleForbidden() {
  return json({ error: 'forbidden' }, 403);
}

// Accepts a verified identity from the handler, never a request-supplied user ID.
function createProfileSync(
  baseUrl: URL,
  serviceRoleKey: string,
  fetcher: typeof fetch,
) {
  const endpoint = new URL('/rest/v1/rpc/create_or_sync_profile', baseUrl);
  return async (userId: string, role: CreateOrSyncProfileRequest['role']) => {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: userId, p_signup_role: role }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 403) {
      const denial: unknown = await response.json();
      if (
        denial &&
        typeof denial === 'object' &&
        'message' in denial &&
        denial.message === 'profile_role_forbidden'
      ) {
        return null;
      }
    }
    if (!response.ok) throw new Error('Profile sync failed.');
    const profile = createOrSyncProfileResponseSchema.parse(
      await response.json(),
    );
    if (profile.id !== userId || profile.role !== role) {
      throw new Error('Unexpected profile identity.');
    }
    return profile;
  };
}

export function createProfileSyncHandler({
  supabaseUrl,
  anonKey,
  serviceRoleKey,
  fetcher = fetch,
  log = console,
}: Options) {
  const baseUrl = new URL(supabaseUrl);
  const verifyUser = createSupabaseUserVerifier({ baseUrl, anonKey, fetcher });
  const sync = createProfileSync(baseUrl, serviceRoleKey, fetcher);

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });

    try {
      const verifiedId = await verifyUser(request.headers.get('authorization'));
      const userId = postgresUuidSchema.safeParse(verifiedId);
      if (!userId.success) return json({ error: 'unauthenticated' }, 401);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json(
          {
            error: 'validation_failed',
            fields: { _request: 'Expected a JSON body' },
          },
          422,
        );
      }
      if (body && typeof body === 'object') {
        if ('role' in body && body.role === USER_ROLE_VALUE.ADMIN)
          return roleForbidden();
        if ('userId' in body && body.userId !== userId.data)
          log.warn('profile_sync.ignored_identity_mismatch');
      }

      const input = createOrSyncProfileRequestSchema.safeParse(body);
      if (!input.success) {
        const invalidRole = input.error.issues.some(
          (issue) => issue.path[0] === 'role',
        );
        return json(
          {
            error: 'validation_failed',
            fields: invalidRole
              ? { role: 'Must be client or barber' }
              : { _request: 'Invalid request' },
          },
          422,
        );
      }

      const profile = await sync(userId.data, input.data.role);
      return profile ? json(profile, 200) : roleForbidden();
    } catch {
      log.error('profile_sync.internal_error');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
