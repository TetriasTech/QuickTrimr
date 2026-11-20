import {
  getDiscoveryFiltersRequestSchema,
  getDiscoveryFiltersResponseSchema,
} from '@quicktrimr/validation';

import { createStoredRoleVerifier } from '../auth/stored-role.ts';
import { json } from '../responses/json.mts';
export function createDiscoveryFiltersHandler({
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
  const baseUrl = new URL(supabaseUrl),
    verify = createStoredRoleVerifier({ baseUrl, anonKey, fetcher });
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    try {
      const caller = await verify(
        request.headers.get('authorization'),
        'client',
      );
      if ('error' in caller)
        return json({ error: caller.error }, caller.status);
      const input = getDiscoveryFiltersRequestSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!input.success) {
        const fields: Record<string, string> = {};
        for (const issue of input.error.issues)
          fields[String(issue.path[0] ?? '_request')] ??= issue.message;
        return json({ error: 'validation_failed', fields }, 422);
      }
      const r = await fetcher(
        new URL('/rest/v1/rpc/get_client_discovery_filters', baseUrl),
        {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            p_client_id: caller.userId,
            p_address_id: input.data.addressId ?? null,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      );
      const value: unknown = await r.json();
      if (!r.ok) {
        const message =
          value && typeof value === 'object' && 'message' in value
            ? value.message
            : undefined;
        if (r.status === 403 && message === 'discovery_forbidden')
          return json({ error: 'forbidden' }, 403);
        if (r.status === 422 && message === 'address_unavailable')
          return json(
            {
              error: 'validation_failed',
              fields: { addressId: 'Choose an active saved address.' },
            },
            422,
          );
        throw new Error('Discovery filters unavailable.');
      }
      return json(getDiscoveryFiltersResponseSchema.parse(value), 200);
    } catch {
      log.error('discovery.filters_unavailable');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
