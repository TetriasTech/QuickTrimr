import assert from 'node:assert/strict';
import test from 'node:test';

import { createAvailabilityWorkerHandler } from '../worker-handler.ts';
const id = '60499711-52d4-46c7-beb1-6d2c46937ed5';
test('worker delegates JWT verification to the service-only RPC, denies mobile/admin, validates references and shapes safe errors', async () => {
  const calls = [],
    logs = [];
  let responseBody = { sessionId: id, applied: true, status: 'auto_disabled' };
  const handler = createAvailabilityWorkerHandler({
    supabaseUrl: 'http://127.0.0.1:55321',
    serviceRoleKey: 'server-fixture',
    log: { error: (m) => logs.push(m) },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (
        ![
          'Bearer server-fixture',
          'Bearer independently-issued-server-jwt',
        ].includes(options.headers.authorization)
      )
        return Response.json({ error: 'forbidden' }, { status: 403 });
      if (JSON.parse(options.body).p_session_id === null)
        return Response.json({ error: 'not_found' }, { status: 404 });
      return Response.json(responseBody);
    },
  });
  const call = (token, body = { sessionId: id }, method = 'POST') =>
    handler(
      new Request('http://localhost/worker', {
        method,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      }),
    );
  assert.equal((await call(null)).status, 401);
  for (const token of [
    'client-token',
    'barber-token',
    'admin-token',
    'server-fixturx',
  ])
    assert.equal((await call(token)).status, 403);
  assert.equal(calls.length, 4);
  for (const body of [
    { sessionId: 'bad' },
    { sessionId: id, misses: 2 },
    { sessionId: id, now: '2026-01-01' },
  ]) {
    const response = await call('server-fixture', body);
    assert.equal(response.status, 422);
    assert.ok((await response.json()).fields);
  }
  calls.length = 0;
  assert.equal((await call('server-fixture', undefined, 'GET')).status, 405);
  assert.deepEqual(await (await call('server-fixture')).json(), responseBody);
  assert.equal(
    new URL(calls[0].url).pathname,
    '/rest/v1/rpc/auto_disable_available_now_session',
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_session_id: id });
  assert.equal(calls[0].options.headers.authorization, 'Bearer server-fixture');
  assert.equal((await call('independently-issued-server-jwt')).status, 200);
  responseBody = { secret: 'must-not-leak' };
  assert.deepEqual(await (await call('server-fixture')).json(), {
    error: 'internal_error',
  });
  assert.deepEqual(logs, ['available_now_worker_request_failed']);
});
