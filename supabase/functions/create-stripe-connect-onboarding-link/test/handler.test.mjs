import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createConnectOnboardingHandler } from '../handler.ts';
import {
  createStripeConnect,
  UnsupportedStripeConfiguration,
} from '../stripe-connect.ts';

const userId = 'b455a1a3-dccd-489f-a352-f7352becd37b';
const otherId = 'fabe810e-35af-4e50-ab89-046776cdcc53';
const operationId = 'd77ec306-d529-458d-8a9d-05c646634139';
const platformAccountId = 'acct_SandboxFixture';
const account = { id: 'acct_TestBarber' };
const link = {
  onboardingUrl: 'https://connect.stripe.com/setup/s/synthetic-example',
  expiresAt: '2026-12-01T00:00:00Z',
};
const suppressed =
  'SDK debug: synthetic key, bank fields and access-bearing link';

function setup({
  deny = false,
  state = {},
  provider = {},
  failRecordOnce = false,
} = {}) {
  const reservation = {
    operationId,
    reservedAt: new Date().toISOString(),
    platformAccountId,
    stripeAccountId: null,
    ...state,
  };
  const calls = [];
  const errors = [];
  const providerAttempts = [];
  const issuedAccounts = new Set();
  const options = {
    supabaseUrl: 'http://localhost:55321',
    anonKey: 'mock-anon',
    serviceRoleKey: 'mock-service',
    platformAccountId,
    log: { error: (...args) => errors.push(args) },
    stripe: {
      verifyPlatform: async () => undefined,
      createAccount: async (intent) => {
        assert.equal(intent, operationId);
        providerAttempts.push(intent);
        issuedAccounts.add(account.id);
        return account;
      },
      retrieveAccount: async (id) => {
        assert.equal(id, reservation.stripeAccountId);
        return account;
      },
      enforcePayoutPolicy: async () => false,
      issueLink: async () => link,
      ...provider,
    },
    fetcher: async (url, options) => {
      if (url.pathname === '/auth/v1/user') {
        assert.equal(options.headers.authorization, 'Bearer mock-user');
        return Response.json({
          id: userId,
          role: 'authenticated',
          app_metadata: { role: 'admin' },
        });
      }
      assert.equal(options.headers.authorization, 'Bearer mock-service');
      const name = url.pathname.split('/').at(-1);
      const body = JSON.parse(options.body);
      calls.push(name);
      assert.equal(body.p_user_id, userId);
      if (name === 'reserve_stripe_connect_account') {
        assert.equal(body.p_platform, platformAccountId);
        return deny
          ? new Response(null, { status: 403 })
          : Response.json(reservation);
      }
      if (name === 'record_stripe_connect_account') {
        assert.equal(body.p_operation_id, operationId);
        assert.equal(body.p_account_id, account.id);
        if (failRecordOnce) {
          failRecordOnce = false;
          return new Response(suppressed, { status: 500 });
        }
        reservation.stripeAccountId = body.p_account_id;
        return new Response(null, { status: 204 });
      }
      assert.equal(name, 'audit_stripe_connect_link');
      assert.equal(body.p_account_id, reservation.stripeAccountId);
      return new Response(null, { status: 204 });
    },
  };
  const handler = createConnectOnboardingHandler(options);
  const request = (body = {}, token = 'Bearer mock-user') =>
    handler(
      new Request(
        'http://localhost:55321/functions/v1/create-stripe-connect-onboarding-link',
        {
          method: 'POST',
          headers: token ? { authorization: token } : {},
          body: JSON.stringify(body),
        },
      ),
    );
  return {
    calls,
    errors,
    issuedAccounts,
    providerAttempts,
    request,
    reservation,
  };
}

test('uses verified identity, reserves a provider key, persists account before success and audits each link', async () => {
  const { calls, request, providerAttempts } = setup();
  const first = await request({
    userId: otherId,
    idempotencyKey: 'crafted',
    status: 'verified',
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await first.json(), {
    ...link,
    accountStatus: 'not_started',
  });
  assert.deepEqual(calls, [
    'reserve_stripe_connect_account',
    'record_stripe_connect_account',
    'audit_stripe_connect_link',
  ]);
  const resumed = await request();
  assert.equal(resumed.status, 200);
  assert.deepEqual(await resumed.json(), { ...link, accountStatus: 'pending' });
  assert.deepEqual(providerAttempts, [operationId]);
  assert.deepEqual(calls.slice(3), [
    'reserve_stripe_connect_account',
    'audit_stripe_connect_link',
  ]);
});

test('rejects missing Auth, callback overrides, and server-denied roles before calling Stripe', async () => {
  const { request, calls, providerAttempts } = setup({ deny: true });
  assert.equal((await request({}, '')).status, 401);
  const invalid = await request({ returnUrl: 'https://example.invalid' });
  assert.equal(invalid.status, 422);
  assert.deepEqual(await invalid.json(), {
    error: 'validation_failed',
    fields: { returnUrl: 'Unexpected field.' },
  });
  const forbidden = await request();
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: 'forbidden' });
  assert.deepEqual(calls, ['reserve_stripe_connect_account']);
  assert.deepEqual(providerAttempts, []);
});

test('Stripe outage returns a safe 502 and keeps only the durable creation intent', async () => {
  const { request, reservation, calls, errors } = setup({
    provider: {
      createAccount: async () => {
        throw new Error(suppressed);
      },
    },
  });
  const response = await request();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'stripe_unavailable' });
  assert.equal(reservation.stripeAccountId, null);
  assert.deepEqual(calls, ['reserve_stripe_connect_account']);
  assert.deepEqual(errors, [['stripe_connect.provider_unavailable']]);
});

test('lost database write after Stripe creates an account is recovered with the same idempotent operation', async () => {
  const {
    request,
    reservation,
    providerAttempts,
    issuedAccounts,
    calls,
    errors,
  } = setup({ failRecordOnce: true });
  const failed = await request();
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: 'internal_error' });
  assert.equal(reservation.stripeAccountId, null);
  assert.ok(!calls.includes('audit_stripe_connect_link'));
  assert.equal((await request()).status, 200);
  assert.deepEqual(providerAttempts, [operationId, operationId]);
  assert.equal(issuedAccounts.size, 1);
  assert.equal(reservation.stripeAccountId, account.id);
  assert.deepEqual(errors, [['stripe_connect.internal_error']]);
});

test('link outage preserves the account association and a retry skips creation', async () => {
  let linkAttempts = 0;
  const { request, reservation, providerAttempts, calls } = setup({
    provider: {
      issueLink: async () => {
        linkAttempts += 1;
        if (linkAttempts === 1) throw new Error(suppressed);
        return link;
      },
    },
  });
  assert.equal((await request()).status, 502);
  assert.equal(reservation.stripeAccountId, account.id);
  assert.ok(!calls.includes('audit_stripe_connect_link'));
  assert.equal((await request()).status, 200);
  assert.deepEqual(providerAttempts, [operationId]);
});

test('expired intent requires reconciliation and stays unchanged without a new create', async () => {
  const { request, calls, providerAttempts, reservation } = setup({
    state: { reservedAt: '2026-01-01T00:00:00Z' },
  });
  const response = await request();
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'stripe_account_reconciliation_required',
  });
  assert.deepEqual(calls, ['reserve_stripe_connect_account']);
  assert.deepEqual(providerAttempts, []);
  assert.equal(reservation.operationId, operationId);
});

test('existing completed or payout-incompatible account never gets an onboarding link', async () => {
  const complete = setup({
    state: { stripeAccountId: account.id },
    provider: { enforcePayoutPolicy: async () => true },
  });
  const result = await complete.request();
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), { error: 'onboarding_complete' });
  assert.deepEqual(complete.calls, ['reserve_stripe_connect_account']);

  const incompatible = setup({
    state: { stripeAccountId: account.id },
    provider: {
      enforcePayoutPolicy: async () => {
        throw new UnsupportedStripeConfiguration(suppressed);
      },
    },
  });
  const refused = await incompatible.request();
  assert.equal(refused.status, 502);
  assert.deepEqual(await refused.json(), {
    error: 'stripe_configuration_unsupported',
  });
  assert.deepEqual(incompatible.calls, ['reserve_stripe_connect_account']);
  assert.deepEqual(incompatible.errors, [
    ['stripe_connect.unsupported_configuration'],
  ]);
});

test('rejects live keys, arbitrary insecure callback origins, and reused callback paths', () => {
  const options = {
    key: 'sk_test_SyntheticFixture',
    platformAccountId,
    returnUrl: 'http://localhost:4242/connect/return',
    refreshUrl: 'http://localhost:4242/connect/refresh',
  };
  for (const overrides of [
    { key: 'synthetic_live_credential' },
    { refreshUrl: 'http://example.invalid/connect/refresh' },
    { refreshUrl: options.returnUrl },
    { refreshUrl: 'http://localhost:4242/connect/refresh?token=secret' },
  ])
    assert.throws(
      () => createStripeConnect({ ...options, ...overrides }),
      UnsupportedStripeConfiguration,
    );
});
