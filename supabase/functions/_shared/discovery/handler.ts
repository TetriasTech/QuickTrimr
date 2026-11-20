import { discoveryBounds } from '@quicktrimr/domain';
import {
  barberPhotoIdSchema,
  discoveryConfigSchema,
  discoveryResultSchema,
  discoverySortKeySchema,
  errorResponseSchema,
  searchAvailableNowBarbersRequestSchema,
  searchAvailableNowBarbersResponseSchema,
} from '@quicktrimr/validation';
import { z } from 'zod';

import { createStoredRoleVerifier } from '../auth/stored-role.ts';
import { signBarberPhotos } from '../profiles/signed-photo.ts';
import { json } from '../responses/json.mts';

import { createDiscoveryCursorCodec } from './cursor.ts';

const rpcSchema = z.strictObject({
  rows: z.array(
    z.strictObject({
      photoId: barberPhotoIdSchema.nullable(),
      result: discoveryResultSchema,
    }),
  ),
  nextKey: discoverySortKeySchema.nullable(),
});
const databaseFields = errorResponseSchema.shape.fields
  .unwrap()
  .refine((fields) =>
    Object.keys(fields).every((field) =>
      ['radiusKm', 'limit', 'lat', 'lng', 'bookingType', '_request'].includes(
        field,
      ),
    ),
  );
class DiscoveryRejection extends Error {
  readonly status: 403 | 422;
  readonly fields: Record<string, string> | undefined;
  constructor(
    status: 403 | 422,
    fields: Record<string, string> | undefined = undefined,
  ) {
    super('Discovery request rejected.');
    this.status = status;
    this.fields = fields;
  }
}
export function createDiscoveryHandler({
  supabaseUrl,
  anonKey,
  serviceRoleKey,
  cursorKey,
  fetcher = fetch,
  log = console,
}: {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  cursorKey: string;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
}) {
  const baseUrl = new URL(supabaseUrl),
    verifyRole = createStoredRoleVerifier({ baseUrl, anonKey, fetcher });
  let codec: ReturnType<typeof createDiscoveryCursorCodec> | undefined;
  const rpc = async (name: string, body: unknown) => {
    const response = await fetcher(new URL('/rest/v1/rpc/' + name, baseUrl), {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      if (result && typeof result === 'object' && 'message' in result) {
        if (response.status === 403 && result.message === 'discovery_forbidden')
          throw new DiscoveryRejection(403);
        if (
          response.status === 422 &&
          result.message === 'validation_failed' &&
          'details' in result &&
          typeof result.details === 'string'
        ) {
          const fields = databaseFields.safeParse(JSON.parse(result.details));
          if (fields.success && Object.keys(fields.data).length)
            throw new DiscoveryRejection(422, fields.data);
        }
      }
      throw new Error('Discovery unavailable.');
    }
    return result;
  };
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    try {
      const caller = await verifyRole(
        request.headers.get('authorization'),
        'client',
      );
      if ('error' in caller)
        return json({ error: caller.error }, caller.status);
      const parsed = searchAvailableNowBarbersRequestSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues)
          fields[String(issue.path[0] ?? '_request')] ??= issue.message;
        return json({ error: 'validation_failed', fields }, 422);
      }
      const config = discoveryConfigSchema.parse(
        await rpc('get_discovery_config', {}),
      );
      const bounds = discoveryBounds(
        parsed.data.radiusKm,
        parsed.data.limit,
        config,
      );
      if (Object.keys(bounds.fields).length)
        return json({ error: 'validation_failed', fields: bounds.fields }, 422);
      const input = {
        ...parsed.data,
        serviceCategoryId: parsed.data.serviceCategoryId.toLowerCase(),
        limit: bounds.limit,
        ...(parsed.data.scheduledFor
          ? { scheduledFor: new Date(parsed.data.scheduledFor).toISOString() }
          : {}),
      };
      // Configuration changes invalidate the old traversal too. Page size is part
      // of this binding; changing filters/size or user requires a fresh cursor.
      const { cursor, ...query } = input;
      const binding = JSON.stringify([
        'quicktrimr.discovery.v1',
        caller.userId,
        query,
        config,
      ]);
      const cipher = await (codec ??= createDiscoveryCursorCodec(cursorKey));
      let after = null;
      if (cursor) {
        try {
          after = await cipher.open(cursor, binding);
        } catch {
          return json(
            {
              error: 'validation_failed',
              fields: { cursor: 'Refresh the search to start a new page.' },
            },
            422,
          );
        }
      }
      const result = rpcSchema.parse(
        await rpc('search_nearby_barbers', {
          p_client_id: caller.userId,
          p_request: query,
          p_after: after,
        }),
      );
      if (result.rows.length > bounds.limit)
        throw new Error('Unbounded discovery response.');
      const photoUrls = await signBarberPhotos({
        baseUrl,
        serviceRoleKey,
        photos: result.rows.map((row) => ({
          userId: row.result.barberId,
          photoId: row.photoId,
        })),
        fetcher,
      });
      const response = searchAvailableNowBarbersResponseSchema.parse({
        results: result.rows.map((row, i) => ({
          ...row.result,
          photoUrl: photoUrls[i],
        })),
        nextCursor: result.nextKey
          ? await cipher.seal(result.nextKey, binding)
          : null,
      });
      return json(response, 200);
    } catch (error) {
      if (error instanceof DiscoveryRejection)
        return json(
          error.status === 403
            ? { error: 'forbidden' }
            : { error: 'validation_failed', fields: error.fields },
          error.status,
        );
      log.error('discovery.internal_error');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
