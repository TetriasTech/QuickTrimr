import {
  postgresUuidSchema,
  refreshStripeConnectStatusResponseSchema,
  type RefreshStripeConnectStatusResponse,
} from '@quicktrimr/validation';
import { z } from 'zod';

import type { ConnectStatusProvider } from './connect-status.ts';

export class ConnectRoleError extends Error {}
export class ConnectRefreshBusy extends Error {}
export class ConnectProviderError extends Error {}

export const unlinkedStatus: RefreshStripeConnectStatusResponse = {
  accountStatus: 'not_started',
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
};

const claimSchema = z.object({
  accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  token: postgresUuidSchema,
  previouslyVerified: z.boolean(),
});
type Options = {
  supabaseUrl: string;
  serviceRoleKey: string;
  platformAccountId: string;
  provider: ConnectStatusProvider;
  fetcher?: typeof fetch;
};
type Source =
  | { userId: string }
  | { accountId: string; eventId: string; eventType: string };

export function createConnectRefresher({
  supabaseUrl,
  serviceRoleKey,
  platformAccountId,
  provider,
  fetcher = fetch,
}: Options) {
  const baseUrl = new URL(supabaseUrl);
  async function rpc(name: string, args: Record<string, unknown>) {
    const res = await fetcher(new URL(`/rest/v1/rpc/${name}`, baseUrl), {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_platform: platformAccountId, ...args }),
      redirect: 'error',
      signal: AbortSignal.timeout(1_500),
    });
    if (res.status === 403) throw new ConnectRoleError();
    if (res.status === 409) throw new ConnectRefreshBusy();
    if (!res.ok) throw new Error('Connect persistence unavailable.');
    return res;
  }

  return async (source: Source) => {
    const begin = await rpc(
      'begin_stripe_connect_refresh',
      'userId' in source
        ? {
            p_user_id: source.userId,
          }
        : {
            p_account_id: source.accountId,
            p_event_id: source.eventId,
            p_event_type: source.eventType,
          },
    );
    const body: unknown = await begin.json();
    const special = z
      .object({
        unlinked: z.literal(true).optional(),
        duplicate: z.literal(true).optional(),
        ignored: z.literal(true).optional(),
        busy: z.literal(true).optional(),
      })
      .parse(body);
    if (special.unlinked) return { status: unlinkedStatus };
    if (special.duplicate) return { duplicate: true };
    if (special.ignored) return { ignored: true };
    if (special.busy) throw new ConnectRefreshBusy();
    const claim = claimSchema.parse(body);
    const identity = { p_account_id: claim.accountId, p_token: claim.token };
    try {
      let state: RefreshStripeConnectStatusResponse;
      try {
        state = await provider.read(claim.accountId, claim.previouslyVerified);
      } catch {
        throw new ConnectProviderError();
      }
      const committed = await rpc('finish_stripe_connect_refresh', {
        ...identity,
        p_state: state,
      });
      return {
        status: refreshStripeConnectStatusResponseSchema.parse(
          await committed.json(),
        ),
      };
    } catch (error) {
      // Release the token only. Provider facts and event receipts stay untouched on failure.
      // If persistence is unavailable, the DB-owned lease expires for the next retry.
      await rpc('release_stripe_connect_refresh', identity).catch(
        () => undefined,
      );
      throw error;
    }
  };
}
export type ConnectRefresher = ReturnType<typeof createConnectRefresher>;
