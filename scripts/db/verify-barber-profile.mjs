import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import {
  barberPhotoLimits,
  barberServiceRadiusKm,
} from '../../packages/shared/src/index.ts';

import {
  apiJson,
  assertDenied,
  assertRawBody,
  makeUsers,
} from './api-test-helpers.mjs';
import { localStatus } from './local-api.mjs';

const requirePhoto = createRequire(
  new URL(
    '../../supabase/functions/complete-barber-profile/package.json',
    import.meta.url,
  ),
);
const { encode } = requirePhoto('jpeg-js');
const status = localStatus();
const { users, tokens } = await makeUsers(status, {
  additional: ['admin'],
  adversarialMetadata: true,
});
const endpoint = '/functions/v1/complete-barber-profile';
const syncEndpoint = '/functions/v1/create-or-sync-profile';
const post = (path, token, body) =>
  apiJson(status, path, token, { method: 'POST', body: JSON.stringify(body) });
const save = (token, body) => post(endpoint, token, body);
const read = (token) => apiJson(status, endpoint, token);
const parkes = { serviceAreaLat: -35.3027, serviceAreaLng: 149.1293 };
const barton = { serviceAreaLat: -35.306, serviceAreaLng: 149.13 };
const basic = {
  displayName: 'Demo Barber',
  bio: 'Synthetic QA profile.',
  yearsExperience: 10,
  serviceRadiusKm: 12.5,
};
const jpeg = (width, height) =>
  encode(
    { width, height, data: new Uint8Array(width * height * 4).fill(173) },
    80,
  ).data;

async function upload(token, body, contentType = 'image/jpeg') {
  const response = await fetch(new URL(`${endpoint}/photo`, status.API_URL), {
    method: 'POST',
    headers: {
      apikey: status.ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': contentType,
    },
    body,
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  return { status: response.status, body: await response.json() };
}

for (const [user, role] of [
  ['barberA', 'barber'],
  ['barberB', 'barber'],
  ['clientA', 'client'],
])
  assert.equal((await post(syncEndpoint, tokens[user], { role })).status, 200);
assert.equal((await read()).status, 401);
assertRawBody(
  await read(tokens.barberA),
  { status: 200, body: { profile: null } },
  'First-time barber reads an empty profile',
);
for (const [route, input] of [
  [endpoint, { ...basic, ...parkes }],
  [`${endpoint}/search`, { query: 'King George Parkes' }],
]) {
  const denied = await post(route, tokens.clientA, input);
  assert.equal(denied.status, 403);
  assertRawBody(
    denied.body,
    { error: 'forbidden' },
    'Client cannot reach a barber operation',
  );
}
assert.equal((await upload(tokens.clientA, jpeg(2, 2))).status, 403);

const search = await post(`${endpoint}/search`, tokens.barberA, {
  query: '18 King George Parkes ACT',
});
assert.equal(search.status, 200);
const candidate = search.body.candidates.find(
  (entry) => entry.line1 === '18 KING GEORGE TCE',
);
assert.ok(
  candidate,
  'G-NAF fixture missing. Import ACT as described in the QA guide.',
);
assertRawBody(
  Object.keys(candidate).sort(),
  ['directoryId', 'line1', 'postcode', 'state', 'suburb', 'unit'],
  'Lookup does not contain coordinates',
);
assert.equal(
  (await post(`${endpoint}/search`, tokens.barberA, { query: 'x' })).status,
  422,
);

const radius = barberServiceRadiusKm;
for (const rejected of [radius.min - 0.01, radius.max + 0.01]) {
  const result = await save(tokens.barberA, {
    ...basic,
    ...parkes,
    serviceRadiusKm: rejected,
  });
  assert.equal(result.status, 422);
  assert.equal(typeof result.body.fields?.serviceRadiusKm, 'string');
}
for (const fields of [
  {},
  { serviceAreaLat: parkes.serviceAreaLat },
  { ...parkes, serviceAreaDirectoryId: candidate.directoryId },
  { serviceAreaLat: 0, serviceAreaLng: 0 },
]) {
  const result = await save(tokens.barberA, { ...basic, ...fields });
  assert.equal(result.status, 422);
  assert.equal(typeof result.body.fields?.serviceAreaDirectoryId, 'string');
}
const invalidPhotos = [
  [Buffer.from('not an image'), 'image/jpeg'],
  [jpeg(2, 2), 'image/png'],
  [Buffer.alloc(barberPhotoLimits.maxBytes + 1), 'image/jpeg'],
  [jpeg(barberPhotoLimits.maxPixelsPerSide + 1, 1), 'image/jpeg'],
];
for (const [bytes, contentType] of invalidPhotos) {
  const rejected = await upload(tokens.barberA, bytes, contentType);
  assert.equal(rejected.status, 422);
  assert.equal(typeof rejected.body.fields?.photo, 'string');
}

const marker = Buffer.from('Synthetic private EXIF marker');
const basicJpeg = jpeg(12, 12);
const comment = Buffer.concat([
  Buffer.from([255, 225, 0, marker.length + 2]),
  marker,
]);
const tagged = Buffer.concat([
  basicJpeg.subarray(0, 2),
  comment,
  basicJpeg.subarray(2),
]);
const photo = await upload(tokens.barberA, tagged);
assert.equal(photo.status, 200);
assert.match(photo.body.photoId, /^[0-9a-f]{64}$/);
assertRawBody(
  await upload(tokens.barberA, tagged),
  photo,
  'Same normalized upload produces one object key',
);
const stolen = await save(tokens.barberB, {
  ...basic,
  ...parkes,
  photoId: photo.body.photoId,
});
assert.equal(stolen.status, 422);
assert.equal(typeof stolen.body.fields?.photo, 'string');

const input = {
  ...basic,
  serviceAreaDirectoryId: candidate.directoryId,
  serviceRadiusKm: radius.min,
  photoId: photo.body.photoId,
  userId: users.barberB,
};
const saves = await Promise.all(
  Array.from({ length: 6 }, () => save(tokens.barberA, input)),
);
assert.ok(
  saves.every((result) => result.status === 200),
  'All parallel saves succeed.',
);
const first = saves[0].body;
assert.ok(
  saves.every((result) => result.body.id === users.barberA),
  'Body user ID never changes ownership.',
);
assertRawBody(
  Object.keys(first).sort(),
  [
    'approximateArea',
    'bio',
    'displayName',
    'id',
    'onboardingComplete',
    'photoUrl',
    'publishable',
    'serviceRadiusKm',
    'yearsExperience',
  ],
  'Owner save reply has no exact centre, photo ID or internal status',
);
assertRawBody(
  Object.keys(first.approximateArea).sort(),
  ['id', 'label', 'mapPoint'],
  'Public area has only approved fields',
);
assert.equal(first.approximateArea.id, 'sal:2026:80109');
assert.equal(first.serviceRadiusKm, radius.min);
assert.equal(first.onboardingComplete, false);
assert.equal(first.publishable, false);
assertRawBody(
  await read(tokens.barberB),
  { status: 200, body: { profile: null } },
  'Forged owner did not change other profile',
);

const link = new URL(first.photoUrl, status.API_URL);
assert.equal(link.origin, status.API_URL);
const signed = link.searchParams.get('token');
assert.ok(signed);
const { exp, iat } = JSON.parse(Buffer.from(signed.split('.')[1], 'base64url'));
assert.equal(exp - iat, barberPhotoLimits.signedUrlSeconds);
const download = await fetch(link, { redirect: 'error' });
assert.equal(download.status, 200);
assert.equal(download.headers.get('content-type'), 'image/jpeg');
assert.equal(
  Buffer.from(await download.arrayBuffer()).includes(marker),
  false,
  'Original image metadata was removed',
);
const unsigned = new URL(
  link.pathname.replace('/object/sign/', '/object/public/'),
  status.API_URL,
);
assert.ok(
  (await fetch(unsigned)).status >= 400,
  'Private storage denies unsigned access',
);

const audit = await apiJson(
  status,
  `/rest/v1/audit_logs?entity_id=eq.${users.barberA}&action=eq.barber.profile_saved&select=new_value`,
  status.SERVICE_ROLE_KEY,
);
assert.equal(audit.status, 200);
assertRawBody(
  audit.body,
  [{ new_value: { photoChanged: true, serviceAreaChanged: true } }],
  'Parallel profile saves append one privacy-safe audit event',
);
const areaUpdate = await save(tokens.barberB, {
  ...basic,
  serviceAreaLat: -35.303,
  serviceAreaLng: 149.13,
  serviceRadiusKm: radius.max,
});
assert.equal(areaUpdate.status, 200);
assertRawBody(
  areaUpdate.body.approximateArea,
  first.approximateArea,
  'Different private points share the same public representative point',
);
assert.equal(areaUpdate.body.serviceRadiusKm, radius.max);
const adjacent = await save(tokens.barberB, { ...basic, ...barton });
assert.equal(adjacent.status, 200);
assert.equal(adjacent.body.approximateArea.id, 'sal:2026:80022');
assert.equal(
  (await save(tokens.barberB, { ...basic, bio: 'Preserve point and radius.' }))
    .status,
  200,
);

const privateTable = `/rest/v1/barber_profiles?id=eq.${users.barberA}`;
await assertDenied(
  status,
  `${privateTable}&select=id,service_area`,
  tokens.barberB,
);
await assertDenied(
  status,
  `${privateTable}&select=id,service_area`,
  tokens.clientA,
);
const own = await apiJson(
  status,
  `${privateTable}&select=id,service_area`,
  tokens.barberA,
);
assert.equal(own.status, 200);
assert.ok(own.body[0]?.service_area, 'The owner saved an exact PostGIS point.');
const session = await apiJson(
  status,
  `/rest/v1/available_now_sessions?barber_id=eq.${users.barberA}&select=id`,
  tokens.barberA,
);
assertRawBody(
  session.body,
  [],
  'Saving Scheduled area does not create or mutate a live session',
);
const patched = await apiJson(status, privateTable, tokens.barberB, {
  method: 'PATCH',
  body: JSON.stringify({ service_area: 'POINT(0 0)' }),
});
assert.ok(
  patched.status === 403 ||
    (patched.status === 200 && patched.body.length === 0),
  'Cross-barber direct write denied',
);
for (const token of [tokens.clientA, tokens.barberA]) {
  await assertDenied(
    status,
    '/rest/v1/public_areas?select=id,label,boundary',
    token,
    { httpStatus: 403, code: '42501' },
  );
  for (const method of ['POST', 'PATCH', 'DELETE'])
    await assertDenied(
      status,
      '/rest/v1/public_areas?id=eq.sal:2026:80109',
      token,
      {
        method,
        ...(method !== 'DELETE' && { body: { label: 'Bypass' } }),
        httpStatus: 403,
        code: '42501',
      },
    );
}
const publicView = await apiJson(
  status,
  `/rest/v1/public_barber_profiles?id=eq.${users.barberA}`,
  tokens.clientA,
);
assert.equal(publicView.status, 200);
assertRawBody(
  publicView.body,
  [{ id: users.barberA }],
  'Unpublished barber exposes only the baseline public ID',
);
const directRpc = await post(
  '/rest/v1/rpc/manage_barber_profile',
  tokens.barberA,
  { p_user_id: users.barberB, p_request: { operation: 'read' } },
);
assert.equal(directRpc.status, 403);
const rawPublicShape = execFileSync(
  'docker',
  [
    'exec',
    'supabase_db_quicktrimr',
    'psql',
    '-XqAt',
    '-U',
    'postgres',
    '-c',
    `select row_to_json(t) from private.barber_public_profiles t where id = '${users.barberA}'`,
  ],
  { encoding: 'utf8' },
);
assertRawBody(
  JSON.parse(rawPublicShape),
  {
    id: users.barberA,
    display_name: basic.displayName,
    bio: basic.bio,
    years_experience: basic.yearsExperience,
    approximate_area: first.approximateArea,
  },
  'Reusable server-only public field projection',
);
console.log(
  'Verified live barber onboarding, private G-NAF and GPS points, two adjacent SALs, bounded radius, signed JPEGs, cross-role denial and parallel saves.',
);
