import assert from 'node:assert/strict';
import test from 'node:test';

import { createAcceptBookingRequestHandler } from '../accept-handler.ts';

const userId = '91f09000-0000-4000-8000-000000000001';
const requestId = '91f09000-0000-4000-8000-000000000002';
const body = { requestId };
const success = {
  requestId,
  bookingId: '91f09000-0000-4000-8000-000000000003',
  requestStatus: 'accepted',
  bookingStatus: 'accepted_pending_payment',
};

test('acceptance verifies the stored role, sends only the verified identity and request ID, and performs no provider I/O', async () => {
  const calls = [];
  const logs = [];
  let role = 'barber';
  let rpcResult = () => Response.json(success);
  const handler = createAcceptBookingRequestHandler({
    supabaseUrl: 'http://127.0.0.1:55321',
    anonKey: 'anon-fixture',
    serviceRoleKey: 'server-fixture',
    log: { error: (message) => logs.push(message) },
    fetcher: async (url, options) => {
      const { origin, pathname } = new URL(url);
      assert.equal(origin, 'http://127.0.0.1:55321');
      calls.push(pathname);
      switch (pathname) {
        case '/auth/v1/user':
          return options.headers.authorization === 'Bearer invalid'
            ? Response.json({}, { status: 401 })
            : Response.json({
                id: userId,
                role: 'authenticated',
                is_anonymous: false,
              });
        case '/rest/v1/profiles':
          return Response.json(role ? [{ role }] : []);
        case '/rest/v1/rpc/accept_booking_request':
          assert.deepEqual(JSON.parse(options.body), {
            p_barber_id: userId,
            p_request_id: requestId,
          });
          assert.equal(options.headers.authorization, 'Bearer server-fixture');
          return rpcResult();
        default:
          assert.fail('Unexpected network destination');
      }
    },
  });
  const call = (payload = body, token = 'barber-fixture', method = 'POST') =>
    handler(
      new Request('http://localhost/accept', {
        method,
        headers: token ? { authorization: 'Bearer ' + token } : {},
        ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
      }),
    );

  assert.equal((await call(body, null)).status, 401);
  assert.equal((await call(body, 'invalid')).status, 401);
  for (const storedRole of ['client', 'admin', null]) {
    role = storedRole;
    assert.equal((await call({})).status, 403);
  }
  role = 'barber';
  for (const [invalid, expectedField] of [
    [{}, 'requestId'],
    [{ requestId: 'invalid' }, 'requestId'],
    [{ requestId, role: 'admin', p_barber_id: requestId }, '_request'],
  ]) {
    const response = await call(invalid);
    assert.equal(response.status, 422);
    assert.ok((await response.json()).fields[expectedField]);
  }
  assert.ok(!calls.some((path) => path.includes('/rpc/')));

  const accepted = await call({
    ...body,
    userId: requestId,
    grossCents: 1,
    bookingStatus: 'paid_confirmed',
    expiresAt: '2099-01-01T00:00:00Z',
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), success);
  assert.deepEqual(calls.slice(-3), [
    '/auth/v1/user',
    '/rest/v1/profiles',
    '/rest/v1/rpc/accept_booking_request',
  ]);

  for (const [status, error] of [
    [403, 'forbidden'],
    [409, 'request_not_pending'],
    [409, 'active_job_exists'],
    [409, 'barber_unavailable'],
  ]) {
    rpcResult = () =>
      Response.json({ message: error, details: 'not for clients' }, { status });
    const response = await call();
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
  }
  rpcResult = () => Response.json({ ...success, address: 'must not escape' });
  assert.deepEqual(await (await call()).json(), { error: 'internal_error' });
  rpcResult = () =>
    Response.json(
      { message: 'unrecognised internal failure' },
      { status: 500 },
    );
  assert.deepEqual(await (await call()).json(), { error: 'internal_error' });
  assert.equal((await call(body, 'barber-fixture', 'GET')).status, 405);
  assert.deepEqual(logs, [
    'booking_request.accept_internal_error',
    'booking_request.accept_internal_error',
  ]);
});
