import assert from 'node:assert/strict';
import test from 'node:test';

import { createBookingRequestHandler } from '../handler.ts';
const id = '91f09000-0000-4000-8000-000000000001';
const input = {
  bookingType: 'available_now',
  barberId: id,
  serviceCategoryId: id,
  clientAddressId: id,
};
const success = {
  id,
  status: 'pending',
  bookingType: 'available_now',
  servicePriceCents: 4503,
  commissionPct: 20,
  grossCents: 4503,
  commissionCents: 900,
  barberNetCents: 3603,
  createdAt: '2026-11-22T00:00:00Z',
  expiresAt: '2026-11-22T00:05:00Z',
};
test('request controller verifies identity/role, strips amounts, rejects malformed fields and never contacts Stripe', async () => {
  let role = 'client',
    status = 200,
    raw = success;
  const calls = [],
    logs = [];
  const handler = createBookingRequestHandler({
    supabaseUrl: 'http://127.0.0.1:55321',
    anonKey: 'anon-fixture',
    serviceRoleKey: 'server-fixture',
    log: { error: (m) => logs.push(m) },
    fetcher: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push({ path, options });
      if (path === '/auth/v1/user')
        return options.headers.authorization === 'Bearer invalid'
          ? Response.json({}, { status: 401 })
          : Response.json({ id, role: 'authenticated', is_anonymous: false });
      if (path === '/rest/v1/profiles')
        return Response.json(role ? [{ role }] : []);
      assert.equal(path, '/rest/v1/rpc/create_booking_request');
      return Response.json(raw, { status });
    },
  });
  const call = (body = input, token = 'client-fixture', method = 'POST') =>
    handler(
      new Request('http://localhost/request', {
        method,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      }),
    );
  assert.equal((await call(input, null)).status, 401);
  assert.equal((await call(input, 'invalid')).status, 401);
  for (const r of ['barber', 'admin', null]) {
    role = r;
    assert.equal((await call()).status, 403);
  }
  role = 'client';
  for (const bad of [
    {},
    { ...input, barberId: 'bad' },
    { ...input, bookingType: 'scheduled' },
    { ...input, scheduledFor: '2026-12-01T00:00:00Z' },
  ]) {
    const response = await call(bad);
    assert.equal(response.status, 422);
    assert.ok(Object.keys((await response.json()).fields).length);
  }
  assert.ok(!calls.some((c) => c.path.includes('/rpc/')));
  const response = await call({
    ...input,
    userId: 'forged',
    status: 'accepted',
    grossCents: -1,
    commissionPct: 100,
    barberNetCents: 999,
    idempotencyKey: 'fake',
    expiresAt: 'past',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), success);
  const rpc = calls.find((c) => c.path.includes('/rpc/'));
  assert.deepEqual(JSON.parse(rpc.options.body), {
    p_client_id: id,
    p_input: input,
  });
  for (const error of [
    'barber_unavailable',
    'duplicate_request_intent',
    'active_request_exists',
  ]) {
    status = 409;
    raw = { message: error };
    assert.deepEqual(await (await call()).json(), { error });
  }
  status = 403;
  raw = { message: 'onboarding_incomplete' };
  assert.equal((await call()).status, 403);
  raw = { message: 'request_forbidden' };
  assert.deepEqual(await (await call()).json(), { error: 'forbidden' });
  status = 422;
  raw = {
    message: 'validation_failed',
    details: JSON.stringify({ scheduledFor: 'Refresh the requested time.' }),
  };
  assert.deepEqual(await (await call()).json(), {
    error: 'validation_failed',
    fields: { scheduledFor: 'Refresh the requested time.' },
  });
  status = 200;
  raw = { ...success, address: 'must-not-leak' };
  assert.deepEqual(await (await call()).json(), { error: 'internal_error' });
  status = 503;
  raw = { secret: 'suppressed' };
  assert.deepEqual(await (await call()).json(), { error: 'internal_error' });
  assert.deepEqual(logs, [
    'booking_request.internal_error',
    'booking_request.internal_error',
  ]);
  assert.equal((await call(input, 'client-fixture', 'GET')).status, 405);
});
