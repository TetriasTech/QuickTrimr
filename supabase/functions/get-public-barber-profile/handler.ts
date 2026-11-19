import {
  getPublicBarberProfileRequestSchema,
  getPublicBarberProfileResponseSchema,
  userRoleSchema,
} from '@quicktrimr/validation';
import { z } from 'zod';

import { createStoredRoleVerifier } from '../_shared/auth/stored-role.ts';
import { signBarberPhoto } from '../_shared/profiles/signed-photo.ts';
import { json } from '../_shared/responses/json.mts';

// Internal result may contain the photo identifier; never forward the RPC object.
const rpcResult = z.strictObject({
  photoId: z.string().nullable(),
  profile: z.unknown(),
});
export function createPublicBarberProfileHandler({
  supabaseUrl,
  anonKey,
  serviceRoleKey,
  fetcher = fetch,
  log = console,
}: {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
}) {
  const baseUrl = new URL(supabaseUrl);
  const verifyRole = createStoredRoleVerifier({ baseUrl, anonKey, fetcher });
  return async (request: Request) => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    try {
      const caller = await verifyRole(
        request.headers.get('authorization'),
        userRoleSchema.enum.client,
      );
      if ('error' in caller)
        return json({ error: caller.error }, caller.status);
      const parsed = getPublicBarberProfileRequestSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues)
          fields[String(issue.path[0] ?? '_request')] ??= issue.message;
        return json({ error: 'validation_failed', fields }, 422);
      }
      const response = await fetcher(
        new URL('/rest/v1/rpc/get_public_barber_profile', baseUrl),
        {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            p_client_id: caller.userId,
            p_barber_id: parsed.data.barberId,
            p_after: parsed.data.servicesAfter ?? null,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        if (
          response.status === 403 &&
          body &&
          typeof body === 'object' &&
          'message' in body &&
          body.message === 'public_profile_forbidden'
        )
          return json({ error: 'forbidden' }, 403);
        throw new Error('Public profile lookup failed.');
      }
      const result = rpcResult.parse(body);
      if (result.profile === null) return json({ profile: null }, 200);
      if (!result.profile || typeof result.profile !== 'object')
        throw new Error('Invalid profile.');
      const profile = getPublicBarberProfileResponseSchema.parse({
        profile: {
          ...result.profile,
          photoUrl: await signBarberPhoto({
            baseUrl,
            serviceRoleKey,
            userId: parsed.data.barberId,
            photoId: result.photoId,
            fetcher,
          }),
        },
      });
      if (profile.profile?.barberId !== parsed.data.barberId)
        throw new Error('Unexpected profile.');
      return json(profile, 200);
    } catch {
      log.error('public_barber_profile.internal_error');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
