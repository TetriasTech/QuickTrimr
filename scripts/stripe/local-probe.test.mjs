import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';

import Stripe from 'stripe';

import { loadVerificationConfig, parseVerificationConfig } from './config.mjs';
import { createProbe } from './local-probe.mjs';
import {
  sandboxClient,
  verifyManualCapture,
} from './verify-manual-capture.mjs';

const signer = new Stripe(null, {
  authenticator: () => Promise.reject(new Error('No network authenticator.')),
});
const config = {
  returnPath: '/connect/return',
  refreshPath: '/connect/refresh',
};

async function start(t, limits) {
  const secret = randomUUID();
  const server = createProbe({
    webhookSecret: secret,
    config,
    ...(limits ? { limits } : {}),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signed = async (event, overrides = {}) => {
    const body = JSON.stringify(event);
    const header = signer.webhooks.generateTestHeaderString({
      payload: body,
      secret,
      ...overrides,
    });
    return fetch(`${origin}/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': header },
      body,
    });
  };
  return { origin, signed, server, secret };
}

function event(id = 'evt_localtest') {
  return {
    object: 'event',
    id,
    type: 'payment_intent.succeeded',
    livemode: false,
    data: { object: { sensitiveFixture: 'must-not-be-returned' } },
  };
}

test('probe binds loopback and callbacks never imply onboarding success or reflect query data', async (t) => {
  const { origin, server } = await start(t);
  assert.equal(server.address().address, '127.0.0.1');
  for (const [path, callback] of [
    [config.returnPath, 'return'],
    [config.refreshPath, 'refresh'],
  ]) {
    const response = await fetch(`${origin}${path}?token=do-not-reflect`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.callback, callback);
    assert.equal(body.onboardingVerified, false);
    assert.equal(JSON.stringify(body).includes('do-not-reflect'), false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('signed sandbox delivery records only event metadata; real parallel duplicates have one winner', async (t) => {
  const { origin, signed } = await start(t);
  for (let round = 0; round < 3; round++) {
    const responses = await Promise.all(
      Array.from({ length: 16 }, () => signed(event(`evt_parallel_${round}`))),
    );
    assert.ok(responses.every((response) => response.status === 200));
    const bodies = await Promise.all(
      responses.map((response) => response.json()),
    );
    assert.equal(bodies.filter((body) => body.duplicate === false).length, 1);
    assert.equal(bodies.filter((body) => body.duplicate === true).length, 15);
  }
  const evidence = await (await fetch(`${origin}/evidence`)).json();
  assert.equal(evidence.uniqueEvents, 3);
  assert.equal(evidence.duplicateDeliveries, 45);
  assert.deepEqual(
    evidence.events,
    Array.from({ length: 3 }, (_, round) => ({
      id: `evt_parallel_${round}`,
      type: 'payment_intent.succeeded',
    })),
  );
  assert.equal(evidence.businessEffects, false);
  assert.equal(evidence.durable, false);
  assert.equal(
    JSON.stringify(evidence).includes('must-not-be-returned'),
    false,
  );
});

test('unsigned, bad-signature and expired deliveries are rejected before recording', async (t) => {
  const { origin, signed } = await start(t);
  const unsigned = await fetch(`${origin}/stripe/webhook`, {
    method: 'POST',
    body: JSON.stringify(event()),
  });
  assert.equal(unsigned.status, 400);
  assert.equal(
    (await signed(event(), { secret: 'wrong-test-secret' })).status,
    400,
  );
  assert.equal((await signed(event(), { timestamp: 1 })).status, 400);
  assert.equal(
    (await (await fetch(`${origin}/evidence`)).json()).uniqueEvents,
    0,
  );
});

test('signature covers exact raw bytes, including whitespace', async (t) => {
  const { origin, secret } = await start(t);
  const body = JSON.stringify(event());
  const header = signer.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  });
  const response = await fetch(`${origin}/stripe/webhook`, {
    method: 'POST',
    body: `${body} `,
    headers: { 'stripe-signature': header },
  });
  assert.equal(response.status, 400);
});

test('validly signed live events and malformed events cannot enter sandbox evidence', async (t) => {
  const { origin, signed } = await start(t);
  assert.equal((await signed({ ...event(), livemode: true })).status, 403);
  assert.equal((await signed({ ...event(), livemode: undefined })).status, 403);
  assert.equal((await signed({ ...event(), id: undefined })).status, 400);
  assert.equal((await signed(null)).status, 400);
  assert.equal(
    (await (await fetch(`${origin}/evidence`)).json()).uniqueEvents,
    0,
  );
});

test('capacity rejects new events without evicting prior deduplication evidence', async (t) => {
  const { origin, signed } = await start(t, {
    maxBodyBytes: 2048,
    maxEvents: 1,
  });
  assert.equal((await signed(event('evt_first'))).status, 200);
  assert.equal((await signed(event('evt_second'))).status, 503);
  const repeat = await signed(event('evt_first'));
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).duplicate, true);
  assert.equal(
    (await (await fetch(`${origin}/evidence`)).json()).uniqueEvents,
    1,
  );
});

test('oversized bodies, unsupported methods and unknown paths fail closed', async (t) => {
  const { origin } = await start(t, { maxBodyBytes: 32, maxEvents: 1 });
  assert.equal(
    (
      await fetch(`${origin}/stripe/webhook`, {
        method: 'POST',
        body: 'x'.repeat(64),
      })
    ).status,
    413,
  );
  assert.equal((await fetch(`${origin}/stripe/webhook`)).status, 405);
  assert.equal((await fetch(`${origin}/not-a-route`)).status, 404);
});

test('probe requires a signing secret without echoing a supplied value', () => {
  assert.throws(
    () => createProbe({ config }),
    /STRIPE_WEBHOOK_SECRET is required/,
  );
});

test('verification config reads approved local callbacks and both pending windows from the KB', async () => {
  const actual = await loadVerificationConfig();
  assert.deepEqual(actual, {
    port: 4242,
    ...config,
    pendingWindowSeconds: 7200,
  });
  const markdown = [
    '| `CFG-DEV-PROVIDER-URLS` | `{"stripeReturnUrl":"https://example.invalid/return","stripeRefreshUrl":"https://example.invalid/refresh"}` | test |',
    '| `CFG-AVAIL-EXPIRY-MIN` | `5` | test |',
    '| `CFG-SCHED-EXPIRY-HOURS` | `2` | test |',
  ].join('\n');
  assert.throws(() => parseVerificationConfig(markdown), /local HTTP/);
});

test('live/missing keys fail before constructing a Stripe client', async () => {
  let constructed = false;
  const factory = () => {
    constructed = true;
    throw new Error('must not construct');
  };
  for (const key of [
    undefined,
    ['sk', 'live', 'fixture'].join('_'),
    'not-a-key',
  ])
    await assert.rejects(
      sandboxClient({ key, accountId: 'acct_fixture', factory }),
      /sandbox\/test credential/,
    );
  assert.equal(constructed, false);
});

test('wrong account or non-Australian/non-AUD credentials fail before money calls', async () => {
  for (const account of [
    { id: 'acct_other', country: 'AU', default_currency: 'aud' },
    { id: 'acct_fixture', country: 'US', default_currency: 'usd' },
  ])
    await assert.rejects(
      sandboxClient({
        key: ['rk', 'test', 'fixture'].join('_'),
        accountId: 'acct_fixture',
        factory: () => ({ accounts: { retrieve: async () => account } }),
      }),
      /does not match/,
    );
});

test('manual-capture verifier rejects a hold shorter than the configured pending window before capture', async () => {
  let captured = false;
  const intent = {
    id: 'pi_fixture',
    livemode: false,
    status: 'requires_capture',
    amount: 4500,
    currency: 'aud',
    amount_capturable: 4500,
    latest_charge: {
      id: 'ch_fixture',
      created: 1,
      payment_method_details: { card: { capture_before: 2 } },
    },
  };
  const stripe = {
    paymentIntents: {
      create: async () => intent,
      capture: async () => {
        captured = true;
      },
    },
  };
  await assert.rejects(
    verifyManualCapture(stripe, {
      accountId: 'acct_fixture',
      pendingWindowSeconds: 7200,
    }),
  );
  assert.equal(captured, false);
});

test('capture verifier reuses deterministic keys and emits only selected evidence fields (fake provider)', async () => {
  const created = {
    id: 'pi_fixture',
    livemode: false,
    status: 'requires_capture',
    amount: 4500,
    currency: 'aud',
    amount_capturable: 4500,
    latest_charge: {
      id: 'ch_fixture',
      created: 100,
      payment_method_details: { card: { capture_before: 10000 } },
    },
    client_secret: 'never-return-fixture',
  };
  const captured = {
    id: created.id,
    livemode: false,
    status: 'succeeded',
    amount_received: 4500,
    currency: 'aud',
    latest_charge: 'ch_fixture',
    client_secret: 'never-return-fixture',
  };
  const creates = [];
  const captures = [];
  const stripe = {
    paymentIntents: {
      create: async (parameters, options) => {
        creates.push({ parameters, options });
        return created;
      },
      capture: async (...args) => {
        captures.push(args);
        return captured;
      },
      retrieve: async () => ({
        ...captured,
        latest_charge: {
          id: 'ch_fixture',
          captured: true,
          amount_refunded: 0,
          amount: 4500,
          currency: 'aud',
          livemode: false,
        },
      }),
    },
  };
  const evidence = await verifyManualCapture(stripe, {
    accountId: 'acct_fixture',
    pendingWindowSeconds: 7200,
  });
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0], creates[1]);
  assert.equal(captures.length, 2);
  assert.deepEqual(captures[0], captures[1]);
  assert.equal(evidence.duplicateCaptureSameCharge, true);
  assert.equal(evidence.chargeId, 'ch_fixture');
  assert.equal(
    JSON.stringify(evidence).includes('never-return-fixture'),
    false,
  );
});

test('CLI credential failures do not print key values or provider payloads', () => {
  const sentinel = ['sk', 'live', 'DO_NOT_LOG_THIS_FIXTURE'].join('_');
  const run = spawnSync(
    process.execPath,
    ['scripts/stripe/verify-manual-capture.mjs', '--account', 'acct_fixture'],
    {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, STRIPE_SECRET_KEY: sentinel },
    },
  );
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr.includes(sentinel), false);
  assert.match(run.stderr, /^Sandbox capture verification failed\./);
});

test('onboarding captures containing test phone fields stay excluded from version control', () => {
  for (const name of [
    'P0-T18-hosted-onboarding-start.jpg',
    'P0-T18-hosted-onboarding-stalled.jpg',
  ]) {
    const run = spawnSync(
      'git',
      [
        'check-ignore',
        '--quiet',
        '--no-index',
        '--',
        `docs/qa/evidence/${name}`,
      ],
      { cwd: new URL('../..', import.meta.url), encoding: 'utf8' },
    );
    assert.equal(run.status, 0, 'Phone-field capture must be ignored.');
  }
});
