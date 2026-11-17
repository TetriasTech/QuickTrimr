// P1-T09. Actual local Edge endpoints + Stripe sandbox + official CLI delivery.
// Secrets, raw events, account links and Auth bodies stay in process memory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import Stripe from 'stripe';

import { connectEventTypes } from '../../supabase/functions/stripe-webhook/handler.ts';

import { apiJson, assertRawBody, makeUsers } from './api-test-helpers.mjs';
import { localStatus } from './local-api.mjs';
import { root } from './local.mjs';
import { queryLocal } from './verify.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const local = localStatus();
const key = process.env.STRIPE_SECRET_KEY;
const platform = process.env.STRIPE_CONNECT_SANDBOX_ACCOUNT_ID;
const cli = process.argv[2];
assert.ok(
  /^\/(?:[^\0\n]+)\/stripe$/.test(cli ?? ''),
  'Pass the absolute official Stripe CLI binary path.',
);
assert.ok(
  /^(sk|rk)_test_[A-Za-z0-9]+$/.test(key ?? ''),
  'A sandbox test key is required.',
);
assert.ok(
  /^acct_[A-Za-z0-9]+$/.test(platform ?? ''),
  'The sandbox account ID is required.',
);
const stripe = new Stripe(key, { telemetry: false, timeout: 10_000 });
const endpoint = '/functions/v1/stripe-webhook';
const refreshPath = '/functions/v1/refresh-stripe-connect-status';
const post = (path, token, input) =>
  apiJson(local, path, token, {
    method: 'POST',
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(45_000),
  });
const sql = (text) => JSON.parse(queryLocal(text));
const selectMapping = (id) =>
  sql(`select json_build_object(
  'account', stripe_account_id, 'operation', operation_id, 'status', account_status,
  'charges', charges_enabled, 'payouts', payouts_enabled, 'submitted', details_submitted)
  from private.stripe_connect_accounts where barber_id='${id}'::uuid;`);
let listener, edge, bridge, temp, signingSecret;
const captured = new Map();
const watched = new Set();
const durations = [];
async function deliver(raw, signature) {
  const start = performance.now();
  const result = await fetch(new URL(endpoint, local.API_URL), {
    method: 'POST',
    headers: {
      'stripe-signature': signature,
      'content-type': 'application/json',
    },
    body: raw,
    signal: AbortSignal.timeout(10_000),
  });
  const body = await result.json();
  durations.push(performance.now() - start);
  return { status: result.status, body };
}
async function waitFor(check, message, ms = 30_000) {
  const start = performance.now();
  while (performance.now() - start < ms) {
    const result = await check();
    if (result) return result;
    await sleep(200);
  }
  throw new Error(message);
}
async function shutdown(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGINT');
  await Promise.race([
    once(child, 'exit').catch(() => undefined),
    sleep(5_000),
  ]);
  if (child.exitCode === null) child.kill('SIGTERM');
}
async function main() {
  assert.equal(
    (await stripe.accounts.retrieveCurrent()).id,
    platform,
    'Key matches configured customer sandbox.',
  );
  bridge = createServer(async (req, res) => {
    try {
      const parts = [];
      let bytes = 0;
      for await (const part of req) {
        bytes += part.length;
        if (bytes > 1024 * 1024) {
          res.writeHead(413).end();
          return;
        }
        parts.push(part);
      }
      const raw = Buffer.concat(parts);
      const signature = req.headers['stripe-signature'];
      stripe.webhooks.signature.verifyHeader(raw, signature, signingSecret);
      const event = JSON.parse(raw.toString('utf8'));
      const account = event.related_object?.id ?? event.data?.object?.id;
      const firstDeliveries = watched.has(account)
        ? await Promise.all(
            Array.from({ length: 6 }, () => deliver(raw, signature)),
          )
        : [await deliver(raw, signature)];
      const result =
        firstDeliveries.find(
          (response) => response.status === 200 && !response.body.duplicate,
        ) ?? firstDeliveries[0];
      if (watched.has(account) && connectEventTypes.includes(event.type))
        captured.set(account, { raw, signature, event, result });
      res
        .writeHead(result.status, { 'content-type': 'application/json' })
        .end(JSON.stringify(result.body));
    } catch {
      res.writeHead(500).end();
    }
  });
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  listener = spawn(
    cli,
    [
      'listen',
      '--events',
      connectEventTypes.filter((type) => type !== 'account.updated').join(','),
      '--events-from',
      'all',
      '--forward-to',
      `http://127.0.0.1:${bridge.address().port}/stripe`,
      '--skip-update',
    ],
    {
      env: { ...process.env, STRIPE_API_KEY: key },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let listenerOutput = '';
  const consume = (chunk) => {
    // CLI output can contain a signing secret and event bodies. Never print it.
    listenerOutput += chunk.toString();
    signingSecret ??= listenerOutput.match(/whsec_[A-Za-z0-9]+/)?.[0];
    if (listenerOutput.length > 16_384)
      listenerOutput = listenerOutput.slice(-8192);
  };
  listener.stdout.on('data', consume);
  listener.stderr.on('data', consume);
  await waitFor(
    () => signingSecret,
    'Stripe CLI did not establish the sandbox listener.',
  );
  temp = await mkdtemp(join(tmpdir(), 'quicktrimr-connect-status-'));
  const original = await readFile(resolve(root, 'supabase/.env.local'), 'utf8');
  const runtimeEnv =
    original.replace(/^STRIPE_(?:CONNECT_)?WEBHOOK_SECRET=.*$/gm, '') +
    `\nSTRIPE_WEBHOOK_SECRET=${signingSecret}\nSTRIPE_CONNECT_WEBHOOK_SECRET=${signingSecret}\n`;
  const envFile = join(temp, 'sandbox.env');
  await writeFile(envFile, runtimeEnv, { mode: 0o600 });
  edge = spawn(
    resolve(root, 'node_modules/.bin/supabase'),
    ['functions', 'serve', '--env-file', envFile],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  // Drain without exposing runtime logs or local runtime credentials.
  edge.stdout.on('data', () => undefined);
  edge.stderr.on('data', () => undefined);
  await waitFor(async () => {
    try {
      return (
        (
          await fetch(new URL(endpoint, local.API_URL), {
            method: 'POST',
            signal: AbortSignal.timeout(1500),
          })
        ).status === 400
      );
    } catch {
      return false;
    }
  }, 'Local signature handler did not become ready.');

  const { users, tokens } = await makeUsers(local, {
    additional: ['admin'],
    adversarialMetadata: true,
  });
  for (const [user, role] of [
    ['barberA', 'barber'],
    ['barberB', 'barber'],
    ['clientA', 'client'],
  ])
    assert.equal(
      (
        await post('/functions/v1/create-or-sync-profile', tokens[user], {
          role,
        })
      ).status,
      200,
    );
  queryLocal(
    `insert into public.profiles (id,role,verification_status) values ('${users.admin}'::uuid,'admin','not_started');`,
  );
  assert.equal((await post(refreshPath, undefined, {})).status, 401);
  for (const user of ['clientA', 'admin'])
    assertRawBody(
      await post(refreshPath, tokens[user], {}),
      {
        status: 403,
        body: { error: 'forbidden' },
      },
      'Server role rejection',
    );
  assertRawBody(
    await post(refreshPath, tokens.barberA, {}),
    {
      status: 200,
      body: {
        accountStatus: 'not_started',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      },
    },
    'Unlinked barber projection',
  );
  assert.equal(
    (await post(refreshPath, tokens.barberA, { accountId: 'acct_Foreign' }))
      .status,
    422,
  );

  for (const user of ['barberA', 'barberB']) {
    const created = await post(
      '/functions/v1/create-stripe-connect-onboarding-link',
      tokens[user],
      {},
    );
    assert.equal(created.status, 200, 'Synthetic sandbox account creation.');
    const id = users[user];
    const mapping = selectMapping(id);
    assert.ok(/^acct_[A-Za-z0-9]+$/.test(mapping.account));
    const initial = await waitFor(async () => {
      const result = await post(refreshPath, tokens[user], {
        userId: users.clientA,
      });
      return result.status === 409 ? undefined : result;
    }, 'Local signature handler could not finish the initial refresh.');
    assert.equal(
      initial.status,
      200,
      `Initial provider refresh returned ${initial.status}.`,
    );
    assertRawBody(
      initial,
      {
        status: 200,
        body: {
          accountStatus: 'pending',
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
        },
      },
      'Fresh provider account is incomplete',
    );
    const auditBefore = Number(
      queryLocal(`select count(*) from public.audit_logs
      where entity_id='${id}'::uuid and action='stripe.connect_status_changed';`),
    );
    assert.equal((await post(refreshPath, tokens[user], {})).status, 200);
    assert.equal(
      Number(
        queryLocal(`select count(*) from public.audit_logs where entity_id='${id}'::uuid
      and action='stripe.connect_status_changed';`),
      ),
      auditBefore,
      'Unchanged refresh writes no transition audit.',
    );

    // Model previously eligible local data using only service-only fixture RPCs.
    // The actual Stripe account is restricted throughout; no provider flags are forged.
    const reserved = await post(
      '/rest/v1/rpc/begin_stripe_connect_refresh',
      local.SERVICE_ROLE_KEY,
      {
        p_platform: platform,
        p_user_id: id,
      },
    );
    assert.ok(reserved.body.token);
    assert.equal(
      (
        await post(
          '/rest/v1/rpc/finish_stripe_connect_refresh',
          local.SERVICE_ROLE_KEY,
          {
            p_platform: platform,
            p_account_id: mapping.account,
            p_token: reserved.body.token,
            p_state: {
              accountStatus: 'verified',
              chargesEnabled: true,
              payoutsEnabled: true,
              detailsSubmitted: true,
            },
          },
        )
      ).status,
      200,
    );
    assert.equal(
      Number(
        queryLocal(
          `select count(*) from private.connect_eligible_barbers where barber_id='${id}'::uuid;`,
        ),
      ),
      1,
    );
    const before = Number(
      queryLocal(
        `select count(*) from private.stripe_webhook_events where stripe_account_id='${mapping.account}';`,
      ),
    );
    captured.delete(mapping.account);
    watched.add(mapping.account);

    await stripe.v2.core.accounts.update(
      mapping.account,
      {
        metadata: { quicktrimr_status_verification: mapping.operation },
      },
      { idempotencyKey: `quicktrimr:status-verification:${mapping.operation}` },
    );
    const received = await waitFor(() => {
      const receipt = captured.get(mapping.account);
      return receipt?.result.status === 200 ? receipt : undefined;
    }, 'Real signed connected-account event was not committed.');
    assert.ok(
      received.event.livemode === false,
      'Actual event is sandbox-only.',
    );
    const actualEvent = await stripe.v2.core.events.retrieve(received.event.id);
    assert.ok(
      actualEvent.id === received.event.id &&
        actualEvent.related_object?.id === mapping.account,
      'Actual provider event corroborates notification.',
    );
    assert.equal(selectMapping(id).status, 'requires_review');
    assert.equal(selectMapping(id).charges, false);
    assert.equal(selectMapping(id).payouts, false);
    assert.equal(
      Number(
        queryLocal(
          `select count(*) from private.connect_eligible_barbers where barber_id='${id}'::uuid;`,
        ),
      ),
      0,
    );

    const audit = await apiJson(
      local,
      `/rest/v1/audit_logs?entity_id=eq.${id}&action=eq.stripe.connect_status_changed&select=actor_id,actor_role,previous_value,new_value,metadata`,
      local.SERVICE_ROLE_KEY,
    );
    const transition = audit.body.find(
      (row) =>
        row.previous_value?.accountStatus === 'verified' &&
        row.new_value?.accountStatus === 'requires_review',
    );
    assert.ok(
      transition?.actor_id === null &&
        transition.actor_role === null &&
        transition.metadata.actionRequired === true,
      'System attribution and restricted transition signal.',
    );
    const expected = selectMapping(id);
    const auditCount = audit.body.length;
    for (let batch = 0; batch < 3; batch++) {
      const replays = await Promise.all(
        Array.from({ length: 12 }, () =>
          deliver(received.raw, received.signature),
        ),
      );
      for (const replay of replays)
        assertRawBody(
          replay,
          { status: 200, body: { received: true, duplicate: true } },
          'Concurrent signed replay',
        );
    }
    assertRawBody(
      selectMapping(id),
      expected,
      'Duplicate delivery preserves provider facts',
    );
    assert.equal(
      Number(
        queryLocal(
          `select count(*) from private.stripe_webhook_events where stripe_account_id='${mapping.account}';`,
        ),
      ),
      before + 1,
    );
    assert.equal(
      Number(
        queryLocal(
          `select count(*) from public.audit_logs where entity_id='${id}'::uuid and action='stripe.connect_status_changed';`,
        ),
      ),
      auditCount,
    );

    const bad = await deliver(
      Buffer.concat([received.raw, Buffer.from(' ')]),
      received.signature,
    );
    assertRawBody(
      bad,
      { status: 400, body: { error: 'invalid_signature' } },
      'Tampered real notification',
    );
    assert.equal(
      Number(
        queryLocal(
          `select count(*) from private.stripe_webhook_events where stripe_account_id='${mapping.account}';`,
        ),
      ),
      before + 1,
    );
  }

  for (const table of [
    'stripe_connect_accounts',
    'stripe_webhook_events',
    'connect_eligible_barbers',
  ])
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const denied = await apiJson(local, `/rest/v1/${table}`, tokens.barberB, {
        method,
        headers: {
          [method === 'GET' ? 'Accept-Profile' : 'Content-Profile']: 'private',
        },
        ...(['POST', 'PATCH'].includes(method) ? { body: '{}' } : {}),
      });
      assert.ok(
        [401, 403, 404, 406].includes(denied.status),
        'Private state and eligibility API denial.',
      );
    }
  for (const [rpc, body] of [
    [
      'begin_stripe_connect_refresh',
      { p_platform: platform, p_user_id: users.barberA },
    ],
    [
      'finish_stripe_connect_refresh',
      {
        p_platform: platform,
        p_account_id: 'acct_Test',
        p_token: users.barberA,
        p_state: {},
      },
    ],
    [
      'release_stripe_connect_refresh',
      {
        p_platform: platform,
        p_account_id: 'acct_Test',
        p_token: users.barberA,
      },
    ],
  ])
    assert.ok(
      [401, 403, 404].includes(
        (await post('/rest/v1/rpc/' + rpc, tokens.barberB, body)).status,
      ),
      'Cross-user service RPC denial.',
    );

  const rls = queryLocal(
    "select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('stripe_connect_accounts','stripe_webhook_events');",
  );
  assert.equal(rls, 't');
  assert.ok(
    Math.max(...durations) < 10_000,
    'Every webhook acknowledgement stayed inside the request timeout.',
  );
  console.log(
    JSON.stringify({
      result: 'PASS',
      actualSignedEvents: 2,
      concurrentFirstDeliveries: 12,
      concurrentReplays: 72,
      duplicateEffects: 0,
      restrictedBarbersExcluded: 2,
      maxAcknowledgementMs: Math.ceil(Math.max(...durations)),
      roleAndCrossUserApiDenial: true,
      unlinkedAndPendingVerified: true,
    }),
  );
}
try {
  await main();
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : error instanceof Error &&
          /^(Real signed|Stripe CLI|Local signature)/.test(error.message)
        ? error.message
        : 'Connect verification failed. Sensitive provider and runtime fields suppressed.',
  );
  process.exitCode = 1;
} finally {
  watched.clear();
  captured.clear();
  await shutdown(listener);
  await shutdown(edge);
  if (bridge) await new Promise((resolve) => bridge.close(resolve));
  signingSecret = undefined;
  if (temp) await rm(temp, { recursive: true, force: true });
}
