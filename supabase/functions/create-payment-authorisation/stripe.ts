import { createSandboxStripe } from '../_shared/stripe/sandbox.ts';

import type Stripe from 'stripe';

export type SandboxIntent = {
  id: string;
  requestId: string | undefined;
  amountCents: number;
  status: Stripe.PaymentIntent.Status;
  clientSecret: string | null;
  captureBefore: string | null;
  decline:
    'insufficient_funds' | 'card_declined' | 'authentication_required' | null;
};

function project(intent: Stripe.PaymentIntent): SandboxIntent {
  if (
    intent.livemode !== false ||
    intent.currency !== 'aud' ||
    intent.capture_method !== 'manual' ||
    intent.amount_received !== 0
  )
    throw new Error('Unexpected sandbox intent.');
  const charge =
    typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const deadline = charge?.payment_method_details?.card?.capture_before;
  const validHold =
    intent.status === 'requires_capture' &&
    intent.amount_capturable === intent.amount &&
    charge?.paid &&
    charge.captured === false &&
    charge.amount === intent.amount &&
    charge.currency === 'aud' &&
    Number.isSafeInteger(deadline);
  const lastError = intent.last_payment_error;
  let decline: SandboxIntent['decline'] = null;
  if (lastError?.decline_code === 'insufficient_funds')
    decline = 'insufficient_funds';
  else if (
    lastError?.code === 'authentication_required' ||
    lastError?.decline_code === 'authentication_required'
  )
    decline = 'authentication_required';
  else if (lastError?.type === 'card_error') decline = 'card_declined';
  return {
    id: intent.id,
    requestId: intent.metadata.quicktrimr_request_id,
    amountCents: intent.amount,
    status: intent.status,
    clientSecret: intent.client_secret,
    captureBefore:
      validHold && deadline ? new Date(deadline * 1000).toISOString() : null,
    decline,
  };
}

export function createAuthorisationProvider(
  key: string,
  platformAccountId: string,
) {
  const { stripe, verifyPlatform } = createSandboxStripe(
    key,
    platformAccountId,
  );
  return {
    async create(requestId: string, amountCents: number, replacement = false) {
      await verifyPlatform();
      return project(
        await stripe.paymentIntents.create(
          {
            amount: amountCents,
            currency: 'aud',
            capture_method: 'manual',
            allowed_payment_method_types: ['card'],
            metadata: { quicktrimr_request_id: requestId },
          },
          {
            idempotencyKey:
              `quicktrimr:payment-authorisation:${requestId}` +
              (replacement ? ':recovery' : ''),
          },
        ),
      );
    },
    async read(intentId: string) {
      await verifyPlatform();
      return project(
        await stripe.paymentIntents.retrieve(intentId, {
          expand: ['latest_charge'],
        }),
      );
    },
    async cancel(intentId: string) {
      await verifyPlatform();
      return project(
        await stripe.paymentIntents.cancel(
          intentId,
          {},
          {
            idempotencyKey: `quicktrimr:release-unusable-authorisation:${intentId}`,
          },
        ),
      );
    },
  };
}

export type AuthorisationProvider = ReturnType<
  typeof createAuthorisationProvider
>;
