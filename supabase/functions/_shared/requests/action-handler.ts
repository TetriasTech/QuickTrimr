import {
  acceptBookingRequestRequestSchema,
  acceptBookingRequestResponseSchema,
  declineBookingRequestRequestSchema,
  declineBookingRequestResponseSchema,
  userRoleSchema,
} from '@quicktrimr/validation';
import { z } from 'zod';

import { createStoredRoleVerifier } from '../auth/stored-role.ts';
import { json } from '../responses/json.mts';

const rpcFailure = z.object({ message: z.string() });
const actions = {
  accept: {
    input: acceptBookingRequestRequestSchema,
    output: acceptBookingRequestResponseSchema,
    conflicts: new Set([
      'request_not_pending',
      'active_job_exists',
      'barber_unavailable',
    ]),
  },
  decline: {
    input: declineBookingRequestRequestSchema,
    output: declineBookingRequestResponseSchema,
    conflicts: new Set(['request_not_pending']),
  },
} as const;

export function createBookingRequestActionHandler(
  operation: keyof typeof actions,
  {
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    fetcher = fetch,
    log = console,
    reconcilePayment,
  }: {
    supabaseUrl: string;
    anonKey: string;
    serviceRoleKey: string;
    fetcher?: typeof fetch;
    log?: Pick<Console, 'error'>;
    reconcilePayment?: (requestId: string) => Promise<boolean>;
  },
) {
  const baseUrl = new URL(supabaseUrl);
  const action = actions[operation];
  const endpoint = new URL(
    `/rest/v1/rpc/${operation}_booking_request`,
    baseUrl,
  );
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

      const parsed = action.input.safeParse(
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
          p_reason: 'reason' in parsed.data ? parsed.data.reason : undefined,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      const raw: unknown = await response.json();
      if (response.ok) {
        const result = action.output.parse(raw);
        if (reconcilePayment) {
          const captured = await reconcilePayment(parsed.data.requestId).catch(
            () => false,
          );
          if (captured && 'bookingStatus' in result)
            return json({ ...result, bookingStatus: 'paid_confirmed' }, 200);
        }
        return json(result, 200);
      }
      const { message } = rpcFailure.parse(raw);
      if (response.status === 403 && message === 'forbidden')
        return json({ error: 'forbidden' }, 403);
      if (response.status === 409 && action.conflicts.has(message))
        return json({ error: message }, 409);
      if (
        operation === 'decline' &&
        response.status === 422 &&
        message === 'invalid_decline_reason'
      )
        return json(
          {
            error: 'validation_failed',
            fields: { reason: 'Choose a supported decline reason.' },
          },
          422,
        );
      throw new Error('booking_request_action_failed');
    } catch {
      log.error(`booking_request.${operation}_internal_error`);
      return json({ error: 'internal_error' }, 500);
    }
  };
}
