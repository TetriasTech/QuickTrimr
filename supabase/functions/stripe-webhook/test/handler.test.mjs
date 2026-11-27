import assert from 'node:assert/strict';
import { test } from 'node:test';

import Stripe from 'stripe';

import { createStripeWebhookHandler } from '../handler.ts';

const secret = 'whsec_synthetic_signature_fixture';
const stripe = new Stripe('synthetic-test-key');
const payload = (overrides = {}) => ({
  id: 'evt_synthetic_fixture',
  type: 'v2.core.account.updated',
  livemode: false,
  related_object: {
    id: 'acct_TestFixture',
    type: 'v2.core.account',
    url: '/v2/core/accounts/acct_TestFixture',
  },
  ...overrides,
});
function fixture(refresh = async () => ({}), enqueue = async () => false) {
  const calls = [],
    errors = [],
    events = [],
    ignored = [];
  const handler = createStripeWebhookHandler({
    secrets: [secret],
    platformId: 'acct_MainSandbox',
    financial: {
      enqueue: async (event) => {
        events.push(event);
        return enqueue(event);
      },
      sweep: async () => Response.json({ processed: 0 }),
    },
    refresh: async (input) => {
      calls.push(input);
      return refresh(input);
    },
    log: {
      error: (...args) => errors.push(args),
      info: (...args) => ignored.push(args),
    },
  });
  const send = (
    event,
    { invalid = false, transform = (raw) => raw, timestamp } = {},
  ) => {
    const raw = typeof event === 'string' ? event : JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret,
      ...(timestamp === undefined ? {} : { timestamp }),
    });
    return handler(
      new Request('http://localhost/stripe-webhook', {
        method: 'POST',
        headers: invalid ? {} : { 'stripe-signature': signature },
        body: transform(raw),
      }),
    );
  };
  return { calls, errors, events, ignored, send };
}
test('signed thin events project only ID/type/account into refresh and acknowledge after commit', async () => {
  const { calls, send } = fixture();
  const response = await send(
    payload({ personal: 'private fields', context: 'acct_OtherContext' }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.deepEqual(calls, [
    {
      eventId: 'evt_synthetic_fixture',
      eventType: 'v2.core.account.updated',
      accountId: 'acct_TestFixture',
    },
  ]);
});
test('missing, stale and tampered signatures write nothing before JSON parsing', async () => {
  const { calls, send } = fixture();
  for (const options of [
    { invalid: true },
    { timestamp: 1 },
    { transform: (raw) => raw + ' ' },
  ]) {
    const response = await send(payload(), options);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_signature' });
  }
  assert.deepEqual(calls, []);
});
test('authenticated invalid bodies, foreign legacy account IDs and live-mode data fail closed', async () => {
  const { calls, send } = fixture();
  assert.equal((await send('{')).status, 400);
  assert.equal((await send(payload({ livemode: true }))).status, 403);
  assert.equal(
    (
      await send(
        payload({
          related_object: { id: 'acct_TestFixture', type: 'customer' },
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await send(
        payload({
          type: 'account.updated',
          account: 'acct_ForeignFixture',
          data: { object: { id: 'acct_TestFixture', object: 'account' } },
        }),
      )
    ).status,
    400,
  );
  assert.deepEqual(calls, []);
});
test('legacy snapshot is a refresh hint and unrecognised events are safely acknowledged', async () => {
  const { calls, ignored, send } = fixture();
  assert.equal(
    (
      await send(
        payload({
          type: 'account.updated',
          account: 'acct_TestFixture',
          data: {
            object: {
              id: 'acct_TestFixture',
              object: 'account',
              charges_enabled: true,
            },
          },
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await send(
        payload({
          type: 'invoice.updated',
          data: { object: { object: 'payment_intent' } },
        }),
      )
    ).status,
    200,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(ignored, [
    ['stripe_webhook.ignored', 'invoice.updated', 'evt_synthetic_fixture'],
  ]);
});
test('duplicate acknowledgement and failure response preserve the durable handler contract', async () => {
  const duplicate = fixture(async () => ({ duplicate: true }));
  const replay = await duplicate.send(payload());
  assert.deepEqual(await replay.json(), { received: true, duplicate: true });
  const failed = fixture(async () => {
    throw Error('private payload and destination');
  });
  const res = await failed.send(payload());
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'processing_failed' });
  assert.deepEqual(failed.errors, [
    ['stripe_connect.webhook_processing_failed'],
  ]);
});

test('financial routes save only the verified identity before acknowledging', async () => {
  const types = [
    ['payment_intent.succeeded', 'payment_intent', 'pi_Unit', null],
    ['payment_intent.payment_failed', 'payment_intent', 'pi_Unit', null],
    ['payment_intent.canceled', 'payment_intent', 'pi_Unit', null],
    ['charge.refunded', 'charge', 'ch_Unit', null],
    ['charge.dispute.created', 'dispute', 'du_Unit', null],
    ['charge.dispute.created', 'dispute', 'dp_Legacy', null],
    ...['created', 'updated', 'paid', 'failed'].map((state) => [
      'payout.' + state,
      'payout',
      'po_Unit',
      'acct_ConnectedUnit',
    ]),
  ];
  const io = fixture();
  for (const [type, kind, id, account] of types) {
    const event = payload({
      type,
      account: account ?? undefined,
      data: {
        object: {
          id,
          object: kind,
          billing_details: { name: 'do not persist' },
          amount: 4620,
        },
      },
    });
    const response = await io.send(event);
    assert.equal(response.status, 200);
    assert.deepEqual(io.events.at(-1), {
      eventId: event.id,
      type,
      objectId: id,
      accountId: account,
    });
  }
  assert.deepEqual(io.calls, []);
  assert.equal(io.events.length, types.length);
});

test('financial receipts are required for acknowledgement and bound to event kind and account', async () => {
  const io = fixture(undefined, async () => {
    throw Error('Private provider response');
  });
  const event = payload({
    type: 'payout.paid',
    account: 'acct_ConnectedUnit',
    data: { object: { id: 'po_Unit', object: 'payout' } },
  });
  for (const invalid of [
    { ...event, account: undefined },
    { ...event, account: 'acct_MainSandbox' },
    { ...event, data: { object: { id: 'tr_Unit', object: 'transfer' } } },
    {
      ...event,
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_Unit', object: 'payment_intent' } },
    },
  ])
    assert.equal((await io.send(invalid)).status, 400);
  assert.deepEqual(io.events, []);
  assert.equal((await io.send(event, { invalid: true })).status, 400);
  assert.deepEqual(io.events, []);
  assert.equal((await io.send(event)).status, 500);
  assert.deepEqual(io.errors, [
    ['stripe_webhook.receipt_failed', 'payout.paid', event.id],
  ]);
  const duplicate = fixture(undefined, async () => true);
  assert.deepEqual(await (await duplicate.send(event)).json(), {
    received: true,
    duplicate: true,
  });
});
