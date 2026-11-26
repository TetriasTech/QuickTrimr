import {
  acceptBookingRequestRequestSchema,
  acceptBookingRequestResponseSchema,
  userRoleSchema,
} from '@quicktrimr/validation';
import { z } from 'zod';

import { createStoredRoleVerifier } from '../auth/stored-role.ts';
import { json } from '../responses/json.mts';

const rpcFailure = z.object({ message: z.string() });
const conflicts = new Set([
  'request_not_pending',
  'active_job_exists',
  'barber_unavailable',
]);

export function createAcceptBookingRequestHandler({
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
  const endpoint = new URL('/rest/v1/rpc/accept_booking_request', baseUrl);
  const verifyRole = createStoredRoleVerifier({ baseUrl, anonKey, fetcher });
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    try {
      const caller = await verifyRole(
        request.headers.get('authorization'),
        userRoleSchema.enum.barber,
      );
      if ('error' in caller)
        return json({ error: caller.error }, caller.status);

      const parsed = acceptBookingRequestRequestSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues)
          fields[String(issue.path[0] ?? '_request')] ??= issue.message;
        return json({ error: 'validation_failed', fields }, 422);
      }

      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          p_barber_id: caller.userId,
          p_request_id: parsed.data.requestId,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      const raw: unknown = await response.json();
      if (response.ok)
        return json(acceptBookingRequestResponseSchema.parse(raw), 200);
      const { message } = rpcFailure.parse(raw);
      if (response.status === 403 && message === 'forbidden')
        return json({ error: 'forbidden' }, 403);
      if (response.status === 409 && conflicts.has(message))
        return json({ error: message }, 409);
      throw new Error('request_acceptance_failed');
    } catch {
      log.error('booking_request.accept_internal_error');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
