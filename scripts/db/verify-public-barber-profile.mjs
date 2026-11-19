import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { getPublicBarberProfileResponseSchema } from '../../packages/validation/src/index.ts';

import { apiJson, assertRawBody } from './api-test-helpers.mjs';
import { sqlValue } from './core-fixtures.mjs';
import { publicProfileFixtures } from './public-profile-fixtures.mjs';
import { queryLocal } from './verify.mjs';

assert.equal(process.argv.length, 2, 'Local verifier accepts no overrides.');
const f = await publicProfileFixtures();
const { users, tokens, status, post, read } = f;
const endpoint = '/functions/v1/get-public-barber-profile';
const checks = [];
const categories = [];
try {
  for (const [token, expected] of [
    [undefined, 401],
    [tokens.barberA, 403],
    [tokens.admin, 403],
    [tokens.unprofiled, 403],
  ]) {
    assert.equal(
      (await post(endpoint, token, { barberId: users.barberA })).status,
      expected,
    );
  }
  assert.equal(
    (await post(endpoint, 'invalid', { barberId: users.barberA })).status,
    401,
  );
  for (const body of [
    { barberId: 'bad' },
    { barberId: users.barberA, servicesAfter: {} },
    { barberId: users.barberA, service_area: 'forged' },
  ]) {
    const result = await post(endpoint, tokens.clientA, body);
    assert.equal(result.status, 422);
    assert.ok(Object.keys(result.body.fields).length);
  }
  for (const token of [
    undefined,
    tokens.clientA,
    tokens.barberA,
    tokens.admin,
  ]) {
    assert.equal(
      (
        await post('/rest/v1/rpc/get_public_barber_profile', token, {
          p_client_id: users.clientA,
          p_barber_id: users.barberA,
        })
      ).status,
      token ? 403 : 401,
    );
  }
  const sqlDenied = await post(
    '/rest/v1/rpc/get_public_barber_profile',
    status.SERVICE_ROLE_KEY,
    { p_client_id: users.barberA, p_barber_id: users.barberA },
  );
  assert.equal(sqlDenied.status, 403);
  checks.push(
    'Auth/invalid JWT/stored role/unprofiled/forged body/cursor/DB recheck/direct RPC denial',
  );

  for (let i = 0; i < 25; i++) categories.push(await f.createService(i));
  const first = await read();
  assert.equal(first.status, 200);
  const profile = first.body.profile;
  getPublicBarberProfileResponseSchema.parse(first.body);
  const { photoUrl, ...fields } = profile;
  const area = JSON.parse(
    queryLocal(
      `select json_build_object('id',id,'label',label,'mapPoint',json_build_object('lat',extensions.st_y(map_point),'lng',extensions.st_x(map_point))) from public.public_areas where id=${sqlValue(f.areaId)};`,
    ),
  );
  const publicService = ({ category, service }) => ({
    id: service.id,
    serviceCategoryId: category.id,
    displayName: category.displayName,
    description: category.description,
    priceCents: service.priceCents,
  });
  assertRawBody(
    fields,
    {
      barberId: users.barberA,
      displayName: 'Marcus Demo',
      bio: 'Synthetic mobile barber profile for QuickTrimr QA.',
      yearsExperience: 10,
      approximateArea: area,
      rating: null,
      ratingCount: 0,
      services: categories.slice(0, 20).map(publicService),
      nextServicesCursor: {
        displayOrder: 19,
        slug: categories[19].category.slug,
        id: categories[19].service.id,
      },
    },
    'Every raw public field matches its explicit allowlist',
  );
  for (const key of [
    'service_area',
    'serviceAreaLat',
    'serviceAreaLng',
    'serviceRadiusKm',
    'service_radius_km',
    'email',
    'mobile',
    'phone',
    'stripeAccountId',
    'verificationStatus',
    'photoId',
    'photo_id',
    'storagePath',
    'location',
    'lat',
    'lng',
    'distance',
    'onboardingComplete',
    'created_at',
    'updated_at',
  ])
    assert.equal(key in profile, false, key);
  const photo = await fetch(new URL(photoUrl, status.API_URL), {
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(photo.status, 200);
  assert.match(photo.headers.get('content-type'), /^image\/jpeg/);
  const own = await apiJson(
    status,
    '/functions/v1/complete-barber-profile',
    tokens.barberA,
  );
  assert.equal(
    own.status,
    200,
    'Existing owner profile read still works with the shared signer',
  );
  assert.equal(own.body.profile.id, users.barberA);
  assert.equal(own.body.profile.serviceRadiusKm, 12);
  const ownerPhoto = await fetch(
    new URL(own.body.profile.photoUrl, status.API_URL),
    { redirect: 'error', signal: AbortSignal.timeout(10000) },
  );
  assert.equal(
    ownerPhoto.status,
    200,
    'Existing owner photo URL remains usable',
  );
  assert.match(ownerPhoto.headers.get('content-type'), /^image\/jpeg/);
  const second = await read(
    users.barberA,
    tokens.clientB,
    profile.nextServicesCursor,
  );
  assertRawBody(
    second.body.profile.services,
    categories.slice(20).map(publicService),
    'Remaining catalogue-order page',
  );
  assert.equal(second.body.profile.nextServicesCursor, null);
  assert.equal(
    new Set(
      [...profile.services, ...second.body.profile.services].map((s) => s.id),
    ).size,
    25,
  );
  const other = await read(users.barberB);
  assertRawBody(
    other.body.profile.approximateArea,
    area,
    'Different private centres share the same SAL point',
  );
  assertRawBody(
    other.body.profile.services,
    [],
    'Eligible profile with no active services',
  );
  assert.equal(other.body.profile.photoUrl, null);
  assert.equal(
    queryLocal(
      `select extensions.st_equals(b.service_area::extensions.geometry,a.map_point) from public.barber_profiles b join public.public_areas a on a.id=b.public_area_id where b.id=${sqlValue(users.barberA)};`,
    ),
    'f',
  );
  checks.push(
    'Raw exact allowlists at every level; no private fields; signed JPEG from both public and existing owner reads; shared SAL point; 20+5 pages without gaps; no-review/no-service/null-photo branches',
  );

  const selected = categories[0];
  assert.equal(
    (
      await post('/functions/v1/upsert-barber-service', tokens.barberA, {
        serviceCategoryId: selected.category.id,
        priceCents: 4625,
        enabled: true,
      })
    ).status,
    200,
  );
  assert.equal((await read()).body.profile.services[0].priceCents, 4625);
  assert.equal(
    (
      await post('/functions/v1/archive-barber-service', tokens.barberA, {
        serviceId: selected.service.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (await read()).body.profile.services.some(
      (s) => s.id === selected.service.id,
    ),
    false,
  );
  const archived = categories[1];
  assert.equal(
    (
      await post('/functions/v1/archive-service-category', tokens.admin, {
        id: archived.category.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (await read()).body.profile.services.some(
      (s) => s.id === archived.service.id,
    ),
    false,
  );
  checks.push(
    'Current 4550→4625 integer-cent price; archived barber service and archived category excluded',
  );

  assertRawBody(
    (await read(randomUUID())).body,
    { profile: null },
    'Unknown target',
  );
  for (const gate of ['charges_enabled', 'payouts_enabled']) {
    queryLocal(
      `update private.stripe_connect_accounts set ${gate}=false where barber_id=${sqlValue(users.barberA)};`,
    );
    assertRawBody(
      (await read()).body,
      { profile: null },
      'Lost eligibility gate',
    );
    queryLocal(
      `update private.stripe_connect_accounts set ${gate}=true where barber_id=${sqlValue(users.barberA)};`,
    );
  }
  queryLocal(
    `update public.barber_profiles set display_name=null where id=${sqlValue(users.barberB)};`,
  );
  assertRawBody(
    (await read(users.barberB)).body,
    { profile: null },
    'Incomplete profile',
  );
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    for (const table of ['barber_profiles', 'barber_services']) {
      const result = await apiJson(
        status,
        `/rest/v1/${table}?${table === 'barber_profiles' ? 'id' : 'barber_id'}=eq.${users.barberA}`,
        tokens.clientA,
        {
          method,
          ...(['POST', 'PATCH'].includes(method) ? { body: '{}' } : {}),
        },
      );
      if (result.status === 200)
        assertRawBody(result.body, [], `${method} foreign ${table}`);
      else
        assert.ok(
          [400, 401, 403, 404, 405].includes(result.status),
          'Raw-table denial',
        );
    }
  }
  const privateSelection = await apiJson(
    status,
    `/rest/v1/public_barber_profiles?select=id,service_area&id=eq.${users.barberA}`,
    tokens.clientA,
  );
  assert.equal(privateSelection.status, 400);
  checks.push(
    'Unknown/incomplete/revoked Connect targets unavailable; raw profile/services read and write denial; private column cannot be selected',
  );
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        localOnly: true,
        providerCalls: 0,
        services: 25,
        checks,
      },
      null,
      2,
    ),
  );
} finally {
  await f.cleanup();
}
