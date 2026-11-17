// End-to-end check of the actual Edge route against local Supabase and the
// configured Stripe sandbox. Only synthetic accounts are created. Never print
// Auth tokens, Stripe bodies, account-link URLs or clipboard values.
import assert from 'node:assert/strict';

import Stripe from 'stripe';

import { apiJson, assertRawBody, makeUsers } from './api-test-helpers.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal } from './verify.mjs';

async function verify() {
  const key = process.env.STRIPE_SECRET_KEY;
  const platformId = process.env.STRIPE_CONNECT_SANDBOX_ACCOUNT_ID;
  assert.ok(
    /^(sk|rk)_test_[A-Za-z0-9]+$/.test(key ?? ''),
    'Sandbox Stripe key required.',
  );
  assert.ok(
    /^acct_[A-Za-z0-9]+$/.test(platformId ?? ''),
    'Sandbox account ID required.',
  );
  const stripe = new Stripe(key, { maxNetworkRetries: 2, telemetry: false });
  assert.ok(
    (await stripe.accounts.retrieveCurrent()).id === platformId,
    'Stripe key does not match the specified sandbox.',
  );

  const status = localStatus();
  const { users, tokens } = await makeUsers(status, {
    additional: ['admin'],
    adversarialMetadata: true,
  });
  const post = (path, token, body) =>
    apiJson(status, path, token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  const endpoint = '/functions/v1/create-stripe-connect-onboarding-link';
  const onboard = (user, body = {}) =>
    apiJson(status, endpoint, tokens[user], {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  const reservation = (id) =>
    JSON.parse(
      queryLocal(`
    select coalesce(json_agg(json_build_object('id', stripe_account_id, 'operation', operation_id)), '[]')
    from private.stripe_connect_accounts where barber_id = '${id}'::uuid;
  `),
    );

  for (const [name, role] of [
    ['barberA', 'barber'],
    ['barberB', 'barber'],
    ['clientA', 'client'],
  ])
    assert.equal(
      (
        await post('/functions/v1/create-or-sync-profile', tokens[name], {
          role,
        })
      ).status,
      200,
    );
  queryLocal(`insert into public.profiles (id, role, verification_status)
    values ('${users.admin}'::uuid, 'admin', 'not_started');`);

  assert.equal((await post(endpoint, undefined, {})).status, 401);
  for (const name of ['clientA', 'admin']) {
    assertRawBody(
      await onboard(name),
      { status: 403, body: { error: 'forbidden' } },
      'Role denial',
    );
    assert.equal(
      reservation(users[name]).length,
      0,
      'Role denial left no account reservation.',
    );
  }
  const invalid = await onboard('barberA', {
    returnUrl: 'https://example.invalid/',
  });
  assert.equal(invalid.status, 422);
  assert.ok(
    invalid.body.fields?.returnUrl,
    'Callback override must be rejected.',
  );
  assert.equal(
    reservation(users.barberA).length,
    0,
    'Invalid body left no account reservation.',
  );

  // Check private state and every service-only RPC using a different barber's JWT.
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const rejected = await apiJson(
      status,
      '/rest/v1/stripe_connect_accounts',
      tokens.barberB,
      {
        method,
        headers: {
          [method === 'GET' ? 'Accept-Profile' : 'Content-Profile']: 'private',
        },
        ...(['POST', 'PATCH'].includes(method) ? { body: '{}' } : {}),
      },
    );
    assert.ok(
      [401, 403, 404, 406].includes(rejected.status),
      'Private Connect state is API-inaccessible.',
    );
  }
  const rpcInputs = [
    [
      'reserve_stripe_connect_account',
      { p_user_id: users.barberA, p_platform: platformId },
    ],
    [
      'record_stripe_connect_account',
      {
        p_user_id: users.barberA,
        p_operation_id: users.barberB,
        p_account_id: 'acct_SyntheticFixture',
      },
    ],
    [
      'audit_stripe_connect_link',
      { p_user_id: users.barberA, p_account_id: 'acct_SyntheticFixture' },
    ],
  ];
  for (const [rpc, input] of rpcInputs)
    assert.ok(
      [401, 403, 404].includes(
        (await post(`/rest/v1/rpc/${rpc}`, tokens.barberB, input)).status,
      ),
      'Connect RPC denies authenticated callers.',
    );

  const selected = [];
  const expectedLinks = 5;
  for (const name of ['barberA', 'barberB']) {
    const attempts = await Promise.all(
      Array.from({ length: expectedLinks - 1 }, () =>
        onboard(name, { userId: users.clientA, idempotencyKey: 'untrusted' }),
      ),
    );
    const checkLink = ({ status: httpStatus, body }) => {
      assert.equal(
        httpStatus,
        200,
        `Onboarding response (${['stripe_unavailable', 'stripe_configuration_unsupported', 'internal_error'].includes(body?.error) ? body.error : 'safe error details suppressed'}).`,
      );
      assertRawBody(
        Object.keys(body).sort(),
        ['accountStatus', 'expiresAt', 'onboardingUrl'],
        'Link payload keys',
      );
      const url = new URL(body.onboardingUrl);
      assert.ok(
        url.protocol === 'https:' &&
          ['connect.stripe.com', 'accounts.stripe.com'].includes(url.hostname),
        'Stripe-hosted onboarding origin.',
      );
      assert.ok(
        Date.parse(body.expiresAt) > Date.now(),
        'Link expires in the future.',
      );
      return body.onboardingUrl;
    };
    const initialLinks = attempts.map(checkLink);
    assert.equal(
      new Set(initialLinks).size,
      expectedLinks - 1,
      'Parallel responses issue distinct single-use links.',
    );
    const [stored, ...otherRows] = reservation(users[name]);
    assert.ok(
      stored?.id && otherRows.length === 0,
      'Exactly one private account is saved before success.',
    );

    // Simulate drift after a successful call, on only the new disposable fixture.
    await stripe.balanceSettings.update(
      { payments: { payouts: { schedule: { interval: 'daily' } } } },
      { stripeAccount: stored.id },
    );
    const repeat = await onboard(name);
    const hostedLink = checkLink(repeat);
    assert.equal(repeat.body.accountStatus, 'pending');
    assert.ok(
      !initialLinks.includes(hostedLink),
      'Resumed onboarding has a fresh link.',
    );
    assertRawBody(
      reservation(users[name]),
      [stored],
      'Repeated call reused the same durable identity',
    );

    const options = { stripeAccount: stored.id };
    const [actual, payout] = await Promise.all([
      stripe.v2.core.accounts.retrieve(stored.id, { include: ['defaults'] }),
      stripe.balanceSettings.retrieve({}, options),
    ]);
    assert.ok(
      actual.metadata?.quicktrimr_connect_operation === stored.operation &&
        actual.livemode === false,
      'Stripe account belongs to the recorded test intent.',
    );
    assert.equal(actual.dashboard, 'express');
    assert.equal(
      actual.defaults?.responsibilities?.fees_collector,
      'application',
    );
    assert.equal(
      actual.defaults?.responsibilities?.losses_collector,
      'application',
    );
    assert.equal(
      payout.payments?.payouts?.schedule?.interval,
      'manual',
      'Reusing the account repairs its payout schedule.',
    );
    const hosted = await fetch(hostedLink, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(
      (hosted.ok &&
        hosted.headers.get('content-type')?.includes('text/html')) ||
        ([301, 302, 303, 307, 308].includes(hosted.status) &&
          ['connect.stripe.com', 'accounts.stripe.com'].includes(
            new URL(hosted.headers.get('location'), hostedLink).hostname,
          )),
      'Stripe serves or redirects the returned hosted link.',
    );
    await hosted.body?.cancel();

    const audit = await apiJson(
      status,
      `/rest/v1/audit_logs?entity_id=eq.${users[name]}&action=like.stripe.*&select=action,actor_role,previous_value,new_value,metadata`,
      status.SERVICE_ROLE_KEY,
    );
    assert.equal(audit.status, 200);
    assert.equal(
      audit.body.filter(
        (row) => row.action === 'stripe.connect_account_created',
      ).length,
      1,
    );
    assert.equal(
      audit.body.filter(
        (row) => row.action === 'stripe.connect_onboarding_link_issued',
      ).length,
      expectedLinks,
    );
    assert.ok(
      audit.body.every(
        (row) =>
          row.actor_role === 'barber' &&
          [row.previous_value, row.new_value, row.metadata].every(
            (v) => v === null,
          ),
      ),
      'Audit records contain only attribution and action.',
    );
    selected.push(stored);
  }

  const expected = new Map(
    selected.map(({ operation, id }) => [operation, id]),
  );
  const matches = new Map(selected.map(({ operation }) => [operation, []]));
  const accounts = await stripe.v2.core.accounts
    .list({ limit: 20 })
    .autoPagingToArray({ limit: 501 });
  assert.ok(accounts.length < 501, 'Sandbox account list truncated.');
  for (const account of accounts)
    matches
      .get(account.metadata?.quicktrimr_connect_operation)
      ?.push(account.id);
  for (const [operation, id] of expected)
    assertRawBody(
      matches.get(operation),
      [id],
      'Exactly one account per test intent in the actual Stripe sandbox account list',
    );
  console.log(
    'PASS: 2 rounds of 4 parallel requests plus repeat, 1 sandbox account and creation audit per intent, 5 distinct links each, hosted page, manual payout repair, and auth/role/validation/database API denial.',
  );
}

try {
  await verify();
} catch (error) {
  // Stripe SDK errors can include raw payloads and links. Assert messages are authored above.
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : 'Connect verification failed; provider and credential values suppressed.',
  );
  process.exitCode = 1;
}
