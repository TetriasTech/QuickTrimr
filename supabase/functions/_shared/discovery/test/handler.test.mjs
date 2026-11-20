import assert from 'node:assert/strict';
import test from 'node:test';

import { createDiscoveryHandler } from '../handler.ts';
const client = '91f09000-0000-4000-8000-000000000001',
  barber = '91f09000-0000-4000-8000-000000000002',
  category = '91f09000-0000-4000-8000-000000000003';
const config = {
  radiusKm: { min: 1, max: 50 },
  pageSize: { min: 1, max: 50, default: 20 },
  distanceBands: {
    upperMeters: [2000, 5000, 10000],
    labels: ['under-2km', '2-5km', '5-10km', '10km+'],
  },
};
const input = {
  bookingType: 'available_now',
  serviceCategoryId: category,
  lat: -38,
  lng: 145,
  radiusKm: 10,
};
const result = {
  barberId: barber,
  displayName: 'Synthetic Barber',
  photoUrl: null,
  approximateArea: {
    id: 'sal:2021:qa',
    label: 'QA Shared Locality',
    mapPoint: { lat: -38, lng: 145 },
  },
  rating: null,
  ratingCount: 0,
  priceCents: 4500,
  distanceBand: 'under-2km',
  availableUntil: '2026-12-01T00:00:00Z',
};
test('auth/role/validation/config guards precede search; encrypted cursors bind caller and filters; errors are safe', async () => {
  let role = 'client',
    identity = client,
    raw = {
      rows: [{ photoId: null, result }],
      nextKey: {
        demoted: false,
        distanceMeters: 1234.567,
        priceCents: 4500,
        rating: null,
        ratingCount: 0,
        barberId: barber,
      },
    },
    rpcStatus = 200;
  const calls = [],
    logs = [];
  const handler = createDiscoveryHandler({
    supabaseUrl: 'http://127.0.0.1:55321',
    anonKey: 'anon-fixture',
    serviceRoleKey: 'server-fixture',
    cursorKey: Buffer.alloc(32, 7).toString('base64'),
    log: { error: (m) => logs.push(m) },
    fetcher: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push({ path, options });
      if (path === '/auth/v1/user')
        return options.headers.authorization === 'Bearer invalid'
          ? Response.json({ error: 'bad' }, { status: 401 })
          : Response.json({
              id: identity,
              role: 'authenticated',
              is_anonymous: false,
            });
      if (path === '/rest/v1/profiles')
        return Response.json(role ? [{ role }] : []);
      if (path === '/rest/v1/rpc/get_discovery_config')
        return Response.json(config);
      if (path === '/rest/v1/rpc/search_nearby_barbers')
        return Response.json(raw, { status: rpcStatus });
      throw new Error('Unexpected I/O');
    },
  });
  const call = (body = input, token = 'client-fixture', method = 'POST') =>
    handler(
      new Request('http://localhost/search', {
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
  assert.ok(!calls.some((c) => c.path.includes('/rpc/')));
  for (const body of [{}, { ...input, lat: 91 }, { ...input, limit: 1.5 }])
    assert.equal((await call(body)).status, 422);
  for (const body of [
    { ...input, radiusKm: 50.1 },
    { ...input, limit: 51 },
  ])
    assert.equal((await call(body)).status, 422);
  assert.ok(!calls.some((c) => c.path.endsWith('search_nearby_barbers')));
  const first = await call();
  assert.equal(first.status, 200);
  assert.equal((await call({ ...input, userId: barber })).status, 200);
  assert.equal((await call({ ...input, role: 'admin' })).status, 422);
  const page = await first.json();
  assert.deepEqual(page.results, [result]);
  assert.ok(page.nextCursor);
  const search = calls.find((c) => c.path.endsWith('search_nearby_barbers'));
  assert.equal(JSON.parse(search.options.body).p_client_id, client);
  assert.equal(JSON.parse(search.options.body).p_request.limit, 20);
  assert.equal((await call({ ...input, cursor: page.nextCursor })).status, 200);
  identity = barber;
  assert.equal((await call({ ...input, cursor: page.nextCursor })).status, 422);
  identity = client;
  assert.equal(
    (await call({ ...input, radiusKm: 11, cursor: page.nextCursor })).status,
    422,
  );
  assert.equal((await call({ ...input, cursor: 'readable-fake' })).status, 422);
  config.radiusKm.max = 5;
  assert.equal((await call()).status, 422);
  config.radiusKm.max = 50;
  raw = { rows: [], nextKey: null };
  assert.deepEqual(await (await call()).json(), {
    results: [],
    nextCursor: null,
  });
  raw = {
    message: 'validation_failed',
    details: JSON.stringify({ radiusKm: 'Config changed; refresh.' }),
  };
  rpcStatus = 422;
  assert.deepEqual(await (await call()).json(), {
    error: 'validation_failed',
    fields: { radiusKm: 'Config changed; refresh.' },
  });
  raw = { message: 'discovery_forbidden' };
  rpcStatus = 403;
  assert.deepEqual(await (await call()).json(), { error: 'forbidden' });
  rpcStatus = 200;
  raw = {
    rows: [
      {
        photoId: null,
        result: { ...result, private_coordinate: 'must-not-leak' },
      },
    ],
    nextKey: null,
  };
  assert.deepEqual(await (await call()).json(), { error: 'internal_error' });
  rpcStatus = 503;
  assert.deepEqual(await (await call()).json(), { error: 'internal_error' });
  assert.deepEqual(logs, [
    'discovery.internal_error',
    'discovery.internal_error',
  ]);
  assert.equal((await call(undefined, 'client-fixture', 'GET')).status, 405);
});
