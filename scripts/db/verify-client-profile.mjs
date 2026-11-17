import assert from 'node:assert/strict';

import { apiJson, assertRawBody, makeUsers } from './api-test-helpers.mjs';
import { localStatus } from './local-api.mjs';

const status = localStatus();
const service = status.SERVICE_ROLE_KEY;
const { users, tokens } = await makeUsers(status, { additional: ['extra'] });
const profileFunction = '/functions/v1/complete-client-profile';
const fields = { displayName: '  Sam Example  ', mobile: '0412 345 678' };
const post = (path, token, body) =>
  apiJson(status, path, token, { method: 'POST', body: JSON.stringify(body) });
const save = (token, body = fields) => post(profileFunction, token, body);

for (const [fixture, role] of [
  ['clientA', 'client'],
  ['clientB', 'client'],
  ['extra', 'client'],
  ['barberA', 'barber'],
]) {
  const initialized = await post(
    '/functions/v1/create-or-sync-profile',
    tokens[fixture],
    { role },
  );
  assert.equal(initialized.status, 200, 'Disposable profile initialized.');
}

assert.equal((await save(undefined)).status, 401);
const forbidden = await save(tokens.barberA);
assert.equal(forbidden.status, 403);
assertRawBody(
  forbidden.body,
  { error: 'forbidden' },
  'Barber cannot save client profile.',
);
const invalid = await save(tokens.clientA, {
  displayName: '',
  mobile: '+61212345678',
});
assert.equal(invalid.status, 422);
assertRawBody(
  invalid.body,
  {
    error: 'validation_failed',
    fields: {
      displayName: 'Enter your display name',
      mobile: 'Enter a valid Australian mobile number',
    },
  },
  'Invalid profile fields.',
);
assert.equal(
  (
    await save(tokens.clientA, {
      ...fields,
      onboardingComplete: true,
      verificationStatus: 'verified',
    })
  ).status,
  422,
);
const direct = await post(
  '/rest/v1/rpc/complete_client_profile',
  tokens.clientA,
  {
    p_user_id: users.clientA,
    p_display_name: 'Invalid path',
    p_mobile: '+61412345678',
    p_attach_avatar: false,
  },
);
assert.equal(direct.status, 403, 'Profile RPC is service only.');

const audit = async (id) => {
  const result = await apiJson(
    status,
    `/rest/v1/audit_logs?actor_id=eq.${id}&action=eq.client.profile_saved&select=new_value`,
    service,
  );
  assert.equal(result.status, 200);
  return result.body;
};
assertRawBody(
  await audit(users.clientA),
  [],
  'Rejected writes leave no save audit.',
);

const stored = (id, token) =>
  apiJson(
    status,
    `/rest/v1/client_profiles?id=eq.${id}&select=id,display_name,mobile,avatar_path`,
    token,
  );
const expected = (id, complete) => ({
  id,
  displayName: 'Sam Example',
  mobile: '+61412345678',
  onboardingComplete: complete,
  verificationStatus: 'not_started',
});

// Several independent simultaneous first-save races. The input identity is
// ignored, even while other authenticated clients are also present.
for (const fixture of ['clientA', 'clientB', 'extra']) {
  const id = users[fixture];
  const requests = await Promise.all(
    Array.from({ length: 6 }, () =>
      save(tokens[fixture], { ...fields, userId: users.barberA }),
    ),
  );
  for (const result of requests) {
    assert.equal(result.status, 200, 'Concurrent profile save.');
    assertRawBody(
      result.body,
      expected(id, false),
      'Canonical private profile and incomplete onboarding.',
    );
  }
  const row = await stored(id, tokens[fixture]);
  assert.equal(row.status, 200);
  assertRawBody(
    row.body,
    [
      {
        id,
        display_name: 'Sam Example',
        mobile: '+61412345678',
        avatar_path: null,
      },
    ],
    'Normalized stored profile.',
  );
  assertRawBody(
    await audit(id),
    [{ new_value: { onboardingComplete: false, hasAvatar: false } }],
    'One append-only audit event without private fields.',
  );
}

for (const token of [tokens.clientB, tokens.barberA]) {
  const foreign = await stored(users.clientA, token);
  assert.equal(foreign.status, 200);
  assertRawBody(foreign.body, [], 'Cross-user private profile read denied.');
  const write = await apiJson(
    status,
    `/rest/v1/client_profiles?id=eq.${users.clientA}&select=id`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({ mobile: '+61400000000' }),
    },
  );
  assert.equal(write.status, 200);
  assertRawBody(write.body, [], 'Cross-user private profile write denied.');
}

const addAddress = async (clientId, archivedAt = null) => {
  const address = await post('/rest/v1/client_addresses?select=id', service, {
    client_id: clientId,
    location: 'SRID=4326;POINT(151.2 -33.8)',
    archived_at: archivedAt,
  });
  assert.equal(address.status, 201, 'Disposable service address fixture.');
};
await addAddress(users.clientB);
assertRawBody(
  (await save(tokens.clientA)).body,
  expected(users.clientA, false),
  'Another client’s address never unlocks onboarding.',
);
await addAddress(users.clientA, '2026-01-01T00:00:00Z');
assertRawBody(
  (await save(tokens.clientA)).body,
  expected(users.clientA, false),
  'Archived address never unlocks onboarding.',
);
await addAddress(users.clientA);
const addressRead = await apiJson(
  status,
  `/rest/v1/client_addresses?client_id=eq.${users.clientA}&select=*`,
  tokens.clientA,
);
assert.equal(
  addressRead.status,
  200,
  'The existing owner address read still works.',
);
assert.equal(addressRead.body.length, 2);
assert.ok(addressRead.body.every((row) => row.client_id === users.clientA));
assert.equal(
  addressRead.body.filter((row) => row.archived_at === null).length,
  1,
);
assertRawBody(
  (await save(tokens.clientA)).body,
  expected(users.clientA, true),
  'Owned active address unlocks onboarding.',
);
const synced = await post(
  '/functions/v1/create-or-sync-profile',
  tokens.clientA,
  { role: 'client' },
);
assert.equal(synced.status, 200);
assert.equal(synced.body.onboardingComplete, true);

// All requests are pinned to the local Storage API and use disposable users.
function objectRequest(
  path,
  token,
  { method = 'GET', data, contentType = 'image/jpeg' } = {},
) {
  return fetch(new URL(`/storage/v1/object/${path}`, status.API_URL), {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: {
      apikey: status.ANON_KEY,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'content-type': contentType, 'x-upsert': 'true' } : {}),
    },
    ...(data ? { body: data } : {}),
  });
}

const missingPhoto = await save(tokens.clientA, {
  ...fields,
  attachAvatar: true,
});
assert.equal(
  missingPhoto.status,
  422,
  'The profile cannot attach a missing photo.',
);
const clientPath = `client-avatars/${users.clientA}/avatar.jpg`;
const photo = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACKADAAQAAAABAAAACAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgACAAIAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/Q2ST9qX/hqVURU/4VPsGTiDyfJ8jnn/AF/2jz/wx/s19h/6N/tUn/Lv/wACqCuc8SjR5b6t3d9f62P/2Q==',
    'base64',
  ),
);
for (const [path, token, type] of [
  [clientPath, tokens.clientB, 'image/jpeg'],
  [`client-avatars/${users.barberA}/avatar.jpg`, tokens.barberA, 'image/jpeg'],
  [clientPath, tokens.clientA, 'text/plain'],
]) {
  const denied = await objectRequest(path, token, {
    method: 'POST',
    data: photo,
    contentType: type,
  });
  assert.ok(
    denied.status >= 400 && denied.status < 500,
    'Storage denies wrong owner, role or content type.',
  );
}
for (let attempt = 0; attempt < 2; attempt++) {
  const uploaded = await objectRequest(clientPath, tokens.clientA, {
    method: 'POST',
    data: photo,
  });
  assert.equal(
    uploaded.status,
    200,
    'Owner can upload and replace the private image.',
  );
}
const attached = await save(tokens.clientA, { ...fields, attachAvatar: true });
assert.equal(attached.status, 200);
assertRawBody(
  attached.body,
  expected(users.clientA, true),
  'Attach avatar without disclosing its storage path.',
);
assert.equal(
  (await stored(users.clientA, tokens.clientA)).body[0].avatar_path,
  `${users.clientA}/avatar.jpg`,
);
assert.equal(
  (await objectRequest(`authenticated/${clientPath}`, tokens.clientA)).status,
  200,
);
for (const token of [undefined, tokens.clientB, tokens.barberA]) {
  const denied = await objectRequest(`authenticated/${clientPath}`, token);
  assert.ok(
    denied.status >= 400 && denied.status < 500,
    'Foreign and anonymous avatar downloads are denied.',
  );
}
const publicObject = await objectRequest(`public/${clientPath}`);
assert.ok(
  publicObject.status >= 400 && publicObject.status < 500,
  'No public avatar delivery.',
);

console.log(
  'Client profile passed: validation, protected contact fields and avatar, 18 parallel saves, normalised mobile, address-gated onboarding and unchanged verification.',
);
