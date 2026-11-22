import assert from 'node:assert/strict';
import test from 'node:test';

import { createDiscoveryFiltersHandler } from '../filters.ts';
const id = '11111111-1111-4111-8111-111111111111';
const state = {
  serverNow: '2026-11-21T00:00:00Z',
  scheduling: { minimumLeadMinutes: 240, maximumHorizonDays: 30 },
  map: { refreshIntervalMs: 2000 },
  radiusKm: { min: 1, max: 50 },
  address: null,
};
test('filter read verifies stored role before RPC, scopes identity and never forwards unexpected data/errors', async () => {
  let role = 'client',
    mode = 'ok',
    rpcCalls = 0,
    body;
  const logs = [];
  const handler = createDiscoveryFiltersHandler({
    supabaseUrl: 'http://localhost:55321',
    anonKey: 'anon',
    serviceRoleKey: 'service',
    log: { error: (m) => logs.push(m) },
    fetcher: async (url, init) => {
      if (String(url).endsWith('/auth/v1/user'))
        return Response.json({ id, role: 'authenticated' });
      if (String(url).includes('/rest/v1/profiles'))
        return Response.json([{ role }]);
      rpcCalls++;
      body = JSON.parse(init.body);
      if (mode === 'address')
        return Response.json(
          { message: 'address_unavailable' },
          { status: 422 },
        );
      if (mode === 'denied')
        return Response.json(
          { message: 'discovery_forbidden' },
          { status: 403 },
        );
      if (mode === 'bad') return Response.json({ ...state, private: 'hidden' });
      return Response.json(state);
    },
  });
  const request = (value = {}, auth = 'Bearer caller') =>
    new Request('http://localhost/get-discovery-filters', {
      method: 'POST',
      headers: auth ? { authorization: auth } : undefined,
      body: JSON.stringify(value),
    });
  assert.equal((await handler(request({}, null))).status, 401);
  for (role of ['barber', 'admin'])
    assert.equal((await handler(request())).status, 403);
  assert.equal(rpcCalls, 0);
  role = 'client';
  assert.equal((await handler(request({ addressId: 'bad' }))).status, 422);
  assert.equal(rpcCalls, 0);
  const r = await handler(request({ userId: 'forged' }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), state);
  assert.deepEqual(body, { p_client_id: id, p_address_id: null });
  mode = 'address';
  const unavailable = await handler(request({ addressId: id }));
  assert.equal(unavailable.status, 422);
  assert.deepEqual((await unavailable.json()).fields, {
    addressId: 'Choose an active saved address.',
  });
  mode = 'denied';
  assert.equal((await handler(request())).status, 403);
  mode = 'bad';
  const fail = await handler(request());
  assert.equal(fail.status, 500);
  assert.deepEqual(await fail.json(), { error: 'internal_error' });
  assert.deepEqual(logs, ['discovery.filters_unavailable']);
});
