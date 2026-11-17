import {
  manageClientAddressesRequestSchema,
  manageClientAddressesResponseSchema,
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

const validationMessages = {
  label: 'Enter a label for this address',
  line1: 'Enter a street address',
  suburb: 'Enter a suburb or locality',
  state: 'Choose an Australian state or territory',
  postcode: 'Enter a four-digit postcode',
  unit: 'Shorten the unit number',
  accessNotes: 'Shorten the access notes',
  query: 'Enter more of the address',
  lat: 'Location is unavailable',
  lng: 'Location is unavailable',
} as const;

export function createManageClientAddressesHandler({
  supabaseUrl,
  anonKey,
  serviceRoleKey,
  fetcher = fetch,
  log = console,
}: Options) {
  const baseUrl = new URL(supabaseUrl);
  const verifyUser = createSupabaseUserVerifier({ baseUrl, anonKey, fetcher });
  const endpoint = new URL('/rest/v1/rpc/manage_client_addresses', baseUrl);

  return async (request: Request) => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    try {
      const identity = postgresUuidSchema.safeParse(
        await verifyUser(request.headers.get('authorization')),
      );
      if (!identity.success) return json({ error: 'unauthenticated' }, 401);

      const payload: unknown = await request.json().catch(() => null);
      const input = manageClientAddressesRequestSchema.safeParse(payload);
      if (!input.success) {
        const fields: Record<string, string> = {};
        for (const issue of input.error.issues) {
          const key = issue.path.at(-1);
          if (typeof key === 'string' && Object.hasOwn(validationMessages, key))
            fields[key] =
              validationMessages[key as keyof typeof validationMessages];
          else fields._request = 'Invalid address request';
        }
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
          p_user_id: identity.data,
          p_request: input.data,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });

      const result: unknown = await response.json();
      if (!response.ok) {
        const message =
          result && typeof result === 'object' && 'message' in result
            ? result.message
            : null;
        switch (message) {
          case 'client_address_forbidden':
            return json({ error: 'forbidden' }, 403);
          case 'client_address_not_found':
            return json({ error: 'not_found' }, 404);
          case 'address_archived':
            return json({ error: 'address_archived' }, 409);
          case 'client_address_unresolved':
            return json(
              {
                error: 'validation_failed',
                fields: {
                  line1:
                    'We could not match this address. Check the street, suburb and postcode.',
                },
              },
              422,
            );
          default:
            throw new Error('Client address operation failed.');
        }
      }

      const data = manageClientAddressesResponseSchema.parse(result);
      if (data.operation !== input.data.operation)
        throw new Error('Unexpected client address response.');
      return json(data, 200);
    } catch {
      log.error('client_address.operation_failed');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
