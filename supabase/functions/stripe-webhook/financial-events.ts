import { z } from 'zod';

import { createSandboxStripe } from '../_shared/stripe/sandbox.ts';

const intentTypes = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
] as const;
const paymentTypes = [
  ...intentTypes,
  'charge.refunded',
  'charge.dispute.created',
] as const;
const payoutTypes = [
  'payout.created',
  'payout.updated',
  'payout.paid',
  'payout.failed',
] as const;
export const financialEventType = z.enum([...paymentTypes, ...payoutTypes]);

const accountId = z
  .string()
  .max(100)
  .regex(/^acct_[A-Za-z0-9]+$/);
const eventId = z
  .string()
  .max(100)
  .regex(/^evt_[A-Za-z0-9_]+$/);
const providerObject = z.object({
  id: z.string().max(100),
  object: z.string(),
});

export function financialReference(
  event: {
    id: string;
    type: z.infer<typeof financialEventType>;
    account?: string | undefined;
    data?: { object: Record<string, unknown> } | undefined;
  },
  platformId: string,
) {
  const isPayout = event.type.startsWith('payout.');
  const account = accountId.safeParse(event.account);
  if (
    isPayout
      ? !account.success || account.data === platformId
      : event.account && event.account !== platformId
  )
    return null;
  const object = providerObject.safeParse(event.data?.object);
  const kind = isPayout
    ? 'payout'
    : event.type === 'charge.dispute.created'
      ? 'dispute'
      : event.type === 'charge.refunded'
        ? 'charge'
        : 'payment_intent';
  const ids = {
    payout: /^po_[A-Za-z0-9]+$/,
    dispute: /^(du|dp)_[A-Za-z0-9]+$/,
    charge: /^ch_[A-Za-z0-9]+$/,
    payment_intent: /^pi_[A-Za-z0-9]+$/,
  };
  if (
    !object.success ||
    object.data.object !== kind ||
    !ids[kind].test(object.data.id) ||
    !eventId.safeParse(event.id).success
  )
    return null;
  return {
    eventId: event.id,
    type: event.type,
    accountId: isPayout ? account.data! : null,
    objectId: object.data.id,
  };
}

export const financialReferenceSchema = z.strictObject({
  eventId,
  type: financialEventType,
  accountId: accountId.nullable(),
  objectId: z
    .string()
    .max(100)
    .regex(/^(pi|ch|du|dp|po)_[A-Za-z0-9]+$/),
});
export type FinancialReference = z.infer<typeof financialReferenceSchema>;

function verifyFacts(
  resource: { id: string; currency: string; livemode: boolean; amount: number },
  id: string,
) {
  if (
    resource.id !== id ||
    resource.currency !== 'aud' ||
    resource.livemode !== false ||
    !Number.isSafeInteger(resource.amount) ||
    resource.amount <= 0
  )
    throw new Error('Unexpected Stripe financial identity.');
}

export function createFinancialProvider(key: string, platformId: string) {
  const { stripe, verifyPlatform } = createSandboxStripe(key, platformId);
  return async (event: FinancialReference) => {
    await verifyPlatform();
    if (event.type.startsWith('payment_intent.')) {
      const intent = await stripe.paymentIntents.retrieve(event.objectId, {
        expand: ['latest_charge.balance_transaction'],
      });
      verifyFacts(intent, event.objectId);
      if (intent.capture_method !== 'manual')
        throw new Error('Unexpected capture method.');
      const charge =
        typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
      const captured =
        charge?.captured &&
        charge.paid &&
        charge.currency === 'aud' &&
        charge.livemode === false &&
        charge.amount_captured === intent.amount;
      const fee =
        typeof charge?.balance_transaction === 'object'
          ? charge.balance_transaction
          : null;
      return {
        status: intent.status,
        requestId: intent.metadata.quicktrimr_request_id,
        amountCents: intent.amount,
        receivedCents: intent.amount_received,
        chargeId: captured ? charge.id : null,
        ...(captured &&
        fee?.currency === 'aud' &&
        Number.isSafeInteger(fee.fee) &&
        fee.fee >= 0
          ? { balanceTransactionId: fee.id, feeCents: fee.fee }
          : {}),
      };
    }
    if (event.type === 'charge.refunded') {
      const charge = await stripe.charges.retrieve(event.objectId);
      verifyFacts(charge, event.objectId);
      if (!charge.captured || typeof charge.payment_intent !== 'string')
        throw new Error('Missing captured payment.');
      const refunds = await stripe.refunds.list({
        charge: charge.id,
        limit: 100,
      });
      if (refunds.has_more)
        throw new Error('Refund reconciliation requires operator review.');
      return {
        chargeId: charge.id,
        intentId: charge.payment_intent,
        refunds: refunds.data.map((refund) => {
          if (
            refund.charge !== charge.id ||
            refund.payment_intent !== charge.payment_intent ||
            refund.currency !== charge.currency ||
            !Number.isSafeInteger(refund.amount) ||
            refund.amount <= 0 ||
            ![
              'pending',
              'requires_action',
              'succeeded',
              'failed',
              'canceled',
            ].includes(refund.status ?? '')
          )
            throw new Error('Unexpected refund identity.');
          return {
            id: refund.id,
            status: refund.status,
            amount_cents: refund.amount,
          };
        }),
      };
    }
    if (event.type === 'charge.dispute.created') {
      const dispute = await stripe.disputes.retrieve(event.objectId);
      verifyFacts(dispute, event.objectId);
      if (
        typeof dispute.charge !== 'string' ||
        typeof dispute.payment_intent !== 'string'
      )
        throw new Error('Missing disputed payment.');
      return {
        chargeId: dispute.charge,
        intentId: dispute.payment_intent,
        amountCents: dispute.amount,
        status: dispute.status,
      };
    }

    if (!event.accountId || event.accountId === platformId)
      throw new Error('Missing connected account.');
    const payout = await stripe.payouts.retrieve(
      event.objectId,
      {},
      { stripeAccount: event.accountId },
    );
    verifyFacts(payout, event.objectId);
    return { status: payout.status, amountCents: payout.amount, platformId };
  };
}

export type FinancialProvider = ReturnType<typeof createFinancialProvider>;
