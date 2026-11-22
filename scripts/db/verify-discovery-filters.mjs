// P2-T05/P2-T07: local-only JWT/config/address isolation; no provider calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import { getDiscoveryFiltersResponseSchema } from '../../packages/validation/src/index.ts';

import { apiJson, makeUsers } from './api-test-helpers.mjs';
import { sqlValue } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal } from './verify.mjs';
assert.equal(process.argv.length, 2, 'Local proof accepts no overrides.');
const status = localStatus();
assert.equal(status.API_URL, 'http://127.0.0.1:55321');
const { users, tokens } = await makeUsers(status, {
  additional: ['admin', 'unprofiled'],
  adversarialMetadata: true,
});
const post = (path, token, input) =>
  apiJson(status, path, token, { method: 'POST', body: JSON.stringify(input) });
const read = (token, input = {}) =>
  post('/functions/v1/get-discovery-filters', token, input);
const a = randomUUID(),
  b = randomUUID();
const configKeys = [
  'scheduled_min_lead_minutes',
  'scheduled_max_horizon_days',
  'discovery_radius_km',
  'discovery_map_refresh_ms',
];
const old = JSON.parse(
  queryLocal(
    `select jsonb_object_agg(key,value) from private.platform_config where key in (${configKeys.map(sqlValue).join(',')});`,
  ),
);
try {
  for (const name of ['clientA', 'clientB', 'barberA'])
    assert.equal(
      (
        await post('/functions/v1/create-or-sync-profile', tokens[name], {
          role: name.startsWith('client') ? 'client' : 'barber',
        })
      ).status,
      200,
    );
  queryLocal(
    `insert into public.profiles(id,role,verification_status)values('${users.admin}','admin','not_started');insert into public.client_addresses(id,client_id,location,label,directory_id,line1,suburb,state,postcode,unit,access_notes)values('${a}','${users.clientA}','SRID=4326;POINT(145.2 -38.2)','Synthetic home','QA-FILTERS-A','1 Synthetic Test Street','Synthetic','VIC','3000','',''),('${b}','${users.clientB}','SRID=4326;POINT(145.3 -38.3)','Other synthetic home','QA-FILTERS-B','2 Synthetic Test Street','Synthetic','VIC','3000','','');`,
  );
  for (const [token, expected] of [
    [null, 401],
    ['invalid', 401],
    [tokens.barberA, 403],
    [tokens.admin, 403],
    [tokens.unprofiled, 403],
  ])
    assert.equal((await read(token)).status, expected);
  const invalid = await read(tokens.clientA, { addressId: 'malformed' });
  assert.equal(invalid.status, 422);
  assert.ok(invalid.body.fields.addressId);
  const start = Date.now(),
    base = await read(tokens.clientA),
    end = Date.now();
  assert.equal(base.status, 200);
  getDiscoveryFiltersResponseSchema.parse(base.body);
  assert.deepEqual(Object.keys(base.body).sort(), [
    'address',
    'map',
    'radiusKm',
    'scheduling',
    'serverNow',
  ]);
  assert.equal(base.body.address, null);
  assert.deepEqual(base.body.map, { refreshIntervalMs: 2000 });
  assert.ok(
    Date.parse(base.body.serverNow) >= start &&
      Date.parse(base.body.serverNow) <= end,
  );
  assert.deepEqual(base.body.scheduling, {
    minimumLeadMinutes: 240,
    maximumHorizonDays: 30,
  });
  assert.deepEqual(base.body.radiusKm, { min: 1, max: 50 });
  const own = await read(tokens.clientA, {
    addressId: a,
    userId: users.clientB,
  });
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.address, {
    id: a,
    label: 'Synthetic home',
    point: { lat: -38.2, lng: 145.2 },
  });
  assert.deepEqual(Object.keys(own.body.address).sort(), [
    'id',
    'label',
    'point',
  ]);
  queryLocal(
    `update public.client_addresses set directory_id=null where id='${a}';`,
  );
  const legacy = await read(tokens.clientA, { addressId: a });
  assert.equal(legacy.status, 422);
  queryLocal(
    `update public.client_addresses set directory_id='QA-FILTERS-A' where id='${a}';`,
  );
  const denied = await read(tokens.clientA, { addressId: b });
  assert.equal(denied.status, 422);
  assert.deepEqual(legacy.body, denied.body);
  assert.deepEqual(
    (await read(tokens.clientA, { addressId: randomUUID() })).body,
    denied.body,
  );
  queryLocal(
    `update public.client_addresses set archived_at=clock_timestamp() where id='${a}';`,
  );
  assert.deepEqual(
    (await read(tokens.clientA, { addressId: a })).body,
    denied.body,
  );
  for (const token of [tokens.clientA, tokens.barberA, tokens.admin])
    assert.equal(
      (
        await post('/rest/v1/rpc/get_client_discovery_filters', token, {
          p_client_id: users.clientB,
          p_address_id: b,
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await post(
        '/rest/v1/rpc/get_client_discovery_filters',
        status.SERVICE_ROLE_KEY,
        { p_client_id: users.barberA },
      )
    ).status,
    403,
  );
  queryLocal(
    `update private.platform_config set value='480' where key='scheduled_min_lead_minutes';update private.platform_config set value='7' where key='scheduled_max_horizon_days';update private.platform_config set value='{"min":3,"max":12}' where key='discovery_radius_km';`,
  );
  queryLocal(
    "update private.platform_config set value='3500' where key='discovery_map_refresh_ms';",
  );
  const changed = await read(tokens.clientA);
  assert.deepEqual(changed.body.map, { refreshIntervalMs: 3500 });
  for (const invalid of ['null', '0', '-1']) {
    queryLocal(
      `update private.platform_config set value='${invalid}' where key='discovery_map_refresh_ms';`,
    );
    assert.equal((await read(tokens.clientA)).status, 500);
  }
  queryLocal(
    "update private.platform_config set value='3500' where key='discovery_map_refresh_ms';",
  );
  assert.deepEqual(changed.body.scheduling, {
    minimumLeadMinutes: 480,
    maximumHorizonDays: 7,
  });
  assert.deepEqual(changed.body.radiusKm, { min: 3, max: 12 });
  queryLocal(
    `update private.platform_config set value='null' where key='scheduled_min_lead_minutes';`,
  );
  const fail = await read(tokens.clientA);
  assert.equal(fail.status, 500);
  assert.deepEqual(fail.body, { error: 'internal_error' });
} finally {
  for (const key of configKeys)
    queryLocal(
      `update private.platform_config set value=${sqlValue(JSON.stringify(old[key]))}::jsonb where key=${sqlValue(key)};`,
    );
  queryLocal(
    `update public.client_addresses set archived_at=coalesce(archived_at,clock_timestamp()) where id in ('${a}','${b}');`,
  );
  for (const id of Object.values(users))
    await apiJson(
      status,
      '/auth/v1/admin/users/' + id,
      status.SERVICE_ROLE_KEY,
      { method: 'DELETE', body: JSON.stringify({ should_soft_delete: true }) },
    );
}
const evidence = {
  result: 'PASS',
  localOnly: true,
  checks: [
    'Real Auth/invalid JWT and all wrong stored roles rejected before data',
    'Owner-only selected address point; identical foreign/missing/archived/unresolved-legacy rejection; forged identity ignored',
    'Strict public scheduling/radius/map projection, live server timestamp and no unrelated config',
    'Map cadence reads 2000 from platform config, changes to 3500 immediately, and null/zero/negative values fail closed',
    'Direct RPC denied to mobile roles; service RPC rechecks stored client role',
    'Live config changes immediately apply; invalid/missing config fails closed with generic error',
    'Owned synthetic addresses archived, Auth fixtures soft-deleted; original config restored; no database reset',
  ],
};
mkdirSync('docs/qa/evidence/P2-T07', { recursive: true });
writeFileSync(
  'docs/qa/evidence/P2-T07/api.json',
  JSON.stringify(evidence, null, 2) + '\n',
);
console.log(JSON.stringify(evidence, null, 2));
