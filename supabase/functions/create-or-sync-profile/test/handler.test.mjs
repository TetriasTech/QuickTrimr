import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProfileSyncHandler } from '../handler.ts';

const userId = 'b455a1a3-dccd-489f-a352-f7352becd37b';
const otherId = 'fabe810e-35af-4e50-ab89-046776cdcc53';
const profile = {
  id: userId,
  role: 'client',
  verificationStatus: 'not_started',
  onboardingComplete: false,
  createdAt: '2026-11-16T04:00:00Z',
};

function setup({
  user = { id: userId, role: 'authenticated' },
  result = Response.json(profile),
} = {}) {
  const calls = [];
  const warnings = [];
  const errors = [];
  const handler = createProfileSyncHandler({
    supabaseUrl: 'http://localhost:55321',
    anonKey: 'mock-anon',
    serviceRoleKey: 'mock-service',
    log: {
      warn: (...args) => warnings.push(args),
      error: (...args) => errors.push(args),
    },
    fetcher: async (url, options) => {
      calls.push({ path: url.pathname, ...options });
      if (url.pathname === '/auth/v1/user') return Response.json(user);
      assert.equal(url.pathname, '/rest/v1/rpc/create_or_sync_profile');
      return result;
    },
  });
  const request = (
    body,
    { authorization = 'Bearer mock-user', method = 'POST' } = {},
  ) =>
    handler(
      new Request(
        'http://localhost:55321/functions/v1/create-or-sync-profile',
        {
          method,
          headers: authorization ? { authorization } : {},
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      ),
    );
  return { calls, errors, request, warnings };
}

test('sync uses only the verified Auth user and the selected signup role', async () => {
  const { calls, warnings, request } = setup({
    user: {
      id: userId,
      role: 'authenticated',
      user_metadata: { role: 'admin' },
    },
  });
  const response = await request({
    role: 'client',
    userId: otherId,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), profile);
  assert.deepEqual(calls[0].headers, {
    apikey: 'mock-anon',
    authorization: 'Bearer mock-user',
  });
  assert.equal(calls[1].headers.authorization, 'Bearer mock-service');
  assert.deepEqual(JSON.parse(calls[1].body), {
    p_user_id: userId,
    p_signup_role: 'client',
  });
  assert.deepEqual(warnings, [['profile_sync.ignored_identity_mismatch']]);
});

test('missing or malformed auth and unsupported methods do no upstream work', async () => {
  const { calls, request } = setup();
  assert.equal(
    (await request({ role: 'client' }, { authorization: null })).status,
    401,
  );
  assert.equal(
    (await request({ role: 'client' }, { authorization: 'Token mock-user' }))
      .status,
    401,
  );
  const response = await request(undefined, { method: 'GET' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');
  assert.equal(calls.length, 0);
});

test('rejects users without an authenticated non-anonymous Auth identity', async () => {
  for (const user of [
    { id: userId, role: 'authenticated', is_anonymous: true },
    { id: userId, role: 'service_role' },
    { id: 'invalid-id', role: 'authenticated' },
  ]) {
    const { calls, request } = setup({ user });
    assert.equal((await request({ role: 'client' })).status, 401);
    assert.equal(calls.length, 1);
  }
});

test('admin and invalid signup roles never call the profile RPC', async () => {
  const { calls, request } = setup();
  const forbidden = await request({ role: 'admin' });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: 'forbidden' });
  const invalid = await request({ role: 'owner' });
  assert.equal(invalid.status, 422);
  assert.deepEqual(await invalid.json(), {
    error: 'validation_failed',
    fields: { role: 'Must be client or barber' },
  });
  assert.equal((await request(undefined)).status, 422);
  assert.equal(
    (await request({ role: 'client', onboardingComplete: true })).status,
    422,
  );
  assert.ok(calls.every(({ path }) => path === '/auth/v1/user'));
});

test('returns a generic denial when the stored role differs', async () => {
  const { request } = setup({
    result: Response.json(
      { message: 'profile_role_forbidden', code: '42501' },
      { status: 403 },
    ),
  });
  const response = await request({ role: 'client' });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'forbidden' });
});

test('suppresses unexpected upstream details and records only a generic error', async () => {
  for (const result of [
    Response.json({ message: 'internal upstream detail' }, { status: 500 }),
    Response.json({ ...profile, id: otherId }),
    Response.json({ ...profile, privateField: 'internal upstream detail' }),
  ]) {
    const { errors, request } = setup({ result });
    const response = await request({ role: 'client' });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'internal_error' });
    assert.deepEqual(errors, [['profile_sync.internal_error']]);
  }
});
