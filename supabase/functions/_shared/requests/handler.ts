import {
  createBookingRequestRequestSchema,
  createBookingRequestResponseSchema,
  userRoleSchema,
} from '@quicktrimr/validation';
import { z } from 'zod';

import { createStoredRoleVerifier } from '../auth/stored-role.ts';
import { json } from '../responses/json.mts';

const failureSchema = z.object({
  message: z.string(),
  details: z.string().nullable().optional(),
});
const fieldsSchema = z.partialRecord(
  z.enum(['_request', 'clientAddressId', 'scheduledFor']),
  z.string(),
);

export function createBookingRequestHandler({
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
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    try {
      const caller = await verifyRole(
        request.headers.get('authorization'),
        userRoleSchema.enum.client,
      );
      if ('error' in caller)
        return json({ error: caller.error }, caller.status);
      const parsed = createBookingRequestRequestSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues)
          fields[String(issue.path[0] ?? '_request')] ??= issue.message;
        return json({ error: 'validation_failed', fields }, 422);
      }
      const response = await fetcher(
        new URL('/rest/v1/rpc/create_booking_request', baseUrl),
        {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            p_client_id: caller.userId,
            p_input: parsed.data,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      );
      const raw: unknown = await response.json();
      if (response.ok)
        return json(createBookingRequestResponseSchema.parse(raw), 200);
      const failure = failureSchema.parse(raw);
      if (
        response.status === 403 &&
        ['request_forbidden', 'onboarding_incomplete'].includes(failure.message)
      )
        return json(
          {
            error:
              failure.message === 'request_forbidden'
                ? 'forbidden'
                : failure.message,
          },
          403,
        );
      if (
        response.status === 409 &&
        [
          'active_request_exists',
          'duplicate_request_intent',
          'barber_unavailable',
          'review_changed',
        ].includes(failure.message)
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
      throw new Error('request_write_failed');
    } catch {
      log.error('booking_request.internal_error');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
