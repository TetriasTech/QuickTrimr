import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import Stripe from 'stripe';

import { apiJson, assertRawBody, makeUsers } from '../db/api-test-helpers.mjs';
import { sqlValue as q } from '../db/core-fixtures.mjs';
import { localStatus } from '../db/local-api.mjs';
import { queryLocal as sql } from '../db/verify.mjs';

const key = process.env.STRIPE_SECRET_KEY ?? '';
const account = process.env.STRIPE_CONNECT_SANDBOX_ACCOUNT_ID ?? '';
assert.ok(
  /^(sk|rk)_test_[A-Za-z0-9]+$/.test(key),
  'Use the verified sandbox credential.',
);
assert.ok(
  /^acct_[A-Za-z0-9]+$/.test(account),
  'Set the verified sandbox account.',
);
const stack = localStatus();
const stripe = new Stripe(key, { maxNetworkRetries: 0, telemetry: false });
const platform = await stripe.accounts.retrieveCurrent().catch(() => null);
assert.ok(
  platform?.id === account,
  'The Stripe credential must match the QuickTrimr sandbox.',
);
const { users, tokens } = await makeUsers(stack, { adversarialMetadata: true });
const client = q(users.clientA);
const barber = q(users.barberA);
const address = randomUUID();
const location = "'SRID=4326;POINT(145.2 -38.2)'::extensions.geography";
const requests = [];
const intents = new Set();
const proof = (message) => console.log('PASS ' + message);
const send = (requestId, operation, token = tokens.clientA, extra = {}) =>
  apiJson(stack, '/functions/v1/create-payment-authorisation', token, {
    method: 'POST',
    body: JSON.stringify({ bookingRequestId: requestId, operation, ...extra }),
  });
const ledger = (id) =>
  JSON.parse(
    sql(`select jsonb_build_object('payment',p.id,'intent',p.stripe_payment_intent_id,
  'status',p.status,'amount',p.gross_cents,'commission',p.commission_cents,'net',p.barber_net_cents,
  'expiry',extract(epoch from p.authorisation_expires_at),'reason',p.authorisation_release_reason,
  'audits',(select count(*) from public.audit_logs where entity_id=p.id and action='payment.authorised'))
  from public.payments p where p.booking_request_id=${q(id)}`),
  );
function fixture() {
  const id = randomUUID();
  requests.push(id);
  sql(`begin;
    insert into public.booking_requests(id,client_id,barber_id,booking_type,status,scheduled_for,expires_at)
      values(${q(id)},${client},${barber},'scheduled','pending',
        now()+interval '1 day',now()+interval '1 hour');
    insert into private.booking_request_snapshots(request_id,service_price_cents,commission_pct_snapshot,
      gross_cents,commission_cents,barber_net_cents,cancellation_refund_pct,cancellation_inconvenience_pct,
      late_cancel_window_hours,client_address_id,address_snapshot,address_location,client_snapshot,
      barber_snapshot,service_snapshot,created_at)
      values(${q(id)},4503,20,4503,900,3603,75,25,12,${q(address)},
        '{"suburb":"Carlton"}',${location},'{"displayName":"Synthetic Client"}',
        '{"displayName":"Synthetic Barber"}','{"displayName":"Synthetic service"}',now());
    commit;`);
  return id;
}
async function trackIntent(id) {
  const saved = ledger(id);
  assert.ok(
    typeof saved?.intent === 'string' && /^pi_[A-Za-z0-9]+$/.test(saved.intent),
    'Provider identity must exist.',
  );
  intents.add(saved.intent);
  return saved.intent;
}
async function readStripe(intentId) {
  return stripe.paymentIntents
    .retrieve(intentId, { expand: ['latest_charge'] })
    .catch(() => {
      throw Error('Sandbox retrieval failed. Provider details suppressed.');
    });
}
async function confirm(intentId, method, requestId) {
  try {
    await stripe.paymentIntents.confirm(
      intentId,
      {
        payment_method: method,
        use_stripe_sdk: true,
        return_url: 'quicktrimr://stripe-redirect',
      },
      { idempotencyKey: `quicktrimr-qa-confirm:${requestId}:${method}` },
    );
  } catch (error) {
    assert.ok(
      error?.type === 'StripeCardError',
      'Unexpected sandbox confirmation failure. Provider details suppressed.',
    );
  }
  return readStripe(intentId);
}
async function prepared(id, extra) {
  const result = await send(id, 'prepare', tokens.clientA, extra);
  assert.equal(
    result.status,
    200,
    'Sandbox prepare failed with a safe API error.',
  );
  const raw = result.body;
  assert.deepEqual(Object.keys(raw).sort(), [
    'authenticationRequired',
    'clientSecret',
    'paymentId',
    'status',
  ]);
  assert.equal(raw.status, 'requires_authorisation');
  assert.ok(
    typeof raw.clientSecret === 'string' && raw.clientSecret.length > 0,
    'SDK credential missing.',
  );
  return raw.paymentId;
}

try {
  sql(`begin;
    insert into public.profiles(id,role,verification_status)
      values(${client},'client','not_started'),(${q(users.clientB)},'client','not_started'),(${barber},'barber','not_started');
    insert into public.client_profiles(id) values(${client}),(${q(users.clientB)});
    insert into public.barber_profiles(id,service_area) values(${barber},${location});
    insert into public.client_addresses(id,client_id,location) values(${q(address)},${client},${location});
    commit;`);

  const id = fixture();
  for (const [token, expected] of [
    [null, 401],
    [tokens.barberA, 403],
    [tokens.clientB, 403],
  ]) {
    const result = await send(id, 'prepare', token);
    assert.equal(result.status, expected);
    assert.ok(!('clientSecret' in result.body));
  }
  const malformed = await send(id, 'prepare', tokens.clientA, {
    bookingRequestId: 'invalid',
  });
  assert.equal(malformed.status, 422);
  assert.ok(malformed.body.fields.bookingRequestId);
  const direct = await apiJson(
    stack,
    '/rest/v1/rpc/request_payment_authorisation',
    tokens.clientA,
    {
      method: 'POST',
      body: JSON.stringify({
        p_client_id: users.clientA,
        p_request_id: id,
        p_step: 'prepare',
      }),
    },
  );
  assert.equal(direct.status, 403);
  proof(
    'Live API denies anonymous, barber, foreign client and direct RPC access. Malformed input returns a field error.',
  );

  const attempts = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      send(id, 'prepare', tokens.clientA, {
        amountCents: index + 1,
        idempotencyKey: 'forged-' + index,
        userId: users.clientB,
      }),
    ),
  );
  assert.ok(
    attempts.every((result) => [200, 502].includes(result.status)),
    'Unexpected concurrent HTTP response.',
  );
  const localId = await prepared(id);
  assert.ok(
    attempts
      .filter((result) => result.status === 200)
      .every((result) => result.body.paymentId === localId),
  );
  const providerId = await trackIntent(id);
  for (const token of [tokens.clientA, tokens.clientB, tokens.barberA]) {
    const read = await apiJson(
      stack,
      `/rest/v1/payments?id=eq.${localId}&select=stripe_payment_intent_id`,
      token,
    );
    assert.equal(read.status, 403, 'Provider ID must stay private.');
    const write = await apiJson(
      stack,
      `/rest/v1/payments?id=eq.${localId}`,
      token,
      {
        method: 'PATCH',
        body: '{"status":"authorised"}',
      },
    );
    assert.equal(write.status, 403, 'Payment status is server-controlled.');
  }
  proof(
    'Direct payment API denies provider-ID reads and status writes for all tested client and barber roles.',
  );
  const staged = await readStripe(providerId);
  assert.equal(staged.livemode, false);
  assert.equal(staged.capture_method, 'manual');
  assert.equal(staged.amount, 4503);
  assert.equal(staged.amount_received, 0);
  const listed = await stripe.paymentIntents
    .list({ limit: 100 })
    .catch(() => null);
  assert.ok(
    listed?.data.filter((item) => item.metadata.quicktrimr_request_id === id)
      .length === 1,
    'Duplicate provider intent found.',
  );
  const held = await confirm(providerId, 'pm_card_visa', id);
  assert.equal(held.status, 'requires_capture');
  const settled = await Promise.all(
    Array.from({ length: 5 }, () => send(id, 'verify')),
  );
  const result = settled[0];
  assert.equal(result.status, 200);
  assert.ok(settled.every((value) => value.status === 200));
  const expected = {
    paymentId: localId,
    status: 'authorised',
    amountCents: 4503,
    authorisationExpiresAt: new Date(
      held.latest_charge.payment_method_details.card.capture_before * 1000,
    ).toISOString(),
  };
  for (const reply of settled)
    assertRawBody(reply.body, expected, 'Safe authoritative response');
  const actual = ledger(id);
  assert.equal(actual.status, 'authorised');
  assert.equal(actual.audits, 1);
  assert.equal(actual.amount, 4503);
  assert.equal(actual.commission, 900);
  assert.equal(actual.net, 3603);
  assert.equal(
    actual.expiry,
    Date.parse(expected.authorisationExpiresAt) / 1000,
  );
  proof(
    'Five parallel prepares and verifies converge on one Stripe PaymentIntent, one local payment and one authorisation audit. Snapshot 4503 cents and the provider hold deadline matched. Zero capture.',
  );

  for (const [method, code] of [
    ['pm_card_chargeDeclined', 'card_declined'],
    ['pm_card_chargeDeclinedInsufficientFunds', 'insufficient_funds'],
    ['pm_card_threeDSecure2Required', 'authentication_required'],
  ]) {
    const id = fixture();
    const payment = await prepared(id);
    const intent = await trackIntent(id);
    const failed = await confirm(intent, method, id);
    const result = await send(id, 'verify');
    assert.equal(result.status, 402, code);
    assertRawBody(result.body, { error: code }, 'Safe decline envelope');
    assert.equal(ledger(id).status, 'requires_authorisation');
    const resumed = await send(id, 'prepare');
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.paymentId, payment);
    assert.equal(
      resumed.body.authenticationRequired,
      failed.status === 'requires_action',
    );
    if (code === 'card_declined') {
      assert.equal(
        (await confirm(intent, 'pm_card_visa', id)).status,
        'requires_capture',
      );
      const retried = await send(id, 'verify');
      assert.equal(retried.status, 200);
      assert.equal(ledger(id).intent, intent);
    }
    proof(
      `Sandbox provider outcome ${code} returned the distinct safe API error and preserved the intent.`,
    );
  }

  const late = fixture();
  await prepared(late);
  const lateIntent = await trackIntent(late);
  await confirm(lateIntent, 'pm_card_visa', late);
  sql(
    `update public.booking_requests set status='expired' where id=${q(late)};`,
  );
  const release = await send(late, 'verify');
  assert.equal(release.status, 409);
  assertRawBody(
    release.body,
    { error: 'request_not_pending' },
    'Late hold release',
  );
  assert.equal((await readStripe(lateIntent)).status, 'canceled');
  assert.equal(ledger(late).status, 'authorisation_cancelled');
  assert.equal(ledger(late).audits, 0);
  proof(
    'Late sandbox hold was released with no capture and no authorised audit.',
  );
} finally {
  for (const id of requests) {
    const state = sql(
      `select stripe_payment_intent_id from public.payments where booking_request_id=${q(id)}`,
    );
    if (/^pi_[A-Za-z0-9]+$/.test(state)) intents.add(state);
  }
  for (const intent of intents) {
    const value = await readStripe(intent);
    assert.equal(value.livemode, false);
    assert.equal(value.amount_received, 0);
    if (value.status !== 'canceled') {
      const released = await stripe.paymentIntents
        .cancel(
          intent,
          {},
          {
            idempotencyKey: 'quicktrimr-qa-cleanup:' + intent,
          },
        )
        .catch(() => null);
      assert.ok(
        released?.status === 'canceled',
        'Sandbox fixture cleanup requires reconciliation.',
      );
    }
  }
  if (requests.length)
    sql(`update public.booking_requests set status='cancelled'
    where id in (${requests.map(q).join(',')}) and status='pending';`);
  for (const id of Object.values(users)) {
    await apiJson(stack, '/auth/v1/admin/users/' + id, stack.SERVICE_ROLE_KEY, {
      method: 'DELETE',
      body: '{"should_soft_delete":true}',
    });
  }
}
