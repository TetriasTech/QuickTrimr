import assert from 'node:assert/strict';

import { apiJson, assertRawBody, makeUsers } from './api-test-helpers.mjs';
import { localStatus } from './local-api.mjs';

const status = localStatus();
const { users, tokens } = await makeUsers(status, {
  additional: ['admin'],
  adversarialMetadata: true,
});
const endpoint = '/functions/v1/create-or-sync-profile';
const service = status.SERVICE_ROLE_KEY;

const post = (path, token, body) =>
  apiJson(status, path, token, { method: 'POST', body: JSON.stringify(body) });
const sync = (token, body) => post(endpoint, token, body);

async function rows(table, filter, select) {
  const result = await apiJson(
    status,
    `/rest/v1/${table}?${filter}&select=${select}`,
    service,
  );
  assert.equal(result.status, 200, `${table}: could not verify stored state.`);
  assert.ok(Array.isArray(result.body), `${table}: expected rows.`);
  return result.body;
}

async function verifyStored(id, role, expectedProfile) {
  const [profiles, clients, barbers, audit] = await Promise.all([
    rows('profiles', `id=eq.${id}`, 'id,role,verification_status,updated_at'),
    rows('client_profiles', `id=eq.${id}`, 'id'),
    rows('barber_profiles', `id=eq.${id}`, 'id'),
    rows(
      'audit_logs',
      `entity_type=eq.profile&entity_id=eq.${id}`,
      'actor_id,actor_role,action,new_value',
    ),
  ]);
  assert.equal(profiles.length, 1, 'Expected one profile row.');
  assertRawBody(
    {
      id: profiles[0].id,
      role: profiles[0].role,
      verificationStatus: profiles[0].verification_status,
    },
    { id, role, verificationStatus: 'not_started' },
    'Stored profile',
  );
  if (expectedProfile)
    assertRawBody(profiles[0], expectedProfile, 'Profile unchanged on sync');
  assertRawBody(clients, role === 'client' ? [{ id }] : [], 'Client subtype');
  assertRawBody(barbers, role === 'barber' ? [{ id }] : [], 'Barber subtype');
  assertRawBody(
    audit,
    [
      {
        actor_id: id,
        actor_role: role,
        action: 'profile.created',
        new_value: { role, verificationStatus: 'not_started' },
      },
    ],
    'Creation audit',
  );
  return profiles[0];
}

for (const token of [undefined, status.ANON_KEY]) {
  assert.equal(
    (await sync(token, { role: 'client' })).status,
    401,
    'Sessionless profile sync',
  );
}

const admin = await sync(tokens.admin, { role: 'admin' });
assert.equal(admin.status, 403, 'Admin signup');
assertRawBody(admin.body, { error: 'forbidden' }, 'Admin signup response');
const invalid = await sync(tokens.admin, { role: 'owner' });
assert.equal(invalid.status, 422, 'Invalid role');
assertRawBody(
  invalid.body,
  { error: 'validation_failed', fields: { role: 'Must be client or barber' } },
  'Invalid role response',
);

for (const token of [undefined, tokens.admin]) {
  const denied = await post('/rest/v1/rpc/create_or_sync_profile', token, {
    p_user_id: users.admin,
    p_signup_role: 'client',
  });
  assert.ok(
    [401, 403, 404].includes(denied.status),
    'Direct client access to service RPC was not denied.',
  );
}

for (const [fixture, role] of [
  ['clientA', 'client'],
  ['barberA', 'barber'],
  ['clientB', 'client'],
]) {
  const id = users[fixture];
  const token = tokens[fixture];
  const input = { role, userId: users.admin };
  const results = await Promise.all(
    Array.from({ length: 6 }, () => sync(token, input)),
  );
  const expected = {
    id,
    role,
    verificationStatus: 'not_started',
    onboardingComplete: false,
    createdAt: results[0].body.createdAt,
  };
  for (const result of results) {
    assert.equal(result.status, 200, 'Concurrent first profile sync');
    assertRawBody(result.body, expected, 'Concurrent profile response');
    assert.ok(
      !Number.isNaN(Date.parse(result.body.createdAt)),
      'Profile creation timestamp',
    );
  }
  const stored = await verifyStored(id, role);
  const repeat = await sync(token, { role });
  assert.equal(repeat.status, 200, 'Repeat sync');
  assertRawBody(repeat.body, expected, 'Repeat response');
  const changed = await sync(token, {
    role: role === 'client' ? 'barber' : 'client',
  });
  assert.equal(changed.status, 403, 'Role change on existing profile');
  assertRawBody(changed.body, { error: 'forbidden' }, 'Role change response');
  await verifyStored(id, role, stored);
}

const crossUser = await apiJson(
  status,
  `/rest/v1/profiles?id=eq.${users.barberA}&select=id,role`,
  tokens.clientA,
);
assert.equal(crossUser.status, 200, 'Cross-user profile read');
assertRawBody(crossUser.body, [], 'Cross-user profile read denial');

const completionPath = `/rest/v1/profiles?id=eq.${users.clientA}`;
const completionUpdate = {
  method: 'PATCH',
  body: JSON.stringify({ onboarding_completed_at: new Date().toISOString() }),
};
const directWrite = await apiJson(
  status,
  completionPath,
  tokens.clientA,
  completionUpdate,
);
assert.equal(directWrite.status, 403, 'Direct client completion write denial');
assert.equal(directWrite.body.code, '42501', 'Database permission denial');
const incomplete = await sync(tokens.clientA, { role: 'client' });
assert.equal(incomplete.status, 200, 'Incomplete profile sync');
assert.equal(
  incomplete.body.onboardingComplete,
  false,
  'Client cannot mark completion',
);

const marked = await apiJson(status, completionPath, service, completionUpdate);
assert.equal(marked.status, 200, 'Server completion fixture update');
assert.equal(marked.body.length, 1, 'One completion fixture updated');
const completed = await sync(tokens.clientA, {
  role: 'client',
});
assert.equal(completed.status, 200, 'Completed profile sync');
assert.equal(
  completed.body.onboardingComplete,
  true,
  'Sync preserves server completion',
);
await verifyStored(users.clientA, 'client');

const targetRows = await Promise.all([
  ...['profiles', 'client_profiles', 'barber_profiles'].map((table) =>
    rows(table, `id=eq.${users.admin}`, 'id'),
  ),
  rows('audit_logs', `entity_id=eq.${users.admin}`, 'id'),
]);
for (const result of targetRows)
  assertRawBody(result, [], 'Rejected writes and ignored body ID');

console.log(
  'Profile sync passed: 18 parallel calls across three new users, stable repeats, immutable roles, one subtype and audit record per user, server completion, and anonymous, cross-user and direct write denial.',
);
