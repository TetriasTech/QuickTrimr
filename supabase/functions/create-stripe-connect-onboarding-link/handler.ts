import {
  createStripeConnectOnboardingLinkRequestSchema,
  createStripeConnectOnboardingLinkResponseSchema,
  postgresUuidSchema,
  verificationStatusSchema,
} from '@quicktrimr/validation';
import { z } from 'zod';

import { createSupabaseUserVerifier } from '../_shared/auth/supabase-user.mts';
import { json } from '../_shared/responses/json.mts';

import {
  type StripeConnect,
  UnsupportedStripeConfiguration,
} from './stripe-connect.ts';

const reservationSchema = z.object({
  platformAccountId: z.string(),
  operationId: postgresUuidSchema,
  reservedAt: z.iso.datetime({ offset: true }),
  stripeAccountId: z
    .string()
    .regex(/^acct_[A-Za-z0-9]+$/)
    .nullable(),
});

// Stripe only guarantees v2 idempotent replay inside 30 days in the same sandbox.
// Stop before the boundary rather than risk creating another settlement account.
const stripeV2ReplayWindowMs = 30 * 24 * 60 * 60 * 1_000;
const replaySafetyMarginMs = 60_000;

type Options = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  platformAccountId: string;
  stripe: StripeConnect;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
};

class ConnectForbidden extends Error {}
class StripeUnavailable extends Error {}

async function provider<T>(call: () => Promise<T>) {
  try {
    return await call();
  } catch (error) {
    if (error instanceof UnsupportedStripeConfiguration) throw error;
    throw new StripeUnavailable();
  }
}

export function createConnectOnboardingHandler({
  supabaseUrl,
  anonKey,
  serviceRoleKey,
  platformAccountId,
  stripe,
  fetcher = fetch,
  log = console,
}: Options) {
  const baseUrl = new URL(supabaseUrl);
  const verifyUser = createSupabaseUserVerifier({ baseUrl, anonKey, fetcher });

  async function rpc(name: string, body: Record<string, string>) {
    const response = await fetcher(new URL(`/rest/v1/rpc/${name}`, baseUrl), {
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
    if (response.status === 403) throw new ConnectForbidden();
    if (!response.ok) throw new Error('Connect persistence failed.');
    return response;
  }

  return async (request: Request) => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });

    try {
      const identity = postgresUuidSchema.safeParse(
        await verifyUser(request.headers.get('authorization')),
      );
      if (!identity.success) return json({ error: 'unauthenticated' }, 401);
      const userId = identity.data;

      const input = await request.json().catch(() => null);
      const parsed =
        createStripeConnectOnboardingLinkRequestSchema.safeParse(input);
      if (!parsed.success) {
        const fields = Object.fromEntries(
          parsed.error.issues.flatMap((issue) =>
            issue.code === 'unrecognized_keys'
              ? issue.keys.map((key) => [key, 'Unexpected field.'])
              : [['_request', 'Send a JSON object.']],
          ),
        );
        return json({ error: 'validation_failed', fields }, 422);
      }

      const reservation = await rpc('reserve_stripe_connect_account', {
        p_user_id: userId,
        p_platform: platformAccountId,
      });
      const state = reservationSchema.parse(await reservation.json());
      if (state.platformAccountId !== platformAccountId)
        throw new UnsupportedStripeConfiguration();

      await provider(stripe.verifyPlatform);
      if (
        state.stripeAccountId === null &&
        Date.now() + replaySafetyMarginMs >=
          Date.parse(state.reservedAt) + stripeV2ReplayWindowMs
      ) {
        log.error('stripe_connect.account_reconciliation_required');
        return json({ error: 'stripe_account_reconciliation_required' }, 409);
      }

      const savedAccountId = state.stripeAccountId;
      const account = await provider(() =>
        savedAccountId === null
          ? stripe.createAccount(state.operationId)
          : stripe.retrieveAccount(savedAccountId),
      );
      if (savedAccountId === null) {
        // Later failures can resume using the saved association.
        await rpc('record_stripe_connect_account', {
          p_user_id: userId,
          p_operation_id: state.operationId,
          p_account_id: account.id,
        });
      } else if (savedAccountId !== account.id) {
        throw new UnsupportedStripeConfiguration();
      }

      const isComplete = await provider(() =>
        stripe.enforcePayoutPolicy(account),
      );
      if (isComplete) return json({ error: 'onboarding_complete' }, 409);

      const link = await provider(() => stripe.issueLink(account.id));
      const result = createStripeConnectOnboardingLinkResponseSchema.safeParse({
        ...link,
        accountStatus:
          savedAccountId === null
            ? verificationStatusSchema.enum.not_started
            : verificationStatusSchema.enum.pending,
      });
      if (!result.success) throw new StripeUnavailable();
      await rpc('audit_stripe_connect_link', {
        p_user_id: userId,
        p_account_id: account.id,
      });
      return json(result.data, 200);
    } catch (error) {
      if (error instanceof ConnectForbidden)
        return json({ error: 'forbidden' }, 403);
      if (error instanceof UnsupportedStripeConfiguration) {
        log.error('stripe_connect.unsupported_configuration');
        return json({ error: 'stripe_configuration_unsupported' }, 502);
      }
      if (error instanceof StripeUnavailable) {
        log.error('stripe_connect.provider_unavailable');
        return json({ error: 'stripe_unavailable' }, 502);
      }
      log.error('stripe_connect.internal_error');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
