import {
  completeClientProfileRequestSchema,
  completeClientProfileResponseSchema,
  INVALID_AU_MOBILE_MESSAGE,
  postgresUuidSchema,
} from '@quicktrimr/validation';

import { createSupabaseUserVerifier } from '../_shared/auth/supabase-user.mts';
import { json } from '../_shared/responses/json.mts';

type Options = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
};

export function createCompleteClientProfileHandler({
  supabaseUrl,
  anonKey,
  serviceRoleKey,
  fetcher = fetch,
  log = console,
}: Options) {
  const baseUrl = new URL(supabaseUrl);
  const verifyUser = createSupabaseUserVerifier({ baseUrl, anonKey, fetcher });
  const endpoint = new URL('/rest/v1/rpc/complete_client_profile', baseUrl);

  return async (request: Request) => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    try {
      const identity = postgresUuidSchema.safeParse(
        await verifyUser(request.headers.get('authorization')),
      );
      if (!identity.success) return json({ error: 'unauthenticated' }, 401);

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

      const input = completeClientProfileRequestSchema.safeParse(body);
      if (!input.success) {
        const fields: Record<string, string> = {};
        for (const issue of input.error.issues) {
          const field = issue.path[0];
          if (field === 'mobile') fields.mobile = INVALID_AU_MOBILE_MESSAGE;
          else if (field === 'displayName')
            fields.displayName = 'Enter your display name';
          else if (field === 'attachAvatar')
            fields.attachAvatar = 'Choose and upload your profile photo';
          else fields._request = 'Invalid profile request';
        }
        return json({ error: 'validation_failed', fields }, 422);
      }

      const saved = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          p_user_id: identity.data,
          p_display_name: input.data.displayName,
          p_mobile: input.data.mobile,
          p_attach_avatar: input.data.attachAvatar === true,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!saved.ok) {
        const detail: unknown = await saved.json();
        const message =
          detail && typeof detail === 'object' && 'message' in detail
            ? detail.message
            : null;
        if (saved.status === 403 && message === 'client_profile_forbidden')
          return json({ error: 'forbidden' }, 403);
        if (saved.status === 400 && message === 'client_avatar_missing') {
          return json(
            {
              error: 'validation_failed',
              fields: {
                attachAvatar: 'Upload your profile photo before saving',
              },
            },
            422,
          );
        }
        throw new Error('Client profile save failed.');
      }

      const profile = completeClientProfileResponseSchema.parse(
        await saved.json(),
      );
      if (profile.id !== identity.data)
        throw new Error('Unexpected profile identity.');
      return json(profile, 200);
    } catch {
      log.error('client_profile.save_failed');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
