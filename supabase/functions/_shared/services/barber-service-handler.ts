import { audPriceText } from '@quicktrimr/domain';
import {
  archiveBarberServiceRequestSchema,
  archiveBarberServiceResponseSchema,
  integerCentsSchema,
  upsertBarberServiceRequestSchema,
  upsertBarberServiceResponseSchema,
  userRoleSchema,
} from '@quicktrimr/validation';
import { z } from 'zod';

import { createStoredRoleVerifier } from '../auth/stored-role.ts';
import { json } from '../responses/json.mts';

const schemas = {
  upsert: {
    request: upsertBarberServiceRequestSchema,
    response: upsertBarberServiceResponseSchema,
  },
  archive: {
    request: archiveBarberServiceRequestSchema,
    response: archiveBarberServiceResponseSchema,
  },
};
const failureSchema = z.object({
  message: z.string(),
  details: z.string().nullable().optional(),
});
const boundsSchema = z.strictObject({
  min: integerCentsSchema,
  max: integerCentsSchema,
});

export function createBarberServiceHandler({
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
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    try {
      const caller = await verifyRole(
        request.headers.get('authorization'),
        userRoleSchema.enum.barber,
      );
      if ('error' in caller)
        return json({ error: caller.error }, caller.status);
      const parsed = schema.request.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues)
          fields[String(issue.path[0] ?? '_request')] ??= issue.message;
        return json({ error: 'validation_failed', fields }, 422);
      }
      const response = await fetcher(
        new URL('/rest/v1/rpc/manage_barber_service', baseUrl),
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
            p_input: parsed.data,
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
        failure.message === 'barber_service_forbidden'
      )
        return json({ error: 'forbidden' }, 403);
      if (
        response.status === 404 &&
        ['not_found', 'category_unavailable'].includes(failure.message)
      )
        return json({ error: failure.message }, 404);
      if (response.status === 422) {
        if (failure.message === 'price_outside_category_bounds') {
          const bounds = boundsSchema.parse(
            JSON.parse(failure.details ?? 'null'),
          );
          return json(
            {
              error: 'validation_failed',
              fields: {
                priceCents: `Enter a price between A$${audPriceText(bounds.min)} and A$${audPriceText(bounds.max)}.`,
              },
            },
            422,
          );
        }
        if (failure.message === 'validation_failed')
          return json(
            {
              error: 'validation_failed',
              fields: { _request: 'Invalid service data' },
            },
            422,
          );
      }
      throw new Error('Service mutation failed.');
    } catch {
      log.error('barber_services.internal_error');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
