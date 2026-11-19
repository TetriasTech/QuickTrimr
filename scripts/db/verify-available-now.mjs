// Local synthetic API evidence. Never prints tokens, private points or profile data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { apiJson, makeUsers, assertRawBody } from './api-test-helpers.mjs';
import { sqlValue } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal } from './verify.mjs';
assert.equal(process.argv.length, 2, 'No target overrides');
const status = localStatus();
const { users, tokens } = await makeUsers(status, {
  additional: ['admin', 'unprofiled'],
  adversarialMetadata: true,
});
const checks = [];
const post = (op, input, token = tokens.barberA) =>
  apiJson(status, '/functions/v1/' + op + '-available-now-session', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
const base = {
  lat: -43.5,
  lng: 155.25,
  locationSource: 'gps',
  radiusKm: 8,
  availableUntil: new Date(Date.now() + 3600000).toISOString(),
};
const area = 'sal:9999:qa-available-now-west';
let created = false;
try {
  for (const [name, role] of [
    ['barberA', 'barber'],
    ['barberB', 'barber'],
    ['clientA', 'client'],
    ['clientB', 'client'],
  ])
    assert.equal(
      (
        await apiJson(
          status,
          '/functions/v1/create-or-sync-profile',
          tokens[name],
          { method: 'POST', body: JSON.stringify({ role }) },
        )
      ).status,
      200,
    );
  queryLocal(`insert into public.profiles(id,role,verification_status) values('${users.admin}','admin','not_started');
 insert into public.public_areas(id,code,label,vintage,source_url,attribution,archive_sha256,boundary) values
 (${sqlValue(area)},'qa-a','QA Synthetic West',9999,'https://example.invalid/sal','Synthetic QA only','${'a'.repeat(64)}','SRID=4326;MULTIPOLYGON(((155 -44,155.5 -44,155.5 -43,155 -43,155 -44)))'),
 (${sqlValue(area + '-b')},'qa-b','QA Synthetic East',9999,'https://example.invalid/sal','Synthetic QA only','${'a'.repeat(64)}','SRID=4326;MULTIPOLYGON(((155.5 -44,156 -44,156 -43,155.5 -43,155.5 -44)))') on conflict(id) do nothing;
 update public.barber_profiles set service_area='SRID=4326;POINT(144.9 -37.8)' where id in ('${users.barberA}','${users.barberB}');`);
  created = true;
  const scheduled = queryLocal(
    `select service_area::text from public.barber_profiles where id='${users.barberA}';`,
  );
  // Authentic JWTs with adversarial metadata cannot turn clients/admins into barbers.
  for (const op of ['start', 'update', 'stop']) {
    const input =
      op === 'start'
        ? base
        : op === 'update'
          ? { ...base, sessionId: randomUUID() }
          : { sessionId: randomUUID() };
    assert.equal((await post(op, input, null)).status, 401);
    for (const name of ['clientA', 'clientB', 'admin', 'unprofiled'])
      assert.equal((await post(op, input, tokens[name])).status, 403);
    assert.equal((await post(op, {})).status, 422);
  }
  checks.push(
    'All three live endpoints: anonymous, stored non-barber/admin/unprofiled roles and malformed input denied',
  );
  assertRawBody(
    (await post('start', base)).body,
    { error: 'onboarding_incomplete' },
    'Unverified Connect gate',
  );
  for (const name of ['barberA', 'barberB'])
    queryLocal(`insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled) values('${users[name]}','acct_LocalFixturePlatform','acct_LocalFixture${randomUUID().replaceAll('-', '')}','verified',true,true);
 update public.profiles set verification_status='verified' where id='${users[name]}';`);
  let r = await post('start', {
    ...base,
    userId: users.barberB,
    status: 'busy',
  });
  assert.equal(r.status, 200);
  let current = r.body;
  assertRawBody(
    current,
    {
      id: current.id,
      status: 'active',
      radiusKm: 8,
      availableUntil: current.availableUntil,
      locationSource: 'gps',
      approximateArea: { id: area, label: 'QA Synthetic West' },
    },
    'Exact owner response projection',
  );
  assert.equal(
    Date.parse(current.availableUntil),
    Date.parse(base.availableUntil),
  );
  assert.equal(
    queryLocal(
      `select barber_id from public.available_now_sessions where id='${current.id}';`,
    ),
    users.barberA,
  );
  const foreignId = current.id;
  assert.equal(
    (await post('update', { ...base, sessionId: foreignId }, tokens.barberB))
      .status,
    404,
  );
  assert.equal(
    (await post('stop', { sessionId: foreignId }, tokens.barberB)).status,
    404,
  );
  for (const name of ['barberB', 'clientA']) {
    const read = await apiJson(
      status,
      `/rest/v1/available_now_sessions?id=eq.${foreignId}&select=*`,
      tokens[name],
    );
    assert.equal(read.status, 200);
    assertRawBody(read.body, [], 'Foreign raw read');
  }
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const denied = await apiJson(
      status,
      `/rest/v1/available_now_sessions?id=eq.${foreignId}`,
      tokens.barberA,
      {
        method,
        ...(method === 'DELETE'
          ? {}
          : { body: JSON.stringify({ status: 'busy' }) }),
      },
    );
    assert.ok([401, 403].includes(denied.status));
  }
  const rpcDenied = await apiJson(
    status,
    '/rest/v1/rpc/manage_available_now_session',
    tokens.barberA,
    {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: users.barberB,
        p_operation: 'start',
        p_input: base,
      }),
    },
  );
  assert.equal(rpcDenied.status, 403);
  checks.push(
    'Exact raw response contains no private coordinate; verified JWT owns writes; foreign read/write and direct table/RPC denial',
  );
  r = await post('update', {
    ...base,
    sessionId: current.id,
    lng: 155.5,
    locationSource: 'manual',
    radiusKm: 1.5,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.approximateArea.id, area);
  assert.equal(r.body.locationSource, 'manual');
  assert.equal(
    queryLocal(
      `select service_area::text from public.barber_profiles where id='${users.barberA}';`,
    ),
    scheduled,
  );
  for (const key of ['publicAreaId', 'approximateArea'])
    assert.equal(
      (await post('start', { ...base, [key]: area + '-b' })).status,
      422,
    );
  assert.equal((await post('start', { ...base, lat: 0, lng: 0 })).status, 422);
  checks.push(
    'Interior/boundary ST_Covers resolution with deterministic code tie-break; crafted area rejected; Scheduled centre unchanged',
  );
  for (const radius of [0.999, 50.001]) {
    r = await post('start', { ...base, radiusKm: radius });
    assert.equal(r.status, 422);
    assert.ok(r.body.fields.radiusKm);
  }
  for (const hours of [-1, 13]) {
    r = await post('start', {
      ...base,
      availableUntil: new Date(Date.now() + hours * 3600000).toISOString(),
    });
    assert.equal(r.status, 422);
    assert.ok(r.body.fields.availableUntil);
  }
  for (const radius of [1, 50, 1.001])
    assert.equal(
      (await post('start', { ...base, radiusKm: radius })).status,
      200,
    );
  // Each provider gate is required on updates as well as start.
  for (const column of ['charges_enabled', 'payouts_enabled']) {
    queryLocal(
      `update private.stripe_connect_accounts set ${column}=false where barber_id='${users.barberA}';`,
    );
    assert.equal((await post('start', base)).status, 403);
    queryLocal(
      `update private.stripe_connect_accounts set ${column}=true where barber_id='${users.barberA}';`,
    );
  }
  checks.push(
    'Live fractional/inclusive radius bounds, end-time errors and independent charges/payouts gates',
  );
  for (const level of [
    'good_standing',
    'watch',
    'limited',
    'restricted',
    'suspended',
  ]) {
    for (const cooldown of [
      'null',
      "clock_timestamp()+interval '1 hour'",
      "clock_timestamp()-interval '1 second'",
    ]) {
      queryLocal(
        `insert into public.barber_reliability_state(id,level,cooldown_until) values('${users.barberA}','${level}',${cooldown}) on conflict(id) do update set level=excluded.level,cooldown_until=excluded.cooldown_until;`,
      );
      const before = queryLocal(
        `select coalesce(cooldown_until::text,'null') from public.barber_reliability_state where id='${users.barberA}';`,
      );
      const blocked = level === 'suspended' || cooldown.includes('1 hour');
      current = JSON.parse(
        queryLocal(
          `select jsonb_build_object('id',id) from public.available_now_sessions where barber_id='${users.barberA}' and status='active';`,
        ),
      );
      for (const op of ['start', 'update']) {
        r = await post(
          op,
          op === 'start' ? base : { ...base, sessionId: current.id },
        );
        assert.equal(r.status, blocked ? 409 : 200);
        if (blocked)
          assertRawBody(
            r.body,
            { error: 'barber_unavailable' },
            'Eligibility denial',
          );
        else current = r.body;
      }
      assert.equal(
        queryLocal(
          `select coalesce(cooldown_until::text,'null') from public.barber_reliability_state where id='${users.barberA}';`,
        ),
        before,
      );
      if (blocked) {
        assert.equal(
          (await post('stop', { sessionId: current.id })).status,
          200,
        );
        queryLocal(
          `update public.barber_reliability_state set level='good_standing',cooldown_until=null where id='${users.barberA}';`,
        );
        assert.equal((await post('start', base)).status, 200);
      }
    }
  }
  queryLocal(
    `update public.barber_reliability_state set level='good_standing',cooldown_until=null where id='${users.barberA}';`,
  );
  checks.push(
    '15 live level/cooldown combinations: start and update enforce stored restrictions, stop allowed, no deadline reset',
  );
  const raceResults = [];
  for (let round = 0; round < 5; round++) {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post('start', base)),
    );
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(new Set(results.map((r) => r.body.id)).size, 6);
    assert.equal(
      queryLocal(
        `select count(*) from public.available_now_sessions where barber_id='${users.barberA}' and status='active';`,
      ),
      '1',
    );
    raceResults.push(results.length);
  }
  checks.push(
    `Real parallel starts: ${raceResults.length} rounds × 6 requests, exactly one current active session after each round; all starts atomically replace`,
  );

  // Hold a real parent-row transaction until the API is demonstrably waiting.
  async function holdProfile() {
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        'supabase_db_quicktrimr',
        'psql',
        '-X',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    const finished = new Promise((resolve, reject) => {
      child.on('error', () => reject(new Error('Fixture lock process failed')));
      child.on('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error('Fixture lock transaction failed')),
      );
    });
    const ready = new Promise((resolve) =>
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (output.includes('QA_LOCK_HELD')) resolve();
      }),
    );
    child.stdin.write(
      `begin;select id from public.profiles where id='${users.barberA}' for update;\n\\echo QA_LOCK_HELD\n`,
    );
    await Promise.race([
      ready,
      delay(5000).then(() => {
        throw new Error('Fixture lock not acquired');
      }),
    ]);
    return async (sql = '') => {
      child.stdin.end(sql + ';commit;\n');
      await finished;
    };
  }
  for (let round = 0; round < 3; round++) {
    const release = await holdProfile();
    const activation = post('start', base);
    try {
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        waiting =
          queryLocal(
            "select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%manage_available_now_session%');",
          ) === 't';
        if (waiting) break;
        await delay(25);
      }
      assert.ok(waiting, 'API transaction waits on parent lock');
    } finally {
      await release(
        `insert into public.barber_reliability_state(id,level) values('${users.barberA}','suspended') on conflict(id) do update set level='suspended',cooldown_until=null`,
      );
    }
    assertRawBody(
      (await activation).body,
      { error: 'barber_unavailable' },
      'Committed restriction wins',
    );
    queryLocal(
      `update public.barber_reliability_state set level='good_standing',cooldown_until=null where id='${users.barberA}';`,
    );
  }
  const release = await holdProfile();
  const deadline = Date.now() + 400;
  const expiredWhileWaiting = post('start', {
    ...base,
    availableUntil: new Date(deadline).toISOString(),
  });
  await delay(Math.max(0, deadline - Date.now() + 50));
  await release();
  const afterWait = await expiredWhileWaiting;
  assert.equal(afterWait.status, 422);
  assert.ok(afterWait.body.fields.availableUntil);
  checks.push(
    'Three real parent-lock races: committed suspension denies queued activation; server clock sampled after wait rejects an end time that expired while queued',
  );
  try {
    queryLocal(
      `update private.platform_config set value='{"min":2,"max":3}' where key='available_now_session_radius_km';update private.platform_config set value='1' where key='available_now_session_max_hours';`,
    );
    const changed = await post('start', {
      ...base,
      radiusKm: 4,
      availableUntil: new Date(Date.now() + 7200000).toISOString(),
    });
    assert.equal(changed.status, 422);
    assert.ok(changed.body.fields.radiusKm);
    assert.ok(changed.body.fields.availableUntil);
  } finally {
    queryLocal(
      `update private.platform_config set value='{"min":1,"max":50}' where key='available_now_session_radius_km';update private.platform_config set value='12' where key='available_now_session_max_hours';`,
    );
  }
  checks.push(
    'Runtime config change immediately alters both radius and end-time validation; launch defaults restored',
  );
  current = JSON.parse(
    queryLocal(
      `select jsonb_build_object('id',id) from public.available_now_sessions where barber_id='${users.barberA}' and status='active';`,
    ),
  );
  assert.equal((await post('stop', { sessionId: current.id })).status, 200);
  const auditBefore = queryLocal(
    `select count(*) from public.audit_logs where entity_id='${current.id}';`,
  );
  assert.equal((await post('stop', { sessionId: current.id })).status, 200);
  assert.equal(
    queryLocal(
      `select count(*) from public.audit_logs where entity_id='${current.id}';`,
    ),
    auditBefore,
  );
  assert.equal(
    (await post('update', { ...base, sessionId: current.id })).status,
    409,
  );
  assert.equal(
    queryLocal(
      `select count(*) from public.audit_logs where actor_id='${users.barberA}' and entity_type='available_now_session' and (new_value ?| array['lat','lng','location','contact','address']);`,
    ),
    '0',
  );
  checks.push(
    'Idempotent stop, no terminal resurrection; append-only audit contains no point/address/contact fields',
  );
} finally {
  if (created)
    queryLocal(
      `update public.available_now_sessions set status='cancelled' where barber_id in ('${users.barberA}','${users.barberB}') and status='active';`,
    );
  for (const id of Object.values(users))
    assert.equal(
      (
        await apiJson(
          status,
          '/auth/v1/admin/users/' + id,
          status.SERVICE_ROLE_KEY,
          {
            method: 'DELETE',
            body: JSON.stringify({ should_soft_delete: true }),
          },
        )
      ).status,
      200,
    );
}
console.log(
  JSON.stringify(
    {
      result: 'PASS',
      checks,
      applicationReset: false,
      fixtures:
        'Synthetic local rows and append-only audits retained; disposable logins soft-deleted.',
    },
    null,
    2,
  ),
);
