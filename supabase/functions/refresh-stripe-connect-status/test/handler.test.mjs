import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createConnectRefresher,
  ConnectProviderError,
  ConnectRefreshBusy,
  ConnectRoleError,
} from '../../_shared/stripe/refresh.ts';
import { createConnectStatusHandler } from '../handler.ts';

const userId = 'b455a1a3-dccd-489f-a352-f7352becd37b';
const token = 'fabe810e-35af-4e50-ab89-046776cdcc53';
const pending = {
  accountStatus: 'pending',
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
};
const status = {
  supabaseUrl: 'http://localhost:55321',
  serviceRoleKey: 'synthetic-service',
  platformAccountId: 'acct_SandboxFixture',
};
const request = (body = {}, authorization = 'Bearer synthetic-user') =>
  new Request('http://localhost/refresh-stripe-connect-status', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body: JSON.stringify(body),
  });
function setup(refresh = async () => ({ status: pending })) {
  const seen = [],
    errors = [];
  const handler = createConnectStatusHandler({
    ...status,
    anonKey: 'synthetic-anon',
    refresh: async (input) => {
      seen.push(input);
      return refresh(input);
    },
    fetcher: async () =>
      Response.json({
        id: userId,
        role: 'authenticated',
        user_metadata: { role: 'admin' },
      }),
    log: { error: (...args) => errors.push(args) },
  });
  return { handler, seen, errors };
}
test('verified Auth identity controls refresh and only the shared safe status envelope is returned', async () => {
  const { handler, seen } = setup();
  const response = await handler(
    request({ userId: token, status: 'verified' }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), pending);
  assert.deepEqual(seen, [{ userId }]);
});
test('missing Auth, role denials and unexpected fields are safe and cause no provider write', async () => {
  const { handler, seen } = setup();
  assert.equal((await handler(request({}, ''))).status, 401);
  const invalid = await handler(request({ accountId: 'acct_Foreign' }));
  assert.equal(invalid.status, 422);
  assert.ok((await invalid.json()).fields._request);
  assert.deepEqual(seen, []);
  const forbidden = setup(async () => {
    throw new ConnectRoleError();
  });
  assert.equal((await forbidden.handler(request())).status, 403);
});
test('busy refresh, provider and persistence failures have typed responses and safe logs', async () => {
  for (const [error, httpStatus, code] of [
    [new ConnectRefreshBusy(), 409, 'stripe_refresh_in_progress'],
    [
      new ConnectProviderError('private provider payload'),
      502,
      'stripe_unavailable',
    ],
    [new Error('private database values'), 500, 'internal_error'],
  ]) {
    const { handler, errors } = setup(async () => {
      throw error;
    });
    const result = await handler(request());
    assert.equal(result.status, httpStatus);
    assert.deepEqual(await result.json(), { error: code });
    assert.ok(!JSON.stringify(errors).includes('private'));
  }
});
test('provider failure releases the DB lease and never persists a partial status', async () => {
  const calls = [];
  const refresh = createConnectRefresher({
    ...status,
    provider: {
      read: async () => {
        throw Error('private provider fields');
      },
    },
    fetcher: async (url) => {
      calls.push(url.pathname.split('/').at(-1));
      return calls.length === 1
        ? Response.json({
            accountId: 'acct_Test',
            token,
            previouslyVerified: false,
          })
        : new Response(null, { status: 204 });
    },
  });
  await assert.rejects(refresh({ userId }), ConnectProviderError);
  assert.deepEqual(calls, [
    'begin_stripe_connect_refresh',
    'release_stripe_connect_refresh',
  ]);
});
test('unlinked, duplicate and busy claims avoid all provider requests', async () => {
  for (const state of [
    { unlinked: true },
    { duplicate: true },
    { busy: true },
  ]) {
    let providerReads = 0;
    const refresh = createConnectRefresher({
      ...status,
      provider: {
        read: async () => {
          providerReads++;
          return pending;
        },
      },
      fetcher: async () => Response.json(state),
    });
    if (state.busy)
      await assert.rejects(refresh({ userId }), ConnectRefreshBusy);
    else await refresh({ userId });
    assert.equal(providerReads, 0);
  }
});
