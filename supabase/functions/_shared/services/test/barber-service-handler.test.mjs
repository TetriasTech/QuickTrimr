import assert from 'node:assert/strict';
import test from 'node:test';

import { createBarberServiceHandler } from '../barber-service-handler.ts';

const userId = '60499711-52d4-46c7-beb1-6d2c46937ed5';
const id = '8f293ef1-2954-463d-89bd-48ab1f2b7d15';
const inputs = {
  upsert: { serviceCategoryId: id, priceCents: 4550, enabled: true },
  archive: { serviceId: id },
};
function fixture(
  operation,
  { role = 'barber', authStatus = 200, rpcStatus = 200, rpcBody } = {},
) {
  const calls = [],
    logs = [];
  const response =
    operation === 'upsert'
      ? {
          id,
          serviceCategoryId: id,
          priceCents: 4550,
          enabled: true,
          archivedAt: null,
        }
      : { id, archivedAt: '2026-11-19T00:00:00Z' };
  const handler = createBarberServiceHandler({
    operation,
    supabaseUrl: 'http://127.0.0.1:55321',
    anonKey: 'public-fixture',
    serviceRoleKey: 'private-fixture',
    log: { error: (message) => logs.push(message) },
    async fetcher(input, options) {
      const url = new URL(input);
      calls.push({ url, options });
      if (url.pathname === '/auth/v1/user')
        return Response.json(
          {
            id: userId,
            role: 'authenticated',
            user_metadata: { role: 'barber' },
          },
          { status: authStatus },
        );
      if (url.pathname === '/rest/v1/profiles') {
        assert.equal(url.searchParams.get('id'), `eq.${userId}`);
        assert.equal(url.searchParams.get('select'), 'role');
        assert.equal(options.headers.authorization, 'Bearer user-fixture');
        return Response.json(role ? [{ role }] : []);
      }
      assert.equal(url.pathname, '/rest/v1/rpc/manage_barber_service');
      assert.equal(options.headers.authorization, 'Bearer private-fixture');
      return Response.json(rpcBody ?? response, { status: rpcStatus });
    },
  });
  const invoke = (input = inputs[operation], authenticated = true) =>
    handler(
      new Request('http://localhost/service', {
        method: 'POST',
        headers: {
          ...(authenticated ? { authorization: 'Bearer user-fixture' } : {}),
          'content-type': 'application/json',
        },
        body: typeof input === 'string' ? input : JSON.stringify(input),
      }),
    );
  return { invoke, calls, logs, response };
}
for (const operation of ['upsert', 'archive']) {
  test(`${operation}: verified identity and fixed operation; forged server fields cannot change the owner`, async () => {
    const f = fixture(operation);
    const result = await f.invoke({
      ...inputs[operation],
      userId: 'forged',
      idempotencyKey: 'forged',
    });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), f.response);
    assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), {
      p_user_id: userId,
      p_operation: operation,
      p_input: inputs[operation],
    });
  });
  test(`${operation}: missing/invalid auth and every non-barber role fail before RPC or input parsing`, async () => {
    const missing = fixture(operation);
    assert.equal((await missing.invoke('{', false)).status, 401);
    assert.equal(missing.calls.length, 0);
    const invalid = fixture(operation, { authStatus: 401 });
    assert.equal((await invalid.invoke()).status, 401);
    assert.equal(invalid.calls.length, 1);
    for (const role of ['client', 'admin', null]) {
      const f = fixture(operation, { role });
      assert.equal((await f.invoke('{')).status, 403);
      assert.equal(f.calls.length, 2);
    }
  });
  test(`${operation}: missing or foreign entity and concurrent role revocation are safe typed denials`, async () => {
    for (const [status, message, error] of [
      [403, 'barber_service_forbidden', 'forbidden'],
      [
        404,
        operation === 'upsert' ? 'category_unavailable' : 'not_found',
        operation === 'upsert' ? 'category_unavailable' : 'not_found',
      ],
    ]) {
      const f = fixture(operation, { rpcStatus: status, rpcBody: { message } });
      const r = await f.invoke();
      assert.equal(r.status, status);
      assert.deepEqual(await r.json(), { error });
    }
  });
}
test('malformed and crafted fractional/negative/overflow prices reject with field errors before a write', async () => {
  for (const [input, field] of [
    [{ ...inputs.upsert, priceCents: 4500.5 }, 'priceCents'],
    [{ ...inputs.upsert, priceCents: -1 }, 'priceCents'],
    [{ ...inputs.upsert, priceCents: 2147483648 }, 'priceCents'],
    [{ ...inputs.upsert, serviceCategoryId: 'bad' }, 'serviceCategoryId'],
    [{ ...inputs.upsert, barberId: userId }, '_request'],
  ]) {
    const f = fixture('upsert');
    const r = await f.invoke(input);
    assert.equal(r.status, 422);
    assert.ok((await r.json()).fields[field]);
    assert.equal(f.calls.length, 2);
  }
  assert.equal((await fixture('archive').invoke('{')).status, 422);
});
test('current database price bounds become a safe AUD field error; unexpected bodies fail closed', async () => {
  const f = fixture('upsert', {
    rpcStatus: 422,
    rpcBody: {
      message: 'price_outside_category_bounds',
      details: '{"min":2000,"max":15000}',
    },
  });
  const result = await f.invoke();
  assert.equal(result.status, 422);
  assert.deepEqual(await result.json(), {
    error: 'validation_failed',
    fields: { priceCents: 'Enter a price between A$20.00 and A$150.00.' },
  });
  for (const [status, body] of [
    [200, { ...fixture('upsert').response, secret: 'sensitive-fixture' }],
    [500, { message: 'sensitive-fixture' }],
    [
      422,
      {
        message: 'price_outside_category_bounds',
        details: 'sensitive-fixture',
      },
    ],
  ]) {
    const failed = fixture('upsert', { rpcStatus: status, rpcBody: body });
    assert.equal((await failed.invoke()).status, 500);
    assert.deepEqual(failed.logs, ['barber_services.internal_error']);
  }
});
