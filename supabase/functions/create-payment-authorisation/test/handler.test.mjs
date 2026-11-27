import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPaymentAuthorisationHandler } from '../handler.ts';

const client = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const paymentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const captureBefore = '2026-12-01T00:00:00Z';
const intent = {
  id: 'pi_Fixture',
  requestId,
  amountCents: 4503,
  status: 'requires_payment_method',
  clientSecret: 'SDK fixture credential',
  captureBefore: null,
  decline: null,
};

function setup({
  incoming = intent,
  role = 'client',
  forbidden = false,
  fail = false,
  releaseReason = null,
} = {}) {
  const calls = [];
  const errors = [];
  let context = {
    paymentId,
    eligible: true,
    amountCents: 4503,
    status: 'requires_authorisation',
    intentId:
      incoming.status === 'requires_payment_method' && !incoming.decline
        ? null
        : intent.id,
    authorisationExpiresAt: null,
    releaseReason: null,
  };
  const handler = createPaymentAuthorisationHandler({
    supabaseUrl: 'http://127.0.0.1:55321',
    anonKey: 'anon-fixture',
    serviceRoleKey: 'service-fixture',
    fetcher: async (url, options) => {
      if (url.pathname === '/auth/v1/user')
        return Response.json({ id: client, role: 'authenticated' });
      if (url.pathname === '/rest/v1/profiles')
        return Response.json([{ role }]);
      assert.equal(url.pathname, '/rest/v1/rpc/request_payment_authorisation');
      const input = JSON.parse(options.body);
      assert.equal(input.p_client_id, client);
      assert.equal(input.p_request_id, requestId);
      if (forbidden)
        return Response.json({ message: 'sensitive context' }, { status: 403 });
      calls.push(input.p_step);
      if (input.p_step === 'bind')
        context = { ...context, intentId: input.p_stripe_intent_id };
      if (input.p_step === 'record') {
        assert.equal(input.p_capture_before, incoming.captureBefore);
        context = releaseReason
          ? { ...context, releaseReason }
          : {
              ...context,
              status: 'authorised',
              authorisationExpiresAt: input.p_capture_before,
            };
      }
      if (input.p_step === 'cancelled')
        context = { ...context, status: 'authorisation_cancelled' };
      return Response.json(context);
    },
    provider: {
      async create(id, amount) {
        calls.push('stripe.create');
        assert.equal(id, requestId);
        assert.equal(amount, 4503);
        if (fail) throw new Error('private provider payload and token');
        return incoming;
      },
      async read(id) {
        calls.push('stripe.read');
        assert.equal(id, intent.id);
        return incoming;
      },
      async cancel(id, request) {
        calls.push('stripe.cancel');
        assert.equal(id, intent.id);
        assert.equal(request, requestId);
        return { ...incoming, status: 'canceled' };
      },
    },
    log: { error: (event) => errors.push(event) },
  });
  const send = (body, token = 'Bearer synthetic-token') =>
    handler(
      new Request('http://127.0.0.1/create-payment-authorisation', {
        method: 'POST',
        headers: token ? { authorization: token } : {},
        body: JSON.stringify(body),
      }),
    );
  return { send, calls, errors };
}
const prepare = { bookingRequestId: requestId, operation: 'prepare' };
const verify = { ...prepare, operation: 'verify' };

test('owner prepares one manual intent, ignores forged amount, key and identity and binds before returning the SDK secret', async () => {
  const { send, calls } = setup();
  const result = await send({
    ...prepare,
    userId: paymentId,
    amountCents: 1,
    idempotencyKey: 'body-key',
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), {
    paymentId,
    clientSecret: intent.clientSecret,
    status: 'requires_authorisation',
    authenticationRequired: false,
  });
  assert.deepEqual(calls, ['prepare', 'stripe.create', 'bind', 'release']);
  await send(prepare);
  assert.deepEqual(calls.slice(-3), ['prepare', 'stripe.read', 'release']);
});

test('provider verification records the exact expiry and omits the SDK credential from the authorised response', async () => {
  const { send, calls } = setup({
    incoming: { ...intent, status: 'requires_capture', captureBefore },
  });
  const result = await send(verify);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    paymentId,
    status: 'authorised',
    amountCents: 4503,
    authorisationExpiresAt: new Date(captureBefore).toISOString(),
  });
  assert.deepEqual(calls, ['read', 'stripe.read', 'record']);
});

test('unusable holds persist the release before Stripe, then record the provider-confirmed cancellation', async () => {
  const { send, calls } = setup({
    incoming: { ...intent, status: 'requires_capture', captureBefore: null },
    releaseReason: 'authorisation_window_unavailable',
  });
  const result = await send(verify);
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), {
    error: 'authorisation_window_unavailable',
  });
  assert.deepEqual(calls, [
    'read',
    'stripe.read',
    'record',
    'stripe.cancel',
    'cancelled',
  ]);
});

for (const [status, decline, code] of [
  ['requires_action', null, 'authentication_required'],
  ['requires_payment_method', 'card_declined', 'card_declined'],
  ['requires_payment_method', 'insufficient_funds', 'insufficient_funds'],
]) {
  test(`verification reports ${code} safely and retains the same intent for the client`, async () => {
    const { send, calls } = setup({ incoming: { ...intent, status, decline } });
    const result = await send(verify);
    assert.equal(result.status, 402);
    assert.deepEqual(await result.json(), { error: code });
    const retry = await send(prepare);
    assert.equal(retry.status, 200);
    assert.equal(
      (await retry.json()).authenticationRequired,
      status === 'requires_action',
    );
    assert.ok(!calls.includes('stripe.create'));
  });
}

test('anonymous, non-client, foreign requests and malformed body cannot access Stripe or a client secret', async () => {
  const { send, calls } = setup();
  assert.equal((await send(prepare, '')).status, 401);
  const invalid = await send({
    bookingRequestId: 'invalid',
    operation: 'capture',
  });
  assert.equal(invalid.status, 422);
  assert.deepEqual(Object.keys((await invalid.json()).fields).sort(), [
    'bookingRequestId',
    'operation',
  ]);
  assert.deepEqual(calls, []);
  assert.equal((await setup({ role: 'barber' }).send(prepare)).status, 403);
  const foreign = setup({ forbidden: true });
  const response = await foreign.send(prepare);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'forbidden' });
  assert.deepEqual(foreign.calls, []);
});

test('an uncertain Stripe result preserves the prepared state and emits only a safe error code', async () => {
  const { send, calls, errors } = setup({ fail: true });
  const result = await send(prepare);
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { error: 'stripe_unavailable' });
  assert.deepEqual(calls, ['prepare', 'stripe.create']);
  assert.deepEqual(errors, ['payment_authorisation.provider_unavailable']);
});
