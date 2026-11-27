import Stripe from 'stripe';

import { createSandboxStripe } from '../_shared/stripe/sandbox.ts';

type IntentIdentity = {
  intentId: string;
  requestId: string;
  amountCents: number;
};
type CapturedCharge = {
  chargeId: string;
  balanceTransactionId?: string;
  feeCents?: number;
};

type IntentOutcome =
  | ({ status: 'captured' } & CapturedCharge)
  | { status: 'capturable'; expiresAt: number }
  | { status: 'failed' }
  | { status: 'unknown' };

function project(
  intent: Stripe.PaymentIntent,
  attempt: IntentIdentity,
): IntentOutcome {
  if (
    intent.id !== attempt.intentId ||
    intent.livemode !== false ||
    intent.metadata.quicktrimr_request_id !== attempt.requestId ||
    intent.currency !== 'aud' ||
    intent.capture_method !== 'manual' ||
    intent.amount !== attempt.amountCents
  )
    throw new Error('Unexpected sandbox capture identity.');

  const charge =
    typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  if (
    intent.status === 'succeeded' &&
    intent.amount_received === attempt.amountCents &&
    charge?.captured &&
    charge.paid &&
    charge.currency === 'aud' &&
    charge.amount_captured === attempt.amountCents
  ) {
    const transaction =
      typeof charge.balance_transaction === 'object'
        ? charge.balance_transaction
        : null;
    const fee =
      transaction?.currency === 'aud' &&
      Number.isSafeInteger(transaction.fee) &&
      transaction.fee >= 0
        ? { balanceTransactionId: transaction.id, feeCents: transaction.fee }
        : {};
    return { status: 'captured', chargeId: charge.id, ...fee };
  }
  if (intent.amount_received !== 0) return { status: 'unknown' };
  const expiresAt = charge?.payment_method_details?.card?.capture_before;
  if (
    intent.status === 'requires_capture' &&
    intent.amount_capturable === attempt.amountCents &&
    charge?.paid &&
    charge.captured === false &&
    expiresAt &&
    Number.isSafeInteger(expiresAt)
  )
    return { status: 'capturable', expiresAt: expiresAt * 1000 };
  if (
    ['canceled', 'requires_payment_method', 'requires_action'].includes(
      intent.status,
    )
  )
    return { status: 'failed' };
  return { status: 'unknown' };
}

const expand = ['latest_charge.balance_transaction'];

export function createCaptureProvider(key: string, sandboxAccount: string) {
  const { stripe, verifyPlatform } = createSandboxStripe(key, sandboxAccount);
  return {
    async read(attempt: IntentIdentity): Promise<IntentOutcome> {
      await verifyPlatform();
      return project(
        await stripe.paymentIntents.retrieve(attempt.intentId, { expand }),
        attempt,
      );
    },
    async capture(attempt: IntentIdentity & { paymentId: string }) {
      await verifyPlatform();
      try {
        return project(
          await stripe.paymentIntents.capture(
            attempt.intentId,
            {
              amount_to_capture: attempt.amountCents,
              expand,
            },
            { idempotencyKey: 'quicktrimr:capture:' + attempt.paymentId },
          ),
          attempt,
        );
      } catch (error) {
        // Provider errors can contain the entire PaymentIntent and secrets.
        if (
          error instanceof Stripe.errors.StripeError &&
          error.code === 'charge_expired'
        )
          return { status: 'expired' as const };
        if (error instanceof Stripe.errors.StripeCardError)
          return { status: 'failed' as const };
        return { status: 'unknown' as const };
      }
    },
  };
}

export type CaptureProvider = ReturnType<typeof createCaptureProvider>;
