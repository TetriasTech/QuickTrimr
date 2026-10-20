import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import Stripe from 'stripe';

import { loadVerificationConfig } from './config.mjs';

export async function sandboxClient({
  key,
  accountId,
  factory = (key) => new Stripe(key),
}) {
  if (typeof key !== 'string' || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key))
    throw new Error('STRIPE_SECRET_KEY must be a sandbox/test credential.');
  if (typeof accountId !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(accountId))
    throw new Error('An explicit sandbox account ID is required.');
  const stripe = factory(key);
  const account = await stripe.accounts.retrieve();
  if (
    account.id !== accountId ||
    account.country !== 'AU' ||
    account.default_currency !== 'aud'
  )
    throw new Error(
      'The credential does not match the selected Australian/AUD sandbox account.',
    );
  return stripe;
}

// Fixture from RULE-PAY-11's $45 worked example, not a service-price configuration.
export const manualCaptureFixture = Object.freeze({
  amount: 4500,
  currency: 'aud',
});

export async function verifyManualCapture(
  stripe,
  { accountId, pendingWindowSeconds },
) {
  const parameters = {
    ...manualCaptureFixture,
    capture_method: 'manual',
    payment_method: 'pm_card_visa',
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    metadata: {
      verification_ticket: 'P0-T18',
      verification_case: 'manual-capture-v1',
    },
    expand: ['latest_charge'],
  };
  const key = `quicktrimr:P0-T18:${accountId}:manual-capture:v1`;
  const first = await stripe.paymentIntents.create(parameters, {
    idempotencyKey: `${key}:create`,
  });
  const second = await stripe.paymentIntents.create(parameters, {
    idempotencyKey: `${key}:create`,
  });
  assert.equal(first.id, second.id);
  assert.equal(first.livemode, false);
  assert.equal(first.status, 'requires_capture');
  assert.equal(first.amount, manualCaptureFixture.amount);
  assert.equal(first.currency, manualCaptureFixture.currency);
  assert.equal(first.amount_capturable, manualCaptureFixture.amount);
  const charge = first.latest_charge;
  assert.ok(charge && typeof charge === 'object');
  const captureBefore = charge.payment_method_details?.card?.capture_before;
  assert.ok(Number.isSafeInteger(captureBefore));
  assert.ok(captureBefore - charge.created >= pendingWindowSeconds);
  const captureOptions = { idempotencyKey: `${key}:${first.id}:capture` };
  const captured = await stripe.paymentIntents.capture(
    first.id,
    {},
    captureOptions,
  );
  const duplicate = await stripe.paymentIntents.capture(
    first.id,
    {},
    captureOptions,
  );
  const observed = await stripe.paymentIntents.retrieve(first.id, {
    expand: ['latest_charge'],
  });
  for (const intent of [captured, duplicate, observed]) {
    assert.equal(intent.id, first.id);
    assert.equal(intent.livemode, false);
    assert.equal(intent.status, 'succeeded');
    assert.equal(intent.currency, manualCaptureFixture.currency);
    assert.equal(intent.amount_received, manualCaptureFixture.amount);
  }
  const chargeId = (value) =>
    typeof value.latest_charge === 'string'
      ? value.latest_charge
      : value.latest_charge?.id;
  assert.equal(chargeId(captured), charge.id);
  assert.equal(chargeId(duplicate), charge.id);
  assert.equal(chargeId(observed), charge.id);
  assert.equal(observed.latest_charge.captured, true);
  assert.equal(observed.latest_charge.livemode, false);
  assert.equal(observed.latest_charge.amount, manualCaptureFixture.amount);
  assert.equal(observed.latest_charge.currency, manualCaptureFixture.currency);
  assert.equal(observed.latest_charge.amount_refunded, 0);
  return {
    sandboxOnly: true,
    accountId,
    paymentIntentId: first.id,
    chargeId: charge.id,
    amountCents: manualCaptureFixture.amount,
    currency: manualCaptureFixture.currency,
    captureBefore,
    authorizationCreated: charge.created,
    pendingWindowSeconds,
    duplicateCreateSameIntent: true,
    duplicateCaptureSameCharge: true,
  };
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--account')
    throw new Error(
      'Usage: verify-manual-capture.mjs --account <sandbox-account-id>',
    );
  const accountId = process.argv[3];
  const stripe = await sandboxClient({
    key: process.env.STRIPE_SECRET_KEY,
    accountId,
  });
  const config = await loadVerificationConfig();
  process.stdout.write(
    `${JSON.stringify(await verifyManualCapture(stripe, { accountId, ...config }), null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    process.stderr.write(
      'Sandbox capture verification failed. Check the selected test credential/account and inspect its Dashboard; no raw provider error is logged.\n',
    );
    process.exitCode = 1;
  });
