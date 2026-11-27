import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createEarningHandler,
  releaseEarningHandler,
} from '../earning-handlers.ts';

const earningId = '11111111-1111-4111-8111-111111111111';
const request = (body) =>
  new Request('http://local.test', {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-caller' },
    body: JSON.stringify(body),
  });

test('create sends only the booking reference and the original caller JWT', async () => {
  const handler = createEarningHandler({
    supabaseUrl: 'http://local.test',
    serviceRoleKey: 'test-service-key',
    fetcher: async (url, options) => {
      assert.equal(url.pathname, '/rest/v1/rpc/create_barber_earning');
      assert.equal(options.headers.authorization, 'Bearer synthetic-caller');
      assert.deepEqual(JSON.parse(options.body), { p_booking_id: earningId });
      return Response.json({
        earningId,
        bookingId: earningId,
        status: 'pending',
        grossCents: 4503,
        commissionCents: 900,
        barberNetCents: 3603,
        commissionPctSnapshot: 20,
        idempotent: true,
      });
    },
  });
  const response = await handler(
    request({ bookingId: earningId, grossCents: 1 }),
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.grossCents, 4503);
  assert.equal(result.idempotent, true);
});

test('release exposes only recognized transition conflicts and strips database detail', async () => {
  for (const [message, status, error] of [
    ['dispute_open', 409, 'dispute_open'],
    ['invalid_status_transition', 409, 'invalid_status_transition'],
    ['other database error', 500, 'internal_error'],
  ]) {
    const handler = releaseEarningHandler({
      supabaseUrl: 'http://local.test',
      serviceRoleKey: 'test-service-key',
      fetcher: async () =>
        Response.json(
          { message, details: 'provider fixture' },
          { status: 409 },
        ),
      log: { error: () => undefined },
    });
    const response = await handler(request({ earningId }));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
  }
});
