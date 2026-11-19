import assert from 'node:assert/strict';
import test from 'node:test';

import { createAvailableNowHandler } from '../handler.ts';
const owner = '60499711-52d4-46c7-beb1-6d2c46937ed5';
const id = '8f293ef1-2954-463d-89bd-48ab1f2b7d15';
const point = {
  lat: -37.8,
  lng: 144.9,
  locationSource: 'gps',
  radiusKm: 8,
  availableUntil: '2026-11-20T15:00:00Z',
};
const inputs = {
  start: point,
  update: { ...point, sessionId: id },
  stop: { sessionId: id },
};
function fixture(
  operation,
  { role = 'barber', authStatus = 200, rpcStatus = 200, rpcBody } = {},
) {
  const calls = [],
    logs = [];
  const expected =
    operation === 'stop'
      ? { id, status: 'manually_disabled' }
      : {
          id,
          status: 'active',
          radiusKm: 8,
          availableUntil: point.availableUntil,
          locationSource: 'gps',
          approximateArea: { id: 'sal:2021:example', label: 'Example' },
        };
  const handler = createAvailableNowHandler({
    operation,
    supabaseUrl: 'http://127.0.0.1:55321',
    anonKey: 'public-fixture',
    serviceRoleKey: 'private-fixture',
    log: { error: (m) => logs.push(m) },
    async fetcher(url, options) {
      const path = new URL(url).pathname;
      calls.push({ path, options });
      if (path === '/auth/v1/user')
        return Response.json(
          { id: owner, role: 'authenticated' },
          { status: authStatus },
        );
      if (path === '/rest/v1/profiles')
        return Response.json(role ? [{ role }] : []);
      assert.equal(path, '/rest/v1/rpc/manage_available_now_session');
      return Response.json(rpcBody ?? expected, { status: rpcStatus });
    },
  });
  return {
    calls,
    logs,
    expected,
    invoke: (input = inputs[operation], auth = true) =>
      handler(
        new Request('http://localhost/function', {
          method: 'POST',
          headers: auth ? { authorization: 'Bearer fixture-user' } : {},
          body: typeof input === 'string' ? input : JSON.stringify(input),
        }),
      ),
  };
}
for (const operation of ['start', 'update', 'stop']) {
  test(`${operation}: verified caller, fixed operation, safe exact response and forged fields stripped`, async () => {
    const f = fixture(operation),
      r = await f.invoke({
        ...inputs[operation],
        userId: 'forged',
        status: 'busy',
      });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), f.expected);
    assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), {
      p_user_id: owner,
      p_operation: operation,
      p_input: inputs[operation],
    });
  });
  test(`${operation}: auth and stored roles deny before parsing or privileged calls`, async () => {
    const missing = fixture(operation);
    assert.equal((await missing.invoke('{', false)).status, 401);
    assert.equal(missing.calls.length, 0);
    const invalid = fixture(operation, { authStatus: 401 });
    assert.equal((await invalid.invoke()).status, 401);
    assert.equal(invalid.calls.length, 1);
    for (const role of ['admin', 'client', null]) {
      const f = fixture(operation, { role });
      assert.equal((await f.invoke('{')).status, 403);
      assert.equal(f.calls.length, 2);
    }
  });
  test(`${operation}: typed RPC failures and unexpected data fail closed without leaking values`, async () => {
    for (const [status, message] of [
      [404, 'not_found'],
      [409, 'invalid_status_transition'],
      [409, 'barber_unavailable'],
      [403, 'onboarding_incomplete'],
    ]) {
      const f = fixture(operation, {
          rpcStatus: status,
          rpcBody: { message, details: 'sensitive-fixture' },
        }),
        r = await f.invoke();
      assert.equal(r.status, status);
      assert.deepEqual(await r.json(), { error: message });
    }
    for (const [status, body] of [
      [200, { ...fixture(operation).expected, location: 'private-fixture' }],
      [500, { message: 'sensitive-fixture' }],
      [
        422,
        {
          message: 'validation_failed',
          details: '{"secret":"sensitive-fixture"}',
        },
      ],
    ]) {
      const f = fixture(operation, { rpcStatus: status, rpcBody: body }),
        r = await f.invoke();
      assert.equal(r.status, 500);
      assert.deepEqual(await r.json(), { error: 'internal_error' });
      assert.deepEqual(f.logs, ['available_now_request_failed']);
    }
  });
}
test('structural field errors, malformed JSON and crafted area are rejected before RPC', async () => {
  for (const [input, field] of [
    [{ ...point, lat: 91 }, 'lat'],
    [{ ...point, locationSource: 'tracking' }, 'locationSource'],
    [{ ...point, radiusKm: 0 }, 'radiusKm'],
    [{ ...point, publicAreaId: 'forged' }, '_request'],
  ]) {
    const f = fixture('start'),
      r = await f.invoke(input);
    assert.equal(r.status, 422);
    assert.ok((await r.json()).fields[field]);
    assert.equal(f.calls.length, 2);
  }
  const f = fixture('stop');
  assert.equal((await f.invoke('{')).status, 422);
});
test('database-configured bounds return field errors, never SQL details', async () => {
  const fields = {
    radiusKm: 'Enter a radius between 1 and 50 km.',
    availableUntil: 'Must be in the future and within 12 hours.',
  };
  const f = fixture('start', {
      rpcStatus: 422,
      rpcBody: {
        message: 'validation_failed',
        details: JSON.stringify(fields),
      },
    }),
    r = await f.invoke();
  assert.equal(r.status, 422);
  assert.deepEqual(await r.json(), { error: 'validation_failed', fields });
});
