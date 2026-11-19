import assert from 'node:assert/strict';
import test from 'node:test';

import { createCategoryMutationHandler } from '../handler.ts';

const userId = '60499711-52d4-46c7-beb1-6d2c46937ed5';
const category = {
  id: '8f293ef1-2954-463d-89bd-48ab1f2b7d15',
  slug: 'fixture',
  displayName: 'Fixture',
  description: '',
  displayOrder: 1,
  minPriceCents: 2000,
  maxPriceCents: 15000,
  archivedAt: null,
};
const inputs = {
  create: {
    slug: category.slug,
    displayName: category.displayName,
    displayOrder: 1,
    minPriceCents: 2000,
    maxPriceCents: 15000,
  },
  update: {
    id: category.id,
    displayName: category.displayName,
    displayOrder: 1,
    minPriceCents: 2000,
    maxPriceCents: 15000,
  },
  archive: { id: category.id },
};
function setup(
  operation,
  { role = 'admin', authStatus = 200, rpcStatus = 200, rpcBody } = {},
) {
  const calls = [],
    logs = [];
  const handler = createCategoryMutationHandler({
    operation,
    supabaseUrl: 'http://127.0.0.1:55321',
    anonKey: 'public-fixture',
    serviceRoleKey: 'private-fixture',
    log: {
      error(message) {
        logs.push(message);
      },
    },
    async fetcher(input, options) {
      const url = new URL(input);
      calls.push({ url, options });
      if (url.pathname === '/auth/v1/user')
        return Response.json(
          {
            id: userId,
            role: 'authenticated',
            user_metadata: { role: 'admin' },
          },
          { status: authStatus },
        );
      if (url.pathname === '/rest/v1/profiles') {
        assert.equal(options.headers.authorization, 'Bearer user-fixture');
        assert.equal(url.searchParams.get('id'), `eq.${userId}`);
        assert.equal(url.searchParams.get('select'), 'role');
        return Response.json(role ? [{ role }] : []);
      }
      assert.equal(url.pathname, '/rest/v1/rpc/manage_service_category');
      assert.equal(options.headers.authorization, 'Bearer private-fixture');
      assert.equal(options.redirect, 'error');
      const expected =
        operation === 'archive'
          ? { id: category.id, archivedAt: '2026-11-19T02:00:00Z' }
          : category;
      return Response.json(rpcBody ?? expected, { status: rpcStatus });
    },
  });
  const invoke = (body = inputs[operation], authenticated = true) =>
    handler(
      new Request('http://localhost/category', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authenticated && { authorization: 'Bearer user-fixture' }),
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  return { invoke, calls, logs };
}

for (const operation of ['create', 'update', 'archive']) {
  test(`${operation}: current bearer identity reaches only the fixed audited operation`, async () => {
    const f = setup(operation);
    const result = await f.invoke({
      ...inputs[operation],
      userId: 'forged',
      idempotencyKey: 'forged',
    });
    assert.equal(result.status, 200);
    const body = JSON.parse(f.calls.at(-1).options.body);
    assert.equal(body.p_user_id, userId);
    assert.equal(body.p_operation, operation);
    assert.deepEqual(body.p_input, inputs[operation]);
    assert.deepEqual(f.logs, []);
  });
  test(`${operation}: unauthenticated, invalid JWT and every non-admin role fail before a category read`, async () => {
    const anonymous = setup(operation);
    assert.equal((await anonymous.invoke({}, false)).status, 401);
    assert.equal(anonymous.calls.length, 0);
    const invalid = setup(operation, { authStatus: 401 });
    assert.equal((await invalid.invoke()).status, 401);
    assert.equal(invalid.calls.length, 1);
    for (const role of ['client', 'barber', null]) {
      const f = setup(operation, { role });
      assert.equal((await f.invoke({ role: 'admin', userId })).status, 403);
      assert.equal(f.calls.length, 2);
    }
  });
  test(`${operation}: the database can revoke an admin after the initial role lookup`, async () => {
    const f = setup(operation, {
      rpcStatus: 403,
      rpcBody: { message: 'category_forbidden' },
    });
    assert.deepEqual(await (await f.invoke()).json(), { error: 'forbidden' });
  });
}

test('malformed input and invalid fields never call the mutation RPC', async () => {
  for (const [change, field] of [
    [{ displayName: ' ' }, 'displayName'],
    [{ displayOrder: -1 }, 'displayOrder'],
    [{ minPriceCents: 2.5 }, 'minPriceCents'],
    [{ maxPriceCents: 2000 }, 'maxPriceCents'],
    [{ maxPriceCents: 2_147_483_648 }, 'maxPriceCents'],
    [{ unknown: true }, '_request'],
  ]) {
    const f = setup('create');
    const response = await f.invoke({ ...inputs.create, ...change });
    assert.equal(response.status, 422);
    assert.ok((await response.json()).fields[field]);
    assert.equal(f.calls.length, 2);
  }
  assert.equal((await setup('create').invoke('{')).status, 422);
});

test('slug changes are rejected, duplicate slugs and active-price conflicts are safe typed errors', async () => {
  const changed = setup('update');
  assert.equal(
    (await changed.invoke({ ...inputs.update, slug: 'other' })).status,
    409,
  );
  assert.equal(changed.calls.length, 2);
  const duplicate = setup('create', {
    rpcStatus: 409,
    rpcBody: { message: 'slug_exists' },
  });
  assert.equal((await (await duplicate.invoke()).json()).error, 'slug_exists');
  for (const details of ['minPriceCents', 'maxPriceCents', 'both']) {
    const f = setup('update', {
      rpcStatus: 409,
      rpcBody: { message: 'category_price_conflict', details },
    });
    const r = await f.invoke();
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.deepEqual(
      Object.keys(body.fields).sort(),
      details === 'both' ? ['maxPriceCents', 'minPriceCents'] : [details],
    );
  }
});

test('unexpected provider/storage shapes fail closed without logging the payload or credential', async () => {
  const sentinel = 'sensitive-provider-fixture';
  const f = setup('create', { rpcBody: { ...category, extra: sentinel } });
  assert.equal((await f.invoke()).status, 500);
  assert.deepEqual(f.logs, ['service_categories.internal_error']);
  const failed = setup('update', {
    rpcStatus: 500,
    rpcBody: { message: sentinel, details: sentinel },
  });
  assert.deepEqual(await (await failed.invoke()).json(), {
    error: 'internal_error',
  });
  assert.deepEqual(failed.logs, ['service_categories.internal_error']);
});
