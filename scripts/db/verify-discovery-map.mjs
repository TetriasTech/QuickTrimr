// Local synthetic map proof. --hold keeps the two barbers for native UI checks.
// Credentials stay in memory; no Stripe calls, new grants or database reset.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import { discoveryMapAreas } from '../../packages/domain/src/index.ts';
import { searchAvailableNowBarbersResponseSchema } from '../../packages/validation/src/index.ts';

import { apiJson, makeUsers } from './api-test-helpers.mjs';
import { sqlValue } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal } from './verify.mjs';

assert.ok(
  process.argv.length === 2 ||
    (process.argv.length === 3 && process.argv[2] === '--hold'),
);
const status = localStatus();
assert.equal(status.API_URL, 'http://127.0.0.1:55321');
const { users, tokens } = await makeUsers(status, { additional: ['admin'] });
const post = (name, token, input) =>
  apiJson(status, '/functions/v1/' + name, token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
let categoryId;
try {
  for (const name of ['clientA', 'barberA', 'barberB']) {
    assert.equal(
      (
        await post('create-or-sync-profile', tokens[name], {
          role: name === 'clientA' ? 'client' : 'barber',
        })
      ).status,
      200,
    );
  }
  queryLocal(
    `insert into public.profiles(id,role,verification_status) values (${sqlValue(users.admin)},'admin','not_started');`,
  );
  const area = JSON.parse(
    queryLocal(
      `select jsonb_build_object('id',id,'label',label,'mapPoint',jsonb_build_object('lat',extensions.st_y(map_point),'lng',extensions.st_x(map_point))) from public.public_areas where id not like '%qa-%' and extensions.st_covers(boundary,extensions.st_setsrid(extensions.st_point(145.2,-38.2),4326)) limit 1`,
    ),
  );
  assert.ok(
    area?.id,
    'Import the public SAL dataset before the native map proof.',
  );
  const created = await post('create-service-category', tokens.admin, {
    slug: 'map-qa-' + randomUUID(),
    displayName: 'QA Map Haircut',
    description: 'Disposable local map QA category',
    displayOrder: 0,
    minPriceCents: 2000,
    maxPriceCents: 15000,
  });
  assert.equal(created.status, 200);
  categoryId = created.body.id;
  for (const [i, name] of ['barberA', 'barberB'].entries()) {
    assert.equal(
      (
        await post('complete-barber-profile', tokens[name], {
          displayName: i ? 'QA Map Barber Two' : 'QA Map Barber One',
          bio: 'Disposable synthetic local map verification.',
          yearsExperience: 10,
          serviceAreaLat: -38.2,
          serviceAreaLng: 145.2 + i / 10000,
          serviceRadiusKm: 12,
        })
      ).status,
      200,
    );
    queryLocal(`insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled) values (${sqlValue(users[name])},'acct_LocalFixturePlatform',${sqlValue('acct_LocalFixture' + randomUUID().replaceAll('-', ''))},'verified',true,true);
      update public.profiles set verification_status='verified' where id=${sqlValue(users[name])};
      update public.barber_profiles set public_area_id=${sqlValue(area.id)} where id=${sqlValue(users[name])};
      insert into public.available_now_sessions(barber_id,location,status,location_source,radius_km,available_until,public_area_id) values (${sqlValue(users[name])},'SRID=4326;POINT(145.2 -38.2)','active','gps',12,clock_timestamp()+interval '2 hours',${sqlValue(area.id)});`);
    // Supply facts are explicit local fixtures. This proof tests discovery, not
    // service management or real Stripe eligibility.
    queryLocal(
      `insert into public.barber_services(barber_id,service_category_id,price_cents) values (${sqlValue(users[name])},${sqlValue(categoryId)},${4550 + i * 100});`,
    );
  }
  const request = {
    bookingType: 'available_now',
    serviceCategoryId: categoryId,
    lat: -38.2,
    lng: 145.2,
    radiusKm: 10,
    limit: 1,
  };
  const first = await post(
    'search-available-now-barbers',
    tokens.clientA,
    request,
  );
  assert.equal(first.status, 200);
  searchAvailableNowBarbersResponseSchema.parse(first.body);
  assert.equal(first.body.results.length, 1);
  assert.ok(first.body.nextCursor);
  const next = await post('search-available-now-barbers', tokens.clientA, {
    ...request,
    cursor: first.body.nextCursor,
  });
  assert.equal(next.status, 200);
  searchAvailableNowBarbersResponseSchema.parse(next.body);
  assert.equal(next.body.results.length, 1);
  assert.equal(next.body.nextCursor, null);
  const loaded = [...first.body.results, ...next.body.results];
  for (const row of loaded) {
    assert.deepEqual(
      Object.keys(row).sort(),
      [
        'approximateArea',
        'availableUntil',
        'barberId',
        'displayName',
        'distanceBand',
        'photoUrl',
        'priceCents',
        'rating',
        'ratingCount',
      ].sort(),
    );
    assert.deepEqual(row.approximateArea, area);
  }
  const cluster = discoveryMapAreas(loaded);
  assert.deepEqual(cluster, [
    {
      areaId: area.id,
      label: area.label,
      mapPoint: area.mapPoint,
      loadedCount: 2,
    },
  ]);
  assert.deepEqual(discoveryMapAreas([...loaded, ...loaded]), cluster);
  mkdirSync('docs/qa/evidence/P2-T07', { recursive: true });
  writeFileSync(
    'docs/qa/evidence/P2-T07/map-api.json',
    JSON.stringify(
      {
        result: 'PASS',
        localOnly: true,
        checks: [
          'Two real JWT search pages contain only the strict public DTO; exact raw keys asserted',
          'Each result equals the database public SAL representative point; no barber coordinate, contact, exact distance or jitter field',
          'One cluster for two loaded barbers, with duplicate pages counted once',
          'Opaque cursor continuation used once; no hidden full traversal',
        ],
        publicArea: area,
        loadedCount: 2,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS: strict public map projection, opaque pages, one SAL cluster with two loaded matches.',
  );
  if (process.argv[2] === '--hold') {
    console.log(
      'Native QA ready: choose QA Map Haircut at the existing synthetic saved address. Send cleanup on stdin when finished.',
    );
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2 * 60 * 60 * 1000);
      process.stdin.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
      process.once('SIGTERM', () => {
        clearTimeout(timer);
        resolve();
      });
      process.once('SIGINT', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
} finally {
  if (categoryId) {
    // Service-role RPC preserves the existing synthetic admin's immutable audit attribution,
    // without renewing a login if native QA exceeded the Auth token lifetime.
    const archived = await apiJson(
      status,
      '/rest/v1/rpc/manage_service_category',
      status.SERVICE_ROLE_KEY,
      {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: users.admin,
          p_operation: 'archive',
          p_input: { id: categoryId },
        }),
      },
    );
    assert.equal(archived.status, 200, 'Archive the synthetic category');
  }
  const barberIds = [users.barberA, users.barberB].map(sqlValue).join(',');
  queryLocal(
    `update public.barber_services set archived_at=coalesce(archived_at,clock_timestamp()) where barber_id in (${barberIds}); update public.available_now_sessions set status='manually_disabled' where barber_id in (${barberIds}) and status='active';`,
  );
  for (const id of Object.values(users)) {
    const removed = await apiJson(
      status,
      '/auth/v1/admin/users/' + id,
      status.SERVICE_ROLE_KEY,
      { method: 'DELETE', body: JSON.stringify({ should_soft_delete: true }) },
    );
    assert.equal(removed.status, 200, 'Soft-delete synthetic login');
  }
  console.log(
    'Cleanup PASS: category/services archived, sessions disabled, synthetic logins soft-deleted; public dataset and audit history preserved.',
  );
}
