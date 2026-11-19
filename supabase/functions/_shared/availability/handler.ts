import {
  startAvailableNowSessionRequestSchema,
  startAvailableNowSessionResponseSchema,
  updateAvailableNowSessionRequestSchema,
  updateAvailableNowSessionResponseSchema,
  stopAvailableNowSessionRequestSchema,
  stopAvailableNowSessionResponseSchema,
  userRoleSchema,
  ownAvailableNowStateSchema,
} from '@quicktrimr/validation';
import { z } from 'zod';

import { createStoredRoleVerifier } from '../auth/stored-role.ts';
import { json } from '../responses/json.mts';

const schemas = {
  start: {
    request: startAvailableNowSessionRequestSchema,
    response: startAvailableNowSessionResponseSchema,
  },
  update: {
    request: updateAvailableNowSessionRequestSchema,
    response: updateAvailableNowSessionResponseSchema,
  },
  stop: {
    request: stopAvailableNowSessionRequestSchema,
    response: stopAvailableNowSessionResponseSchema,
  },
};
const failureSchema = z.object({
  message: z.string(),
  details: z.string().nullable().optional(),
});
const fieldsSchema = z.partialRecord(
  z.enum([
    'radiusKm',
    'availableUntil',
    'lat',
    'lng',
    'locationSource',
    'directoryId',
    'keepLocation',
  ]),
  z.string(),
);
export function createAvailableNowHandler({
  operation,
  supabaseUrl,
  anonKey,
  serviceRoleKey,
  fetcher = fetch,
  log = console,
}: {
  operation: keyof typeof schemas;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
}) {
  const baseUrl = new URL(supabaseUrl);
  const verifyRole = createStoredRoleVerifier({ baseUrl, anonKey, fetcher });
  const schema = schemas[operation];
  return async (request: Request): Promise<Response> => {
    const read = operation === 'start' && request.method === 'GET';
    if (request.method !== 'POST' && !read)
      return json({ error: 'method_not_allowed' }, 405, {
        Allow: operation === 'start' ? 'GET, POST' : 'POST',
      });
    try {
      const caller = await verifyRole(
        request.headers.get('authorization'),
        userRoleSchema.enum.barber,
      );
      if ('error' in caller)
        return json({ error: caller.error }, caller.status);
      if (read) {
        if (new URL(request.url).search)
          return json(
            {
              error: 'validation_failed',
              fields: { _request: 'No query parameters are accepted.' },
            },
            422,
          );
        const response = await fetcher(
          new URL('/rest/v1/rpc/get_available_now_state', baseUrl),
          {
            method: 'POST',
            headers: {
              apikey: serviceRoleKey,
              authorization: `Bearer ${serviceRoleKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ p_user_id: caller.userId }),
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
          },
        );
        const result: unknown = await response.json();
        if (response.ok)
          return json(ownAvailableNowStateSchema.parse(result), 200);
        if (
          response.status === 403 &&
          failureSchema.parse(result).message === 'available_now_forbidden'
        )
          return json({ error: 'forbidden' }, 403);
        throw new Error('available_now_read_failed');
      }
      const input = schema.request.safeParse(
        await request.json().catch(() => null),
      );
      if (!input.success) {
        const fields: Record<string, string> = {};
        for (const issue of input.error.issues)
          fields[String(issue.path[0] ?? '_request')] ??= issue.message;
        return json({ error: 'validation_failed', fields }, 422);
      }
      const response = await fetcher(
        new URL('/rest/v1/rpc/available_now_mobile_input', baseUrl),
        {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            p_user_id: caller.userId,
            p_operation: operation,
            p_input: input.data,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      );
      const result: unknown = await response.json();
      if (response.ok) return json(schema.response.parse(result), 200);
      const failure = failureSchema.parse(result);
      if (
        response.status === 403 &&
        failure.message === 'available_now_forbidden'
      )
        return json({ error: 'forbidden' }, 403);
      if (
        response.status === 403 &&
        failure.message === 'onboarding_incomplete'
      )
        return json({ error: 'onboarding_incomplete' }, 403);
      if (response.status === 404 && failure.message === 'not_found')
        return json({ error: 'not_found' }, 404);
      if (
        response.status === 409 &&
        ['barber_unavailable', 'invalid_status_transition'].includes(
          failure.message,
        )
      )
        return json({ error: failure.message }, 409);
      if (response.status === 422 && failure.message === 'validation_failed')
        return json(
          {
            error: 'validation_failed',
            fields: fieldsSchema.parse(JSON.parse(failure.details ?? '{}')),
          },
          422,
        );
      throw new Error('available_now_rpc_failed');
    } catch {
      log.error('available_now_request_failed');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
