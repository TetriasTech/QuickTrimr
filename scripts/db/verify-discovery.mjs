// Real local Auth → Edge → PostGIS → private Storage proof. Synthetic fixtures only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import { searchAvailableNowBarbersResponseSchema } from '../../packages/validation/src/index.ts';

import { apiJson, assertRawBody } from './api-test-helpers.mjs';
import { sqlValue } from './core-fixtures.mjs';
import { publicProfileFixtures } from './public-profile-fixtures.mjs';
import { queryLocal } from './verify.mjs';
assert.equal(process.argv.length, 2, 'Local proof takes no target overrides.');
const f = await publicProfileFixtures(),
  { users, tokens, status } = f;
const q = queryLocal,
  j = (sql) => JSON.parse(q(sql));
const point = "'SRID=4326;POINT(145.2 -38.2)'::extensions.geography";
const position = (meters, bearing = 0) =>
  `extensions.st_project(${point},${meters},${bearing})`;
const areaTwo = 'sal:2021:discovery-' + randomUUID(),
  sessionA = randomUUID(),
  sessionB = randomUUID();
const checks = [];
const record = (message) => {
  checks.push(message);
  console.log(message + ': PASS');
};
let category, second;
const search = (changes = {}, token = tokens.clientA) =>
  f.post('/functions/v1/search-available-now-barbers', token, {
    bookingType: 'available_now',
    serviceCategoryId: category,
    lat: -38.2,
    lng: 145.2,
    radiusKm: 10,
    ...changes,
  });
const profileFields = [
  'approximateArea',
  'availableUntil',
  'barberId',
  'displayName',
  'distanceBand',
  'photoUrl',
  'priceCents',
  'rating',
  'ratingCount',
].sort();
function publicOnly(body) {
  searchAvailableNowBarbersResponseSchema.parse(body);
  assert.deepEqual(Object.keys(body).sort(), ['nextCursor', 'results']);
  for (const row of body.results) {
    assert.deepEqual(Object.keys(row).sort(), profileFields);
    assert.deepEqual(Object.keys(row.approximateArea).sort(), [
      'id',
      'label',
      'mapPoint',
    ]);
    assert.deepEqual(Object.keys(row.approximateArea.mapPoint).sort(), [
      'lat',
      'lng',
    ]);
  }
}
const ids = (body) => body.results.map((r) => r.barberId);
try {
  const service = await f.createService(0);
  category = service.category.id;
  assert.equal(
    (
      await f.post('/functions/v1/upsert-barber-service', tokens.barberB, {
        serviceCategoryId: category,
        priceCents: 5000,
        enabled: true,
      })
    ).status,
    200,
  );
  q(`insert into public.public_areas(id,code,label,vintage,source_url,attribution,archive_sha256,boundary) values('${areaTwo}','${areaTwo}','QA Scheduled Area',2021,'https://example.invalid/synthetic-sal','Synthetic discovery only','${'a'.repeat(64)}','SRID=4326;MULTIPOLYGON(((145.1 -38.3,145.3 -38.3,145.3 -38.21,145.1 -38.21,145.1 -38.3)))');
 update public.public_areas set boundary='SRID=4326;MULTIPOLYGON(((145.1 -38.21,145.3 -38.21,145.3 -38.1,145.1 -38.1,145.1 -38.21)))' where id='${f.areaId}';
 update public.barber_profiles set service_area=${position(4000, Math.PI)},public_area_id='${areaTwo}' where id='${users.barberA}';
 update public.barber_profiles set service_area=${position(1000)},public_area_id='${f.areaId}' where id='${users.barberB}';
 insert into public.available_now_sessions(id,barber_id,location,status,location_source,radius_km,available_until,public_area_id) values
 ('${sessionA}','${users.barberA}',${position(1000)},'active','gps',12,clock_timestamp()+interval '1 hour','${f.areaId}'),
 ('${sessionB}','${users.barberB}',${position(20000)},'active','gps',12,clock_timestamp()+interval '1 hour','${areaTwo}');`);
  for (const [token, expected] of [
    [null, 401],
    ['invalid', 401],
    [tokens.barberA, 403],
    [tokens.admin, 403],
    [tokens.unprofiled, 403],
  ])
    assert.equal((await search({}, token)).status, expected);
  for (const bad of [
    { lat: 91 },
    { radiusKm: 0.999 },
    { radiusKm: 50.001 },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { cursor: 'readable-fake' },
    { bookingType: 'scheduled' },
    { role: 'admin' },
  ]) {
    const r = await search(bad);
    assert.equal(r.status, 422, `Validation: ${Object.keys(bad).join(',')}`);
    assert.ok(Object.keys(r.body.fields).length);
  }
  for (const path of ['get_discovery_config', 'search_nearby_barbers'])
    for (const token of [null, tokens.clientA, tokens.barberA, tokens.admin]) {
      const r = await f.post(
        '/rest/v1/rpc/' + path,
        token,
        path === 'get_discovery_config'
          ? {}
          : { p_client_id: users.clientA, p_request: {} },
      );
      assert.equal(r.status, token ? 403 : 401);
    }
  assert.equal(
    (
      await f.post(
        '/rest/v1/rpc/search_nearby_barbers',
        status.SERVICE_ROLE_KEY,
        { p_client_id: users.barberA, p_request: {} },
      )
    ).status,
    403,
  );
  for (const name of [
    'discovery_candidates',
    'discovery_bounds',
    'discovery_distance_band',
  ])
    for (const token of [
      tokens.clientA,
      tokens.barberA,
      tokens.admin,
      status.SERVICE_ROLE_KEY,
    ]) {
      const r = await apiJson(status, '/rest/v1/rpc/' + name, token, {
        method: 'POST',
        headers: { 'Content-Profile': 'private' },
        body: '{}',
      });
      assert.equal(r.status, 406);
      assert.equal(r.body.code, 'PGRST106');
    }
  record(
    'Real JWT/stored-role, forged metadata/identity, field validation and public/private RPC API denial; no private function execution probe',
  );
  const scheduled = {
    bookingType: 'scheduled',
    scheduledFor: new Date(Date.now() + 86400000).toISOString(),
  };
  let a = await search({ radiusKm: 2 }),
    b = await search({ ...scheduled, radiusKm: 2 });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assertRawBody(ids(a.body), [users.barberA], 'AN uses session');
  assertRawBody(ids(b.body), [users.barberB], 'Scheduled uses service area');
  a = await search();
  b = await search(scheduled);
  publicOnly(a.body);
  publicOnly(b.body);
  assert.equal(
    a.body.results.find((r) => r.barberId === users.barberA).approximateArea.id,
    f.areaId,
  );
  assert.equal(
    b.body.results.find((r) => r.barberId === users.barberA).approximateArea.id,
    areaTwo,
  );
  assert.equal(
    b.body.results.find((r) => r.barberId === users.barberA).availableUntil,
    null,
  );
  const image = await fetch(
    new URL(a.body.results[0].photoUrl, status.API_URL),
    { redirect: 'error' },
  );
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /^image\/jpeg/);
  q(
    `update public.available_now_sessions set location=${position(1000)},public_area_id='${f.areaId}' where id='${sessionB}';`,
  );
  a = await search();
  publicOnly(a.body);
  assert.equal(a.body.results.length, 2);
  assertRawBody(
    a.body.results[0].approximateArea.mapPoint,
    a.body.results[1].approximateArea.mapPoint,
    'One shared SAL point',
  );
  const expectedArea = j(
    `select jsonb_build_object('lat',extensions.st_y(map_point),'lng',extensions.st_x(map_point)) from public.public_areas where id='${f.areaId}'`,
  );
  assertRawBody(
    a.body.results[0].approximateArea.mapPoint,
    expectedArea,
    'Exact licensed-area point projection',
  );
  assert.equal(
    (await search({ userId: users.barberB, status: 'busy' })).status,
    200,
  );
  record(
    'Separate live/Scheduled geographies and areas; exact public allowlists; shared SAL point; actual signed JPEG download; Scheduled availableUntil null',
  );
  for (const change of [
    "account_status='requires_review'",
    'charges_enabled=false',
    'payouts_enabled=false',
  ]) {
    q(
      `update private.stripe_connect_accounts set ${change} where barber_id='${users.barberA}';`,
    );
    assert.ok(!ids((await search()).body).includes(users.barberA));
    assert.ok(!ids((await search(scheduled)).body).includes(users.barberA));
    q(
      `update private.stripe_connect_accounts set account_status='verified',charges_enabled=true,payouts_enabled=true where barber_id='${users.barberA}';`,
    );
  }
  q(
    `update public.profiles set verification_status='pending' where id='${users.barberA}';`,
  );
  assert.ok(!ids((await search()).body).includes(users.barberA));
  q(
    `update public.profiles set verification_status='verified' where id='${users.barberA}';`,
  );
  for (const state of [
    'expired',
    'busy',
    'manually_disabled',
    'auto_disabled',
    'cancelled',
  ]) {
    q(
      `update public.available_now_sessions set status='${state}' where id='${sessionA}'`,
    );
    assert.ok(!ids((await search()).body).includes(users.barberA));
  }
  q(
    `update public.available_now_sessions set status='active',available_until=clock_timestamp()-interval '1 second' where id='${sessionA}';`,
  );
  assert.ok(!ids((await search()).body).includes(users.barberA));
  q(
    `update public.available_now_sessions set available_until=clock_timestamp()+interval '1 hour',location=${position(2000)},radius_km=1 where id='${sessionA}';`,
  );
  assert.ok(!ids((await search()).body).includes(users.barberA));
  q(
    `update public.available_now_sessions set location=${position(1000)},radius_km=12 where id='${sessionA}'; update public.barber_profiles set service_radius_km=3 where id='${users.barberA}';`,
  );
  assert.ok(!ids((await search(scheduled)).body).includes(users.barberA));
  q(
    `update public.barber_profiles set service_radius_km=12 where id='${users.barberA}';`,
  );
  q(
    `update public.barber_services set archived_at=clock_timestamp() where barber_id='${users.barberA}' and service_category_id='${category}';`,
  );
  assert.ok(!ids((await search()).body).includes(users.barberA));
  q(
    `update public.barber_services set archived_at=null where barber_id='${users.barberA}' and service_category_id='${category}';`,
  );
  assertRawBody(
    (await search({ serviceCategoryId: randomUUID() })).body,
    { results: [], nextCursor: null },
    'Unknown category empty',
  );
  assertRawBody(
    (await search({ lat: 0, lng: 0, radiusKm: 1 })).body,
    { results: [], nextCursor: null },
    'No geographic match',
  );
  record(
    'Every Connect gate distinct from reliability restricted; all terminal/elapsed session states; both coverage radii and active category prices enforced',
  );
  for (const level of [
    'good_standing',
    'watch',
    'limited',
    'restricted',
    'suspended',
  ])
    for (const future of [false, true]) {
      q(
        `insert into public.barber_reliability_state(id,level,cooldown_until) values('${users.barberA}','${level}',clock_timestamp()+interval '${future ? '1 hour' : '-1 second'}') on conflict(id) do update set level=excluded.level,cooldown_until=excluded.cooldown_until;`,
      );
      assert.equal(
        ids((await search()).body).includes(users.barberA),
        level !== 'suspended' && !future,
      );
      assert.equal(
        ids((await search(scheduled)).body).includes(users.barberA),
        level !== 'suspended',
      );
    }
  // Exact cutoff integration through the private SQL seam, never a client clock.
  q(
    `update public.barber_reliability_state set level='restricted',cooldown_until='2030-01-01T01:00:00Z' where id='${users.barberA}';`,
  );
  for (const [time, expected] of [
    ['2030-01-01T00:59:59.999Z', false],
    ['2030-01-01T01:00:00Z', true],
    ['2030-01-01T01:00:00.001Z', true],
  ]) {
    q(
      `update public.available_now_sessions set available_until='2030-01-01T02:00:00Z' where id='${sessionA}';`,
    );
    const found = q(
      `select exists(select 1 from private.discovery_candidates('available_now','${category}',${point},10000,'${time}',null,50,public.get_discovery_config()) where barber_id='${users.barberA}')`.replace(
        'public.get_discovery_config()',
        "jsonb_build_object('pageSize',jsonb_build_object('max',50))",
      ),
    );
    assert.equal(found === 't', expected);
  }
  q(
    `update public.barber_reliability_state set level='good_standing',cooldown_until=null where id='${users.barberA}'; update public.available_now_sessions set available_until=clock_timestamp()+interval '1 hour' where id='${sessionA}';`,
  );
  record(
    'All five reliability levels with/without cooldown in both booking types; exact before/at/after cutoff through real query; no offence/history exposure',
  );
  // Persist fixture band boundary inputs only as synthetic distances, never logs of coordinates.
  for (const distance of [1999, 2001, 4999, 5001, 9999, 10001]) {
    q(
      `update public.available_now_sessions set location=${position(distance)},radius_km=50 where id='${sessionA}';`,
    );
    const r = (await search({ radiusKm: 50 })).body.results.find(
      (r) => r.barberId === users.barberA,
    );
    assert.equal(
      r.distanceBand,
      distance < 2000
        ? 'under-2km'
        : distance < 5000
          ? '2-5km'
          : distance < 10000
            ? '5-10km'
            : '10km+',
    );
  }
  q(
    `update public.available_now_sessions set location=${position(1000)},radius_km=12 where id='${sessionA}';`,
  );
  second = (await f.createService(1)).category.id;
  const bulk = j(
    `with u as(insert into auth.users(id) select gen_random_uuid() from generate_series(1,55) returning id),p as(insert into public.profiles(id,role,verification_status) select id,'barber','verified' from u returning id),b as(insert into public.barber_profiles(id,display_name,bio,years_experience,service_area,service_radius_km,public_area_id) select id,'QA Page','Synthetic',1,${position(1000)},12,'${f.areaId}' from p returning id) select jsonb_agg(id) from b`,
  );
  const bulkList = bulk.map(sqlValue).join(',');
  q(`insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled) select id,'acct_LocalFixturePlatform','acct_LocalFixture'||replace(id::text,'-',''),'verified',true,true from public.barber_profiles where id in (${bulkList});
 insert into public.barber_services(barber_id,service_category_id,price_cents) select id,'${second}',4551 from public.barber_profiles where id in (${bulkList});
 insert into public.available_now_sessions(barber_id,location,status,location_source,radius_km,available_until,public_area_id) select id,${position(1000)},'active','gps',12,clock_timestamp()+interval '1 hour','${f.areaId}' from public.barber_profiles where id in (${bulkList});
 insert into public.barber_reliability_state(id,level) select id,'restricted' from public.barber_profiles where id in (${bulk.slice(32).map(sqlValue).join(',')});`);
  const expected = [users.barberA, ...bulk.slice(0, 32)]
    .sort()
    .concat(bulk.slice(32).sort());
  let cursor = null;
  const seen = [];
  do {
    const r = await search({ serviceCategoryId: second, limit: 7, cursor });
    assert.equal(r.status, 200);
    publicOnly(r.body);
    assert.ok(r.body.results.length <= 7);
    seen.push(...ids(r.body));
    cursor = r.body.nextCursor;
  } while (cursor);
  assertRawBody(seen, expected, 'Stable cross-group tied pages');
  assert.equal(new Set(seen).size, 56);
  const first = await search({ serviceCategoryId: second, limit: 7 });
  const token = first.body.nextCursor;
  assert.equal(
    (
      await search(
        { serviceCategoryId: second, limit: 7, cursor: token },
        tokens.clientB,
      )
    ).status,
    422,
  );
  assert.equal(
    (await search({ serviceCategoryId: second, limit: 8, cursor: token }))
      .status,
    422,
  );
  q(
    `update private.stripe_connect_accounts set payouts_enabled=false where barber_id='${expected[7]}';`,
  );
  const next = await search({
    serviceCategoryId: second,
    limit: 7,
    cursor: token,
  });
  assert.ok(!ids(next.body).includes(expected[7]));
  q(
    `update private.platform_config set value='{"min":1,"max":3}' where key='discovery_radius_km';`,
  );
  assert.equal((await search({ radiusKm: 4 })).status, 422);
  q(
    `update private.platform_config set value='{"min":1,"max":50}' where key='discovery_radius_km';`,
  );
  record(
    '56 tied results across eight pages and reliability boundary: no gaps/duplicates; cross-client/filter/page-size cursor rejection; live gate revocation; runtime config changes',
  );
  // Far-away unpriced, unconnected synthetic rows exercise natural spatial selectivity.
  q(
    `with u as(insert into auth.users(id) select gen_random_uuid() from generate_series(1,3000) returning id),p as(insert into public.profiles(id,role,verification_status) select id,'barber','not_started' from u returning id),b as(insert into public.barber_profiles(id,service_area,service_radius_km,public_area_id) select id,'SRID=4326;POINT(-10 10)',12,'${f.areaId}' from p returning id) insert into public.available_now_sessions(barber_id,location,status,location_source,radius_km,available_until,public_area_id) select id,'SRID=4326;POINT(-10 10)','active','gps',12,clock_timestamp()+interval '1 hour','${f.areaId}' from b; analyze public.available_now_sessions;analyze public.barber_profiles;`,
  );
  mkdirSync('docs/qa/evidence/P2-T04', { recursive: true });
  for (const type of ['available_now', 'scheduled']) {
    const plan = j(
      `explain(format json) select * from private.discovery_candidates('${type}','${second}',${point},10000,statement_timestamp(),null,7,'{"pageSize":{"max":50}}'::jsonb)`,
    );
    const text = JSON.stringify(plan);
    writeFileSync(
      `docs/qa/evidence/P2-T04/${type}-plan.json`,
      JSON.stringify(plan, null, 2) + '\n',
    );
    assert.ok(
      text.includes(
        type === 'available_now'
          ? 'available_now_location_gist'
          : 'barber_service_area_gist',
      ),
      'Natural PostGIS GiST index plan required',
    );
  }
  record(
    'Natural EXPLAIN plans show the spatial GiST indexes in both booking types against 3,000 far-away rows; database applies global ordering before bounded keyset pages',
  );
} finally {
  if (category)
    q(`update private.platform_config set value='{"min":1,"max":50}' where key='discovery_radius_km';
 delete from public.available_now_sessions where id in ('${sessionA}','${sessionB}');
 do $$ declare ids uuid[];far_ids uuid[];begin select array_agg(b.id) into ids from public.barber_profiles b join auth.users u on u.id=b.id where b.public_area_id='${f.areaId}' and coalesce(u.email,'')='';
 select array_agg(b.id) into far_ids from public.barber_profiles b where b.id=any(ids) and not exists(select 1 from public.barber_services s where s.barber_id=b.id);
 delete from public.available_now_sessions where barber_id=any(ids);update public.barber_services set archived_at=clock_timestamp() where barber_id=any(ids) and archived_at is null;
 update public.barber_profiles set public_area_id=null where id=any(ids);update private.stripe_connect_accounts set charges_enabled=false,payouts_enabled=false where barber_id=any(ids);
 delete from private.stripe_connect_accounts where barber_id=any(far_ids);delete from public.barber_reliability_state where id=any(far_ids);delete from public.barber_profiles where id=any(far_ids);delete from public.profiles where id=any(far_ids);delete from auth.users where id=any(far_ids);end $$;`);
  await f.cleanup();
  q(`delete from public.public_areas where id='${areaTwo}';`);
}

writeFileSync(
  'docs/qa/evidence/P2-T04/api.json',
  JSON.stringify(
    {
      result: 'PASS',
      checks,
      providerCalls: 'Auth and private Storage only; no Google/Stripe',
      applicationReset: false,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({ result: 'PASS', checks, applicationReset: false }, null, 2),
);
