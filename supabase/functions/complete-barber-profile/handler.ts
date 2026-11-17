import { barberPhotoLimits } from '@quicktrimr/shared';
import {
  barberAreaLookupResultSchema,
  barberAreaLookupSchema,
  barberPhotoIdSchema,
  completeBarberProfileRequestSchema,
  completeBarberProfileResponseSchema,
  postgresUuidSchema,
} from '@quicktrimr/validation';

import { createSupabaseUserVerifier } from '../_shared/auth/supabase-user.mts';
import { json } from '../_shared/responses/json.mts';

import { normalizeBarberPhoto, photoObject } from './photo.ts';

type Options = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
};

class BarberProfileRpcError extends Error {}

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const validationFailure = (field: string, message: string) =>
  json({ error: 'validation_failed', fields: { [field]: message } }, 422);

export function createCompleteBarberProfileHandler({
  supabaseUrl,
  anonKey,
  serviceRoleKey,
  fetcher = fetch,
  log = console,
}: Options) {
  const baseUrl = new URL(supabaseUrl);
  const verifyUser = createSupabaseUserVerifier({ baseUrl, anonKey, fetcher });
  const serviceHeaders = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
  };

  function backend(
    path: string,
    body: string | Uint8Array<ArrayBuffer>,
    headers: Record<string, string> = {},
  ) {
    return fetcher(new URL(path, baseUrl), {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        'content-type': 'application/json',
        ...headers,
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  }

  async function invokeRpc(userId: string, payload: JsonRecord) {
    const res = await backend(
      '/rest/v1/rpc/manage_barber_profile',
      JSON.stringify({ p_user_id: userId, p_request: payload }),
    );
    const body: unknown = await res.json();
    if (!res.ok)
      throw new BarberProfileRpcError(
        isRecord(body) && typeof body.message === 'string'
          ? body.message
          : 'rpc_failed',
      );
    if (!isRecord(body)) throw new Error('Missing barber profile result');
    return body;
  }

  async function signPhoto(userId: string, id: unknown) {
    if (id === null) return null;
    const path = `/object/sign/${photoObject(userId, barberPhotoIdSchema.parse(id))}`;
    const result = await backend(
      `/storage/v1${path}`,
      JSON.stringify({ expiresIn: barberPhotoLimits.signedUrlSeconds }),
    );
    const body: unknown = await result.json();
    if (
      !result.ok ||
      !isRecord(body) ||
      typeof body.signedURL !== 'string' ||
      !body.signedURL.startsWith(`${path}?token=`)
    )
      throw new Error('Photo signing failed');
    return `/storage/v1${body.signedURL}`;
  }

  return async (request: Request) => {
    const pathname = new URL(request.url).pathname.replace(/\/$/, '');
    const lookup = pathname.endsWith('/search');
    const upload = pathname.endsWith('/photo');
    const ownProfile = pathname.endsWith('/complete-barber-profile');
    if (!ownProfile && !lookup && !upload)
      return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST' && !(request.method === 'GET' && ownProfile))
      return json({ error: 'method_not_allowed' }, 405, {
        Allow: ownProfile ? 'GET, POST' : 'POST',
      });

    try {
      const identity = postgresUuidSchema.safeParse(
        await verifyUser(request.headers.get('authorization')),
      );
      if (!identity.success) return json({ error: 'unauthenticated' }, 401);
      const userId = identity.data;

      if (upload) {
        await invokeRpc(userId, { operation: 'authorize_photo' });
        const photo = await normalizeBarberPhoto(request);
        if (!photo)
          return validationFailure(
            'photo',
            `Choose a JPEG up to ${barberPhotoLimits.maxBytes / 1024 ** 2} MiB and ${barberPhotoLimits.maxPixelsPerSide} pixels per side.`,
          );
        const response = await backend(
          `/storage/v1/object/${photoObject(userId, photo.id)}`,
          photo.bytes,
          {
            'content-type': 'image/jpeg',
            'x-upsert': 'true',
          },
        );
        if (!response.ok) throw new Error('Photo storage write failed');
        return json({ photoId: photo.id }, 200);
      }

      const read = request.method === 'GET';
      const input: unknown = read
        ? null
        : await request.json().catch(() => null);
      if (lookup) {
        const query = barberAreaLookupSchema.safeParse(input);
        if (!query.success)
          return validationFailure('query', 'Enter more of the address.');
        const result = await invokeRpc(userId, {
          operation: 'search',
          ...query.data,
        });
        return json(barberAreaLookupResultSchema.parse(result), 200);
      }
      let result: JsonRecord;
      if (read) {
        result = await invokeRpc(userId, { operation: 'read' });
      } else {
        const parsed = completeBarberProfileRequestSchema.safeParse(input);
        if (!parsed.success) {
          const fields = Object.fromEntries(
            parsed.error.issues.map((issue) => [
              issue.path[0] ?? '_request',
              issue.message,
            ]),
          );
          return json({ error: 'validation_failed', fields }, 422);
        }
        result = await invokeRpc(userId, { operation: 'save', ...parsed.data });
      }
      if (read && result.profile === null) return json({ profile: null }, 200);
      if (!isRecord(result.profile))
        throw new Error('Missing saved barber profile');
      const { photoId, ...fields } = result.profile;
      const profile = completeBarberProfileResponseSchema.parse({
        ...fields,
        photoUrl: await signPhoto(userId, photoId),
      });
      return json(read ? { profile } : profile, 200);
    } catch (error) {
      if (error instanceof BarberProfileRpcError) {
        if (error.message === 'barber_profile_forbidden')
          return json({ error: 'forbidden' }, 403);
        if (error.message === 'barber_area_unresolved')
          return validationFailure(
            'serviceAreaDirectoryId',
            'Choose an Australian address or location in a recognised suburb or locality.',
          );
        if (error.message === 'barber_photo_unavailable')
          return validationFailure('photo', 'Upload your photo again.');
      }
      log.error('Barber profile request failed.');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
