import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import {
  apiJson,
  assertDenied,
  assertRawBody,
  makeUsers,
} from './api-test-helpers.mjs';
import { localStatus } from './local-api.mjs';

const status = localStatus();
const { users, tokens } = await makeUsers(status);
const profile = '/functions/v1/create-or-sync-profile';
const endpoint = '/functions/v1/manage-client-addresses';
const post = (path, token, body) =>
  apiJson(status, path, token, { method: 'POST', body: JSON.stringify(body) });
const addressApi = (token, body) => post(endpoint, token, body);
const fixture = {
  label: 'Test address',
  line1: '18 King George Terrace',
  suburb: 'Parkes',
  state: 'ACT',
  postcode: '2600',
  unit: '',
  accessNotes: 'Synthetic note',
};

for (const [name, role] of [
  ['clientA', 'client'],
  ['clientB', 'client'],
  ['barberA', 'barber'],
]) {
  assert.equal((await post(profile, tokens[name], { role })).status, 200);
}
assert.equal(
  (
    await post('/functions/v1/complete-client-profile', tokens.clientA, {
      displayName: 'Local verification',
      mobile: '0412 345 678',
    })
  ).status,
  200,
);

assert.equal((await addressApi(undefined, { operation: 'list' })).status, 401);
for (const operation of ['list', 'search', 'nearby', 'create']) {
  const body = {
    list: { operation },
    search: { operation, query: fixture.line1 },
    nearby: { operation, lat: -35.3027, lng: 149.1293 },
    create: { operation, address: fixture },
  }[operation];
  const denied = await addressApi(tokens.barberA, body);
  assert.equal(denied.status, 403);
  assertRawBody(denied.body, { error: 'forbidden' }, 'Wrong role');
}

const bad = await addressApi(tokens.clientA, {
  operation: 'create',
  address: { ...fixture, postcode: 'bad' },
});
assert.equal(bad.status, 422);
assertRawBody(
  bad.body,
  {
    error: 'validation_failed',
    fields: { postcode: 'Enter a four-digit postcode' },
  },
  'Field error',
);
assert.equal(
  (
    await addressApi(tokens.clientA, {
      operation: 'create',
      address: {
        ...fixture,
        lat: -35.3027,
        lng: 149.1293,
        clientId: users.clientB,
      },
    })
  ).status,
  422,
);
const unresolved = await addressApi(tokens.clientA, {
  operation: 'create',
  address: { ...fixture, line1: 'No matching landmark for this local QA test' },
});
assert.equal(unresolved.status, 422);
assert.equal(typeof unresolved.body.fields?.line1, 'string');

const directory = await addressApi(tokens.clientA, {
  operation: 'search',
  query: '18 King George Parkes ACT',
});
assert.equal(directory.status, 200);
assert.ok(
  directory.body.candidates.some(
    (p) => p.line1 === '18 KING GEORGE TCE' && p.suburb === 'PARKES',
  ),
  'Official G-NAF fixture missing, import ACT first.',
);
const nearby = await addressApi(tokens.clientA, {
  operation: 'nearby',
  lat: -35.3027,
  lng: 149.1293,
});
assert.equal(nearby.status, 200);
assert.ok(nearby.body.candidates.some((p) => p.suburb === 'PARKES'));
for (const candidate of [
  ...directory.body.candidates,
  ...nearby.body.candidates,
]) {
  assertRawBody(
    Object.keys(candidate).sort(),
    ['directoryId', 'line1', 'postcode', 'state', 'suburb', 'unit'],
    'Candidate projection',
  );
}

const testId = `qa${randomBytes(5).toString('hex')}`;
const ambiguous = { ...fixture, line1: `99 ${testId} TEST RD` };
const privateDirectorySql = (sql) =>
  execFileSync(
    'docker',
    [
      'exec',
      'supabase_db_quicktrimr',
      'psql',
      '-Xq',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-c',
      sql,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
privateDirectorySql(`
  insert into private.address_directory (id,line1,line1_long,suburb,state,postcode,unit,location)
  values ('${testId}a', '${ambiguous.line1}', '${ambiguous.line1}', 'PARKES', 'ACT', '2600', '',
      'SRID=4326;POINT(149.1293 -35.3027)'),
    ('${testId}b', '${ambiguous.line1}', '${ambiguous.line1}', 'PARKES', 'ACT', '2600', '',
      'SRID=4326;POINT(149.1340 -35.3060)');
`);
try {
  const rejected = await addressApi(tokens.clientA, {
    operation: 'create',
    address: ambiguous,
  });
  assert.equal(rejected.status, 422);
  assert.equal(typeof rejected.body.fields?.line1, 'string');
  const selected = await addressApi(tokens.clientB, {
    operation: 'create',
    address: ambiguous,
    directoryId: `${testId}a`,
  });
  assert.equal(
    selected.status,
    200,
    'Selecting the exact directory entry disambiguates the save.',
  );
  assert.equal(
    selected.body.onboardingComplete,
    false,
    'An address alone cannot complete onboarding.',
  );
  await addressApi(tokens.clientB, {
    operation: 'archive',
    id: selected.body.address.id,
  });
} finally {
  privateDirectorySql(
    `delete from private.address_directory where id in ('${testId}a','${testId}b')`,
  );
}

const outcomes = await Promise.all(
  Array.from({ length: 6 }, () =>
    addressApi(tokens.clientA, { operation: 'create', address: fixture }),
  ),
);
assert.ok(
  outcomes.every((entry) => entry.status === 200),
  'Every parallel save returns success',
);
const address = outcomes[0].body.address;
assert.ok(
  outcomes.every(
    (entry) =>
      entry.body.address.id === address.id && entry.body.onboardingComplete,
  ),
);
assertRawBody(
  Object.keys(address).sort(),
  [
    'accessNotes',
    'archivedAt',
    'createdAt',
    'id',
    'label',
    'line1',
    'postcode',
    'state',
    'suburb',
    'unit',
  ],
  'Owner saved address projection',
);
assert.equal(address.line1, '18 KING GEORGE TCE');

const owner = (actor, id = address.id) =>
  apiJson(
    status,
    `/rest/v1/client_addresses?id=eq.${id}&select=id,location,archived_at`,
    actor,
  );
const resolvedLocation = (await owner(tokens.clientA)).body[0]?.location;
assert.ok(resolvedLocation, 'Resolved PostGIS point stored.');
assertRawBody(
  (await owner(tokens.clientB)).body,
  [],
  'Cross-client raw address read',
);
assertRawBody(
  (await owner(tokens.barberA)).body,
  [],
  'Unrelated barber raw address read',
);

const savedList = await addressApi(tokens.clientA, { operation: 'list' });
assert.equal(savedList.status, 200);
assertRawBody(
  savedList.body,
  { operation: 'list', addresses: [address], nextCursor: null },
  'Owner active list',
);
assertRawBody(
  (await addressApi(tokens.clientB, { operation: 'list' })).body,
  { operation: 'list', addresses: [], nextCursor: null },
  'Cross-client active list',
);

for (const action of [
  { operation: 'archive', id: address.id },
  { operation: 'update', id: address.id, address: fixture },
]) {
  const inaccessible = await addressApi(tokens.clientB, action);
  assert.equal(inaccessible.status, 404);
  assertRawBody(
    inaccessible.body,
    { error: 'not_found' },
    'No cross-client lookup oracle',
  );
}
for (const method of ['PATCH', 'DELETE']) {
  await assertDenied(
    status,
    `/rest/v1/client_addresses?id=eq.${address.id}`,
    tokens.clientA,
    {
      method,
      ...(method === 'PATCH' && { body: { label: 'Bypass' } }),
      httpStatus: 403,
      code: '42501',
    },
  );
}
await assertDenied(status, '/rest/v1/client_addresses', tokens.clientA, {
  method: 'POST',
  body: { client_id: users.clientA, label: 'Bypass' },
  httpStatus: 403,
  code: '42501',
});
assert.equal(
  (
    await post('/rest/v1/rpc/manage_client_addresses', tokens.clientA, {
      p_user_id: users.clientA,
      p_request: { operation: 'list' },
    })
  ).status,
  403,
);
assert.equal(
  (
    await apiJson(
      status,
      '/rest/v1/address_directory?select=id',
      tokens.clientA,
      { headers: { 'accept-profile': 'private' } },
    )
  ).status,
  406,
);

const edited = await addressApi(tokens.clientA, {
  operation: 'update',
  id: address.id,
  address: { ...fixture, accessNotes: 'Edited synthetic note' },
});
assert.equal(edited.status, 200);
assert.equal(edited.body.address.accessNotes, 'Edited synthetic note');
const archives = await Promise.all(
  Array.from({ length: 6 }, () =>
    addressApi(tokens.clientA, { operation: 'archive', id: address.id }),
  ),
);
assert.ok(
  archives.every(
    (result) => result.status === 200 && !result.body.onboardingComplete,
  ),
);
const archivedAt = archives[0].body.address.archivedAt;
assert.ok(
  archivedAt &&
    archives.every((result) => result.body.address.archivedAt === archivedAt),
);
assertRawBody(
  (await addressApi(tokens.clientA, { operation: 'list' })).body,
  { operation: 'list', addresses: [], nextCursor: null },
  'Archive excluded from picker',
);
assertRawBody(
  (await owner(tokens.clientA)).body,
  [{ id: address.id, location: resolvedLocation, archived_at: archivedAt }],
  'Archived row retains its ID and resolved point',
);
const rejectedEdit = await addressApi(tokens.clientA, {
  operation: 'update',
  id: address.id,
  address: fixture,
});
assert.equal(rejectedEdit.status, 409);
assertRawBody(
  rejectedEdit.body,
  { error: 'address_archived' },
  'Archived edit',
);
assert.equal(
  (await post(profile, tokens.clientA, { role: 'client' })).body
    .onboardingComplete,
  false,
);

const audit = await apiJson(
  status,
  `/rest/v1/audit_logs?entity_id=eq.${address.id}&select=action,new_value&order=action`,
  status.SERVICE_ROLE_KEY,
);
assert.equal(audit.status, 200);
assertRawBody(
  audit.body,
  [
    {
      action: 'client.address_archive',
      new_value: { onboardingComplete: false },
    },
    {
      action: 'client.address_create',
      new_value: { onboardingComplete: true },
    },
    {
      action: 'client.address_update',
      new_value: { onboardingComplete: true },
    },
  ],
  'No contact detail in the audit and no duplicate effects',
);
console.log(
  'Verified live Australian search and nearby results, manual save, owner-only editing, archive, onboarding and parallel retry safety.',
);
