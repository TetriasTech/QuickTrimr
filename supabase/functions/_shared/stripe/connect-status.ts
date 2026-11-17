import {
  connectVerificationStatus,
  type ConnectVerificationInput,
} from '@quicktrimr/domain';
import { refreshStripeConnectStatusResponseSchema } from '@quicktrimr/validation';

import { createSandboxStripe, StripeConfigurationError } from './sandbox.ts';

const accountIdSchema = /^acct_[A-Za-z0-9]+$/;

export function createConnectStatusProvider(
  key: string,
  platformAccountId: string,
) {
  const { stripe, verifyPlatform } = createSandboxStripe(
    key,
    platformAccountId,
  );
  return {
    async read(accountId: string, previouslyVerified: boolean) {
      if (!accountIdSchema.test(accountId) || accountId === platformAccountId)
        throw new StripeConfigurationError();
      await verifyPlatform();
      const [current, legacy] = await Promise.allSettled([
        stripe.v2.core.accounts.retrieve(accountId, {
          include: [
            'configuration.merchant',
            'configuration.recipient',
            'requirements',
          ],
        }),
        stripe.accounts.retrieve(accountId),
      ]);
      if (current.status !== 'fulfilled')
        throw new Error('Stripe unavailable.');
      const account = current.value;
      if (account.id !== accountId || account.livemode !== false)
        throw new StripeConfigurationError();
      if (legacy.status !== 'fulfilled' && !account.closed)
        throw new Error('Stripe unavailable.');

      const projection = legacy.status === 'fulfilled' ? legacy.value : null;
      if (projection && projection.id !== accountId)
        throw new StripeConfigurationError();
      const merchant = account.configuration?.merchant?.capabilities;
      const recipient =
        account.configuration?.recipient?.capabilities?.stripe_balance;
      const caps = [
        merchant?.card_payments,
        merchant?.stripe_balance?.payouts,
        recipient?.stripe_transfers,
        recipient?.payouts,
      ] as const;
      const requirements = account.requirements?.entries ?? [];
      const disabled = projection?.requirements?.disabled_reason;
      const closed = account.closed === true;
      const rejected = Boolean(
        disabled?.startsWith('rejected.') ||
        caps.some((cap) =>
          cap?.status_details?.some((detail) =>
            detail.code.startsWith('rejected_'),
          ),
        ),
      );
      const chargesEnabled =
        !closed &&
        !rejected &&
        merchant?.card_payments?.status === 'active' &&
        projection?.charges_enabled === true;
      const payoutsEnabled =
        !closed &&
        !rejected &&
        merchant?.stripe_balance?.payouts?.status === 'active' &&
        recipient?.stripe_transfers?.status === 'active' &&
        recipient?.payouts?.status === 'active' &&
        projection?.payouts_enabled === true;
      const detailsSubmitted = projection?.details_submitted === true;
      const input: ConnectVerificationInput = {
        linked: true,
        closed,
        rejected,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        previouslyVerified,
        capabilities: [
          caps[0]?.status ?? null,
          caps[1]?.status ?? null,
          caps[2]?.status ?? null,
          caps[3]?.status ?? null,
        ],
        actionRequired:
          requirements.some(
            (entry) =>
              entry.awaiting_action_from === 'user' &&
              ['currently_due', 'past_due'].includes(
                entry.minimum_deadline.status,
              ),
          ) ||
          Boolean(
            projection?.requirements?.currently_due?.length ||
            projection?.requirements?.past_due?.length ||
            (disabled && disabled !== 'requirements.pending_verification'),
          ),
        verificationPending:
          requirements.some(
            (entry) => entry.awaiting_action_from === 'stripe',
          ) ||
          Boolean(projection?.requirements?.pending_verification?.length) ||
          caps.some((cap) => cap?.status === 'pending'),
      };
      return refreshStripeConnectStatusResponseSchema.parse({
        accountStatus: connectVerificationStatus(input),
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
      });
    },
  };
}
export type ConnectStatusProvider = ReturnType<
  typeof createConnectStatusProvider
>;
