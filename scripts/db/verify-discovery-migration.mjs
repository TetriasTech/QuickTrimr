import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  discoveryBounds,
  discoveryDistanceBand,
} from '../../packages/domain/src/index.ts';

import { sqlValue } from './core-fixtures.mjs';
import { withIsolatedSchema } from './isolated-schema.mjs';
const kb = readFileSync('QUICKTRIMR_KNOWLEDGE_BASE.md', 'utf8');
const configValue = (id) =>
  JSON.parse(
    kb
      .split('\n')
      .find((line) => line.startsWith(`| \`${id}\` |`))
      .split(' | ')[1]
      .slice(1, -1),
  );
const config = {
  radiusKm: configValue('CFG-DISCOVERY-RADIUS-KM'),
  pageSize: configValue('CFG-DISCOVERY-PAGE-SIZE'),
  distanceBands: configValue('CFG-DISCOVERY-DISTANCE-BANDS'),
};
await withIsolatedSchema(async ({ query, replay, files }) => {
  const q = (sql) => query(sql).stdout.trim().split('\n').at(-1);
  const migration = '20261120160000_nearby_barber_search.sql';
  replay(files.filter((file) => file < migration));
  const user = randomUUID();
  q(
    `insert into auth.users(id)values('${user}');insert into public.profiles(id,role,verification_status)values('${user}','barber','not_started');insert into public.barber_profiles(id,display_name,bio,years_experience)values('${user}','Preserved fixture','Existing biography',3);`,
  );
  replay([migration]);
  assert.equal(
    q(
      `select display_name||':'||bio||':'||years_experience from public.barber_profiles where id='${user}'`,
    ),
    'Preserved fixture:Existing biography:3',
  );
  const actual = JSON.parse(
    q(
      `select set_config('request.jwt.claim.role','service_role',false);select public.get_discovery_config()`,
    ),
  );
  assert.deepEqual(actual, config);
  for (const radius of [0.999, 1, 1.5, 50, 50.001])
    for (const limit of [0, 1, 20, 50, 51])
      assert.deepEqual(
        JSON.parse(
          q(
            `select private.discovery_bounds(${radius},${limit},${sqlValue(JSON.stringify(config))}::jsonb)`,
          ),
        ),
        discoveryBounds(radius, limit, config).fields,
      );
  for (const distance of [
    0, 1999.999, 2000, 2000.001, 4999.999, 5000, 5000.001, 9999.999, 10000,
    10000.001,
  ])
    assert.equal(
      q(
        `select private.discovery_distance_band(${distance},${sqlValue(JSON.stringify(config.distanceBands))}::jsonb)`,
      ),
      discoveryDistanceBand(distance, config.distanceBands),
    );
  for (const role of ['anon', 'authenticated', 'service_role'])
    assert.equal(
      q(
        `select has_function_privilege('${role}','private.discovery_distance_band(double precision,jsonb)','execute')`,
      ),
      'f',
    );
  for (const role of ['anon', 'authenticated'])
    for (const fn of [
      'public.get_discovery_config()',
      'public.search_nearby_barbers(uuid,jsonb,jsonb)',
    ])
      assert.equal(
        q(`select has_function_privilege('${role}','${fn}','execute')`),
        'f',
      );
  assert.equal(
    q(
      "select has_function_privilege('service_role','public.search_nearby_barbers(uuid,jsonb,jsonb)','execute')",
    ),
    't',
  );
  console.log(
    'Full migration replay / populated upgrade preservation / exact config and ACLs / 25 bounds and 10 distance-band SQL-domain cases: PASS',
  );
});
