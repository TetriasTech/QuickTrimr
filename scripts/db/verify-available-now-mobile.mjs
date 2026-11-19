import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { ownAvailableNowStateSchema } from '../../packages/validation/src/index.ts';

import { apiJson, assertRawBody } from './api-test-helpers.mjs';
import {
  availabilityMobileFixtures,
  holdAvailabilityProfile,
} from './availability-mobile-fixtures.mjs';
import { sqlValue } from './core-fixtures.mjs';
import { queryLocal } from './verify.mjs';
assert.equal(process.argv.length, 2, 'No target overrides');
const f = await availabilityMobileFixtures();
const checks = [];
try {
  for (const name of ['clientA', 'clientB', 'admin', 'unprofiled'])
    assert.equal((await f.read(f.tokens[name])).status, 403);
  assert.equal((await f.read(null)).status, 401);
  assert.equal(
    (await f.read(f.tokens.barberA, '?userId=' + f.users.barberB)).status,
    422,
  );
  let r = await f.read();
  assert.equal(r.status, 200);
  let state = ownAvailableNowStateSchema.parse(r.body);
  assertRawBody(
    state.reliability,
    {
      level: 'good_standing',
      cooldownUntil: null,
      recoveryEligibleAt: null,
      reviewRequired: false,
      requiresHumanReinstatement: false,
      availableNowAllowed: true,
    },
    'Initial standing',
  );
  assert.equal(state.session, null);
  assert.deepEqual(state.config, {
    minRadiusKm: 1,
    maxRadiusKm: 50,
    maxHours: 12,
  });
  assertRawBody(
    (await f.read(f.tokens.barberB)).body.session,
    null,
    'Independent owner session',
  );
  let started = await f.write('start', f.input);
  assert.equal(
    started.status,
    200,
    'Manual directory lookup starts a real session',
  );
  r = await f.read();
  state = ownAvailableNowStateSchema.parse(r.body);
  assert.equal(state.session.id, started.body.id);
  assert.equal(state.session.isActive, true);
  assert.equal(state.session.locationSource, 'manual');
  assert.deepEqual(
    Object.keys(state.session).sort(),
    [
      'id',
      'status',
      'isActive',
      'radiusKm',
      'availableUntil',
      'locationSource',
      'approximateArea',
    ].sort(),
  );
  const point = queryLocal(
    `select location::text from public.available_now_sessions where id='${started.body.id}';`,
  );
  const updated = await f.write('update', {
    sessionId: started.body.id,
    keepLocation: true,
    radiusKm: 2.5,
    availableUntil: f.input.availableUntil,
  });
  assert.equal(updated.status, 200);
  assert.equal(
    queryLocal(
      `select location::text from public.available_now_sessions where id='${started.body.id}';`,
    ),
    point,
  );
  assert.equal(
    (
      await f.write(
        'update',
        {
          sessionId: started.body.id,
          keepLocation: true,
          radiusKm: 2.5,
          availableUntil: f.input.availableUntil,
        },
        f.tokens.barberB,
      )
    ).status,
    404,
  );
  for (let round = 0; round < 3; round++) {
    const release = await holdAvailabilityProfile(f.users.barberA);
    const updating = f.write('update', {
      sessionId: started.body.id,
      keepLocation: true,
      radiusKm: 2.5,
      availableUntil: f.input.availableUntil,
    });
    const nextPoint = `SRID=4326;POINT(${155.3 + round / 100} -43.5)`;
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        waiting =
          queryLocal(
            "select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%available_now_mobile_input%');",
          ) === 't';
        if (waiting) break;
        await delay(25);
      }
      assert.ok(
        waiting,
        'Location-preserving adapter waits on the profile parent before reading',
      );
    } finally {
      await release(
        `update public.available_now_sessions set location='${nextPoint}' where id='${started.body.id}'`,
      );
    }
    assert.equal((await updating).status, 200);
    // JSON/PostGIS double round-trips may differ below a micrometre; this
    // still distinguishes the old point (kilometres away) from the committed one.
    const metres = Number(
      queryLocal(
        `select extensions.st_distance(location,'${nextPoint}'::extensions.geography) from public.available_now_sessions where id='${started.body.id}';`,
      ),
    );
    assert.ok(
      metres < 0.000001,
      `Queued keep-location update must preserve committed point (difference ${metres}m)`,
    );
  }
  checks.push(
    'Three real parent-lock location races: queued keep-location updates preserve the concurrently committed point instead of restoring a stale point',
  );
  for (const crafted of [
    { ...f.input, lat: -43.5, lng: 155.25 },
    { ...f.input, locationSource: 'gps' },
    { ...f.input, directoryId: 'not-found' },
  ])
    assert.equal((await f.write('start', crafted)).status, 422);
  const inputSql = sqlValue(f.searchText);
  const oldPlan = JSON.parse(
    queryLocal(
      `explain(format json) with search_query as (select to_tsquery('pg_catalog.simple',coalesce(string_agg(quote_literal(token)||':*',' & '),'')) value from unnest(string_to_array(private.address_search_key(${inputSql}),' '))tokens(token) where token<>'') select a.id from private.address_directory a,search_query q where a.search_document@@q.value order by a.id limit 8;`,
    ),
  );
  const boundPlan = JSON.parse(
    queryLocal(
      `explain(format json) select a.id from private.address_directory a where a.search_document@@to_tsquery('pg_catalog.simple',${sqlValue(f.searchText + ':*')}) order by a.id limit 8;`,
    ),
  );
  function indexes(plan) {
    const names = [];
    function visit(n) {
      if (n['Index Name']) names.push(n['Index Name']);
      for (const child of n.Plans ?? []) visit(child);
    }
    visit(plan[0].Plan);
    return names;
  }
  const sourceRows = Number(
    queryLocal(
      "select reltuples::bigint from pg_class where oid='private.address_directory'::regclass;",
    ),
  );
  if (sourceRows > 10000)
    assert.ok(
      indexes(boundPlan).includes('address_directory_search_idx'),
      'Bound rare-prefix plan uses the GIN search index on imported data',
    );
  checks.push({
    addressSearchPlan: {
      estimatedSourceRows: sourceRows,
      priorQueryIndexes: indexes(oldPlan),
      boundQueryIndexes: indexes(boundPlan),
    },
  });
  const search = await f.post(
    '/functions/v1/complete-barber-profile/search',
    f.tokens.barberA,
    { query: f.searchText },
  );
  assert.equal(search.status, 200, 'Real manual directory search');
  assert.ok(
    search.body.candidates.some((c) => c.directoryId === f.directoryId),
  );
  checks.push(
    'Real owner GET: auth/role/query rejection, config projection, isolated owners, strict session fields; actual directory search/start; keep-location fractional edit; forged/unknown manual variants and foreign edits denied',
  );
  for (const level of [
    'good_standing',
    'watch',
    'limited',
    'restricted',
    'suspended',
  ]) {
    queryLocal(
      `insert into public.barber_reliability_state(id,level,cooldown_until,recovery_eligible_at) values('${f.users.barberA}','${level}',null,clock_timestamp()+interval '1 day') on conflict(id) do update set level=excluded.level,cooldown_until=null,recovery_eligible_at=excluded.recovery_eligible_at;`,
    );
    const before = queryLocal(
      `select row_to_json(r) from public.barber_reliability_state r where id='${f.users.barberA}';`,
    );
    state = ownAvailableNowStateSchema.parse((await f.read()).body);
    assert.equal(state.reliability.level, level);
    assert.equal(state.reliability.availableNowAllowed, level !== 'suspended');
    assert.equal(
      state.reliability.requiresHumanReinstatement,
      level === 'suspended',
    );
    assert.equal(
      state.reliability.reviewRequired,
      ['restricted', 'suspended'].includes(level),
    );
    assert.ok(state.reliability.recoveryEligibleAt);
    assert.equal(
      queryLocal(
        `select row_to_json(r) from public.barber_reliability_state r where id='${f.users.barberA}';`,
      ),
      before,
      'Reads do not mutate recovery',
    );
  }
  queryLocal(
    `update public.barber_reliability_state set level='restricted',cooldown_until=clock_timestamp()+interval '1 hour' where id='${f.users.barberA}';`,
  );
  state = ownAvailableNowStateSchema.parse((await f.read()).body);
  assert.equal(state.reliability.availableNowAllowed, false);
  assertRawBody(
    (await f.write('start', f.input)).body,
    { error: 'barber_unavailable' },
    'Stale activation denied',
  );
  assert.equal(
    (await f.write('stop', { sessionId: started.body.id })).status,
    200,
  );
  checks.push(
    'All five server-owned levels, optional recovery time, human review/reinstatement; reads preserve state; current cooldown blocks stale activation while stop succeeds',
  );
  for (const sessionStatus of [
    'active',
    'busy',
    'expired',
    'manually_disabled',
    'auto_disabled',
    'cancelled',
  ]) {
    queryLocal(
      `update public.available_now_sessions set status='${sessionStatus}' where id='${started.body.id}';`,
    );
    state = ownAvailableNowStateSchema.parse((await f.read()).body);
    assert.equal(state.session.status, sessionStatus);
    assert.equal(state.session.isActive, sessionStatus === 'active');
  }
  queryLocal(
    `update public.available_now_sessions set status='active',available_until=clock_timestamp()-interval '1 second' where id='${started.body.id}';`,
  );
  state = ownAvailableNowStateSchema.parse((await f.read()).body);
  assert.equal(state.session.isActive, false);
  assert.equal(state.session.status, 'active');
  for (const signature of [
    'get_available_now_state',
    'available_now_mobile_input',
  ]) {
    const denied = await apiJson(
      f.status,
      '/rest/v1/rpc/' + signature,
      f.tokens.barberA,
      {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: f.users.barberB,
          ...(signature.includes('input')
            ? { p_operation: 'start', p_input: f.input }
            : {}),
        }),
      },
    );
    assert.equal(denied.status, 403);
  }
  checks.push(
    'All session states and server elapsed-active projection; existing statuses preserved without implementing workers; new RPCs deny authenticated direct calls',
  );
} finally {
  await f.cleanup();
}
console.log(
  JSON.stringify(
    { result: 'PASS', checks, applicationReset: false, providerCalls: false },
    null,
    2,
  ),
);
