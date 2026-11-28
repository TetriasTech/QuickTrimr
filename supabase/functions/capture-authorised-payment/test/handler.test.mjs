import assert from 'node:assert/strict';
import test from 'node:test';

import Stripe from 'stripe';

import { createCaptureHandler } from '../handler.ts';
import { captureErrorOutcome } from '../stripe.ts';

const paymentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const intentId = 'pi_SyntheticCaptureTest';
const expiresAt = '2026-12-01T00:00:00Z';
const held = { status: 'capturable', expiresAt: Date.parse(expiresAt) };
const charged = {
  status: 'captured',
  chargeId: 'ch_Synthetic',
  balanceTransactionId: 'txn_Test',
  feeCents: 107,
};

function fixture({
  read,
  capture,
  expired = false,
  failureReason = null,
} = {}) {
  const records = [];
  const logs = [];
  const providerCalls = [];
  let state = {
    paymentId,
    requestId,
    intentId,
    amountCents: 4503,
    authorisationExpiresAt: expiresAt,
    expired,
    failureReason,
    idempotent: false,
    status: failureReason ? 'capture_failed' : 'capture_pending',
  };
  const handler = createCaptureHandler({
    supabaseUrl: 'http://localhost',
    serviceRoleKey: 'synthetic-service-key',
    now: () => Date.parse(expiresAt) - 1,
    log: { error: (message) => logs.push(message) },
    provider: {
      read: async () => {
        providerCalls.push('read');
        return read?.() ?? held;
      },
      capture: async (attempt) => {
        providerCalls.push(attempt);
        return capture?.() ?? charged;
      },
    },
    fetcher: async (_url, request) => {
      const body = JSON.parse(request.body);
      if (request.headers.authorization !== 'Bearer synthetic-service')
        return Response.json({}, { status: 403 });
      records.push(body);
      if (body.p_payment_id === null) return Response.json(null);
      if (body.p_step === 'complete') state = { ...state, status: 'captured' };
      if (body.p_step === 'fail')
        state = {
          ...state,
          status: 'capture_failed',
          failureReason: body.p_failure_reason,
        };
      if (body.p_step === 'begin' && state.status === 'captured')
        state = { ...state, idempotent: true };
      return Response.json(state);
    },
  });
  return {
    records,
    logs,
    providerCalls,
    send: (body = { paymentId }, jwt = 'Bearer synthetic-service') =>
      handler(
        new Request('https://local.invalid', {
          method: 'POST',
          headers: jwt ? { authorization: jwt } : {},
          body: JSON.stringify(body),
        }),
      ),
  };
}

test('uses server-derived identity and full integer cents and returns one safe response on replay', async () => {
  const io = fixture();
  const first = await io.send({
    paymentId,
    amountCents: 1,
    idempotencyKey: 'provided-key',
  });
  assert.equal(first.status, 200);
  const body = {
    paymentId,
    status: 'captured',
    capturedCents: 4503,
    bookingStatus: 'paid_confirmed',
  };
  assert.deepEqual(await first.json(), body);
  const duplicate = await io.send();
  assert.deepEqual(await duplicate.json(), { ...body, idempotent: true });
  assert.equal(io.providerCalls.length, 2);
  assert.equal(io.providerCalls[0], 'read');
  assert.equal(io.providerCalls[1].paymentId, paymentId);
  assert.equal(io.providerCalls[1].amountCents, 4503);
  assert.deepEqual(io.records[1], {
    p_payment_id: paymentId,
    p_step: 'complete',
    p_intent_id: intentId,
    p_capture_attempt: 0,
    p_captured_cents: 4503,
    p_charge_id: charged.chargeId,
    p_balance_transaction_id: charged.balanceTransactionId,
    p_fee_cents: 107,
  });
});

test('an uncertain capture is reconciled using the original intent without a second capture', async () => {
  let readCount = 0;
  const io = fixture({
    read: () => {
      readCount++;
      return readCount === 1 ? held : charged;
    },
    capture: () => ({ status: 'unknown' }),
  });
  const result = await io.send();
  assert.equal(result.status, 200);
  assert.equal(io.providerCalls.filter((call) => call !== 'read').length, 1);
  assert.equal(readCount, 2);
});

test('an unresolved provider response preserves the pending state and does not expose Stripe details', async () => {
  const io = fixture({
    read: () => {
      throw new Error('private provider detail');
    },
  });
  const result = await io.send();
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { error: 'stripe_unavailable' });
  assert.deepEqual(
    io.records.map((entry) => entry.p_step),
    ['begin'],
  );
  assert.deepEqual(io.logs, ['payment_capture.provider_unavailable']);
});

test('the exact authorisation boundary does not make a provider capture', async () => {
  const io = fixture({
    read: () => ({
      status: 'capturable',
      expiresAt: Date.parse(expiresAt) - 1,
    }),
  });
  const result = await io.send();
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), { error: 'authorisation_expired' });
  assert.deepEqual(io.providerCalls, ['read']);
});

test('a previously successful Stripe capture can be confirmed after the local hold deadline', async () => {
  const io = fixture({ expired: true, read: () => charged });
  assert.equal((await io.send()).status, 200);
  assert.deepEqual(io.providerCalls, ['read']);
  assert.deepEqual(
    io.records.map((entry) => entry.p_step),
    ['begin', 'complete'],
  );
});

test('confirmed capture rejection and provider expiry remain distinct on replay', async () => {
  for (const [providerStatus, status, error] of [
    ['failed', 402, 'capture_failed'],
    ['expired', 409, 'authorisation_expired'],
  ]) {
    const io = fixture({ capture: () => ({ status: providerStatus }) });
    for (let index = 0; index < 2; index++) {
      const result = await io.send();
      assert.equal(result.status, status);
      assert.deepEqual(await result.json(), { error });
    }
    assert.equal(io.providerCalls.length, 2);
    assert.deepEqual(
      io.records.map((entry) => entry.p_step),
      ['begin', 'fail', 'begin'],
    );
  }
});

test('worker permission is verified before exposing validation or Stripe calls', async () => {
  const io = fixture();
  assert.equal((await io.send({ paymentId }, null)).status, 401);
  assert.equal(
    (await io.send({ paymentId }, 'Bearer synthetic-user')).status,
    403,
  );
  const invalid = await io.send({ paymentId: 'invalid' });
  assert.equal(invalid.status, 422);
  assert.ok((await invalid.json()).fields.paymentId);
  assert.deepEqual(io.providerCalls, []);
});

test('Stripe capture expiry codes remain distinct from declines and uncertain responses', () => {
  for (const code of [
    'charge_expired_for_capture',
    'capture_charge_authorization_expired',
  ]) {
    const expired = new Stripe.errors.StripeInvalidRequestError({ code });
    assert.deepEqual(captureErrorOutcome(expired), { status: 'expired' });
  }
  const declined = new Stripe.errors.StripeCardError({ code: 'card_declined' });
  assert.deepEqual(captureErrorOutcome(declined), { status: 'failed' });
  assert.deepEqual(captureErrorOutcome(new Error('timeout')), {
    status: 'unknown',
  });
});
