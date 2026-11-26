import assert from 'node:assert/strict';
import test from 'node:test';

import { REQUEST_DECLINE_REASONS } from '@quicktrimr/shared';

import { createBookingRequestActionHandler } from '../action-handler.ts';

const userId = '91f09000-0000-4000-8000-000000000001';
const requestId = '91f09000-0000-4000-8000-000000000002';
const success = { requestId, status: 'declined' };

test('decline forwards only the verified actor, request ID and an approved optional code', async () => {
  let role = 'barber';
  let reply = () => Response.json(success);
  const calls = [];
  const writes = [];
  const logs = [];
  const handler = createBookingRequestActionHandler('decline', {
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
          return Response.json({
            id: userId,
            role: 'authenticated',
            is_anonymous: false,
          });
        case '/rest/v1/profiles':
          return Response.json(role ? [{ role }] : []);
        case '/rest/v1/rpc/decline_booking_request':
          assert.equal(options.headers.authorization, 'Bearer server-fixture');
          writes.push(JSON.parse(options.body));
          return reply();
        default:
          assert.fail('Unexpected network destination');
      }
    },
  });
  const call = (body, token = 'barber-fixture') =>
    handler(
      new Request('http://localhost/decline', {
        method: 'POST',
        headers: token ? { authorization: 'Bearer ' + token } : {},
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await call({ requestId }, null)).status, 401);
  for (const storedRole of ['client', 'admin', null]) {
    role = storedRole;
    assert.equal((await call({})).status, 403);
  }
  role = 'barber';
  for (const reason of ['', 'too_far ', 'unlisted', null]) {
    const result = await call({ requestId, reason });
    assert.equal(result.status, 422);
    assert.ok((await result.json()).fields.reason);
  }
  const badId = await call({ requestId: 'invalid' });
  assert.equal(badId.status, 422);
  assert.ok((await badId.json()).fields.requestId);
  assert.deepEqual(writes, []);

  for (const reason of [undefined, ...REQUEST_DECLINE_REASONS]) {
    const result = await call({
      requestId,
      reason,
      userId: requestId,
      status: 'accepted',
    });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), success);
    assert.deepEqual(writes.at(-1), {
      p_barber_id: userId,
      p_request_id: requestId,
      ...(reason ? { p_reason: reason } : {}),
    });
    assert.deepEqual(calls.slice(-3), [
      '/auth/v1/user',
      '/rest/v1/profiles',
      '/rest/v1/rpc/decline_booking_request',
    ]);
  }
  reply = () =>
    Response.json(
      { message: 'request_not_pending', details: 'private' },
      { status: 409 },
    );
  const conflict = await call({ requestId });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: 'request_not_pending' });
  reply = () =>
    Response.json({ message: 'invalid_decline_reason' }, { status: 422 });
  const invalid = await call({ requestId, reason: 'too_far' });
  assert.equal(invalid.status, 422);
  assert.ok((await invalid.json()).fields.reason);
  reply = () => Response.json({ ...success, reason: 'too_far' });
  const unknown = await call({ requestId });
  assert.equal(unknown.status, 500);
  assert.deepEqual(await unknown.json(), { error: 'internal_error' });
  assert.deepEqual(logs, ['booking_request.decline_internal_error']);
});
