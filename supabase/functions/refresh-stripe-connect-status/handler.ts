import {
  postgresUuidSchema,
  refreshStripeConnectStatusRequestSchema,
} from '@quicktrimr/validation';

import { createSupabaseUserVerifier } from '../_shared/auth/supabase-user.mts';
import { json } from '../_shared/responses/json.mts';
import {
  ConnectRoleError,
  ConnectProviderError,
  ConnectRefreshBusy,
  type ConnectRefresher,
} from '../_shared/stripe/refresh.ts';

type Options = {
  supabaseUrl: string;
  anonKey: string;
  refresh: ConnectRefresher;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
};
export function createConnectStatusHandler({
  supabaseUrl,
  anonKey,
  refresh,
  fetcher = fetch,
  log = console,
}: Options) {
  const verifyUser = createSupabaseUserVerifier({
    baseUrl: new URL(supabaseUrl),
    anonKey,
    fetcher,
  });
  return async (request: Request) => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    try {
      const user = postgresUuidSchema.safeParse(
        await verifyUser(request.headers.get('authorization')),
      );
      if (!user.success) return json({ error: 'unauthenticated' }, 401);
      const parsed = refreshStripeConnectStatusRequestSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success)
        return json(
          {
            error: 'validation_failed',
            fields: { _request: 'Send an empty JSON object.' },
          },
          422,
        );
      const result = await refresh({ userId: user.data });
      if (!result.status) throw new Error('Unexpected refresh response.');
      return json(result.status, 200);
    } catch (error) {
      if (error instanceof ConnectRoleError)
        return json({ error: 'forbidden' }, 403);
      if (error instanceof ConnectRefreshBusy)
        return json({ error: 'stripe_refresh_in_progress' }, 409);
      if (error instanceof ConnectProviderError) {
        log.error('stripe_connect.refresh_unavailable');
        return json({ error: 'stripe_unavailable' }, 502);
      }
      log.error('stripe_connect.refresh_failed');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
