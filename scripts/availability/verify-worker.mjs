import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { sqlValue } from '../db/core-fixtures.mjs';

import {
  workerTarget,
  workerApi,
  workerSql,
  workerRequest,
  workerConfig,
} from './worker-operator.mjs';
assert.ok(
  process.argv.length === 3 ||
    (process.argv.length === 4 && process.argv[3] === '--capacity-only'),
  'Use local or hosted, optionally --capacity-only; no target overrides.',
);
const capacityOnly = process.argv[3] === '--capacity-only';
const target = workerTarget(process.argv[2]),
  api = workerApi(target),
  config = workerConfig('CFG-AVAIL-WORKER-OPERATIONS');
const sql = (text) => workerSql(target, text);
const row = (expression) => sql(`select to_jsonb(${expression}) as result;`);
const roles = {
  barberA: 'barber',
  barberB: 'barber',
  ...(capacityOnly
    ? {}
    : { clientA: 'client', clientB: 'client', admin: 'admin' }),
};
const users = {},
  tokens = {};
const jobs = row(
  `(select jsonb_agg(jsonb_build_object('id',jobid,'active',active,'name',jobname)) from cron.job where jobname in ('quicktrimr.available_now.expiry','quicktrimr.available_now.health'))`,
);
assert.equal(jobs.length, 2, 'Install both feature schedules first.');
const pause = (active) =>
  sql(
    `do $$ begin ${jobs.map((j) => `perform cron.alter_job(${j.id},active:=${active});`).join('\n')} end $$;`,
  );
const sessionIds = [];
const evidence = resolve('docs/qa/evidence', `P2-T03-${target.name}`);
mkdirSync(evidence, { recursive: true });
let peakArea;
try {
  pause(false);
  for (const [name, role] of Object.entries(roles)) {
    const email = `worker-${randomUUID()}@example.invalid`,
      password = randomUUID() + randomUUID();
    const created = await workerRequest(
      api,
      '/auth/v1/admin/users',
      api.SERVICE_ROLE_KEY,
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { role: 'service_role' },
        }),
      },
    );
    assert.equal(created.status, 200, 'Create disposable worker fixture user.');
    users[name] = created.body.id;
    const login = await workerRequest(
      api,
      '/auth/v1/token?grant_type=password',
      api.ANON_KEY,
      { method: 'POST', body: JSON.stringify({ email, password }) },
    );
    assert.equal(login.status, 200, 'Sign in disposable fixture.');
    tokens[name] = login.body.access_token;
    sql(`insert into public.profiles(id,role,verification_status) values('${users[name]}','${role}','not_started');
   ${role === 'admin' ? '' : `insert into public.${role === 'barber' ? 'barber_profiles' : 'client_profiles'}(id) values('${users[name]}');`}`);
  }
  const newSession = (
    deadline = "clock_timestamp()+interval '1 hour'",
    misses = 0,
  ) => {
    sql(
      `update public.available_now_sessions set status='cancelled' where barber_id='${users.barberA}' and status='active';`,
    );
    const id = randomUUID();
    sessionIds.push(id);
    sql(
      `insert into public.available_now_sessions(id,barber_id,location,status,available_until,consecutive_misses) values('${id}','${users.barberA}','SRID=4326;POINT(155 -43)','active',${deadline},${misses});`,
    );
    return id;
  };
  if (!capacityOnly) {
    let id = newSession();
    sql(
      `update public.available_now_sessions set consecutive_misses=(select (value::text)::integer from private.platform_config where key='missed_request_threshold') where id='${id}';`,
    );
    const path = '/functions/v1/auto-disable-unresponsive-barber';
    for (const token of [null, api.ANON_KEY, ...Object.values(tokens)]) {
      const denied = await workerRequest(api, path, token, {
        method: 'POST',
        body: JSON.stringify({ sessionId: id }),
      });
      assert.ok(
        [401, 403].includes(denied.status),
        'Mobile/admin/anonymous worker denial.',
      );
    }
    const bad = await workerRequest(api, path, api.SERVICE_ROLE_KEY, {
      method: 'POST',
      body: JSON.stringify({
        sessionId: id,
        misses: 100,
        now: new Date().toISOString(),
      }),
    });
    assert.equal(
      bad.status,
      422,
      'Worker rejects client-supplied policy/clock.',
    );
    for (let round = 0; round < 5; round++) {
      if (round) {
        id = newSession();
        sql(
          `update public.available_now_sessions set consecutive_misses=(select (value::text)::integer from private.platform_config where key='missed_request_threshold') where id='${id}';`,
        );
      }
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          workerRequest(api, path, api.SERVICE_ROLE_KEY, {
            method: 'POST',
            body: JSON.stringify({ sessionId: id }),
          }),
        ),
      );
      for (const r of responses)
        assert.equal(r.status, 200, 'Privileged worker response.');
      assert.equal(
        responses.filter((r) => r.body.applied).length,
        1,
        'Exactly one concurrent API effect.',
      );
      assert.ok(responses.every((r) => r.body.status === 'auto_disabled'));
    }
    console.log(
      'Five real six-request API races and every unpermitted role: PASS',
    );
    const privateTables = [
      'available_now_request_receipts',
      'available_now_worker_state',
      'available_now_worker_runs',
      'available_now_worker_failures',
      'available_now_monitor_deliveries',
    ];
    for (const table of privateTables) {
      assert.equal(
        row(
          `(select relrowsecurity from pg_class where oid='private.${table}'::regclass)`,
        ),
        true,
      );
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE'])
        for (const token of [
          api.ANON_KEY,
          tokens.clientA,
          tokens.clientB,
          tokens.barberA,
          tokens.barberB,
          tokens.admin,
          api.SERVICE_ROLE_KEY,
        ]) {
          const r = await workerRequest(api, `/rest/v1/${table}`, token, {
            method,
            headers: {
              'Accept-Profile': 'private',
              'Content-Profile': 'private',
            },
            ...(method === 'GET' ? {} : { body: '{}' }),
          });
          assert.ok(
            [401, 403, 404, 406].includes(r.status),
            'Private table denied at API for every verb/role.',
          );
        }
    }
    for (const [schema, table] of [
      ['cron', 'job'],
      ['net', 'http_request_queue'],
      ['vault', 'decrypted_secrets'],
    ]) {
      const r = await workerRequest(api, `/rest/v1/${table}`, tokens.barberA, {
        headers: { 'Accept-Profile': schema },
      });
      assert.equal(
        r.status,
        406,
        'Managed infrastructure schema remains excluded.',
      );
      assert.equal(
        r.body?.code,
        'PGRST106',
        'Explicit schema-exclusion rejection required.',
      );
    }
    const own = await workerRequest(
      api,
      `/rest/v1/available_now_sessions?id=eq.${id}&select=id,status`,
      tokens.barberA,
    );
    const other = await workerRequest(
      api,
      `/rest/v1/available_now_sessions?id=eq.${id}&select=id,status`,
      tokens.barberB,
    );
    assert.equal(own.status, 200);
    assert.equal(own.body.length, 1);
    assert.deepEqual(other.body, []);
    console.log(
      'RLS enabled, private/managed schemas denied at API, owner/cross-owner read: PASS',
    );
    // Native row locks are the durable claims: aborting a batch releases them and
    // rolls back effects/audits. Only the local proof needs process termination;
    // hosted proof uses an explicit transaction rollback through Management API.
    id = newSession("clock_timestamp()-interval '1 second'");
    if (target.name === 'local') {
      const app = `quicktrimr46-${randomUUID()}`;
      const child = spawn(
        'docker',
        [
          'exec',
          '-i',
          'supabase_db_quicktrimr',
          'env',
          `PGAPPNAME=${app}`,
          'psql',
          '-XqAt',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-v',
          'ON_ERROR_STOP=1',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let output = '';
      let done;
      const stopped = new Promise((resolve) => {
        done = resolve;
      });
      child.stderr.resume();
      child.on('close', () => done());
      const claimed = new Promise((resolve, reject) => {
        child.stdout.on('data', (b) => {
          output += String(b);
          if (output.includes('CLAIMED')) resolve();
        });
        child.on('error', () =>
          reject(new Error('Interrupted-claim process failed')),
        );
        child.on('close', () => {
          if (!output.includes('CLAIMED'))
            reject(new Error('Claim did not execute'));
        });
      });
      child.stdin.end(
        "begin; select private.run_available_now_expiry(); select 'CLAIMED'; select pg_sleep(30); commit;",
      );
      await claimed;
      row(
        `jsonb_build_object('terminated',(select bool_and(pg_terminate_backend(pid)) from pg_stat_activity where application_name=${sqlValue(app)} and datname=current_database()))`,
      );
      await stopped;
    } else {
      const app = `quicktrimr46-${randomUUID()}`;
      const statement = `begin; set local application_name=${sqlValue(app)}; select private.run_available_now_expiry(); select pg_sleep(30); commit;`;
      const child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {workerTarget,workerSql} from './scripts/availability/worker-operator.mjs'; try { workerSql(workerTarget('hosted'),${JSON.stringify(statement)}); } catch { process.exitCode=0; }`,
        ],
        { stdio: 'ignore' },
      );
      const stopped = new Promise((resolve) => child.on('close', resolve));
      const deadline = Date.now() + 30000;
      while (
        row(
          `(select count(*) from pg_stat_activity where application_name=${sqlValue(app)} and wait_event='PgSleep')`,
        ) !== 1
      ) {
        assert.ok(
          Date.now() < deadline,
          'Hosted transaction did not reach the interrupted claim.',
        );
        await delay(300);
      }
      assert.equal(
        row(
          `(select bool_and(pg_terminate_backend(pid)) from pg_stat_activity where application_name=${sqlValue(app)} and datname=current_database())`,
        ),
        true,
      );
      await stopped;
    }
    assert.equal(
      row(
        `(select status from public.available_now_sessions where id='${id}')`,
      ),
      'active',
      'Interrupted batch rolls back.',
    );
    const auditBefore = row(
      `(select count(*) from public.audit_logs where entity_id='${id}')`,
    );
    const restored = row('private.run_available_now_expiry()');
    assert.equal(restored.outcome, 'succeeded');
    assert.equal(
      row(
        `(select status from public.available_now_sessions where id='${id}')`,
      ),
      'expired',
    );
    row('private.run_available_now_expiry()');
    assert.equal(
      row(`(select count(*) from public.audit_logs where entity_id='${id}')`),
      auditBefore + 1,
    );
    console.log(
      'Interrupted claim/transaction, authoritative retry, single committed audit: PASS',
    );
    // Dropped schedule: stay pending while stopped, then recover through a REAL tick.
    id = newSession('clock_timestamp()');
    assert.equal(
      row(
        `(select status from public.available_now_sessions where id='${id}')`,
      ),
      'active',
    );
    pause(true);
    const recoveryEnd =
      Date.now() + config.peakExpiryLatenessSecondsExclusive * 1000;
    while (
      row(
        `(select status from public.available_now_sessions where id='${id}')`,
      ) === 'active'
    ) {
      assert.ok(
        Date.now() < recoveryEnd,
        'Real scheduler recovery exceeded the approved window.',
      );
      await delay(300);
    }
    pause(false);
    console.log(
      'Stopped scheduler resumed and recovered an unscheduled due entity: PASS',
    );
    // Exact health semantics are evaluated by the private pure seam; no RPC accepts
    // arbitrary time. Run state and failure records remain server-owned.
    for (const [last, oldest, failed, now, healthy] of [
      [0, 60000, 0, 120000, true],
      [0, null, 0, 120001, false],
      [120000, 60000, 0, 120001, false],
      [120000, null, 1, 120000, false],
    ]) {
      const t = (v) => (v === null ? 'null' : `to_timestamp(${v}/1000.0)`);
      const h = row(
        `private.available_now_health_effect(${t(last)},${t(oldest)},${failed},${t(now)},${sqlValue(JSON.stringify(config))}::jsonb)`,
      );
      assert.equal(h.healthy, healthy);
    }
  }
  peakArea = `sal:9997:worker-${randomUUID()}`;
  sql(`insert into public.public_areas(id,code,label,vintage,source_url,attribution,archive_sha256,boundary) values(${sqlValue(peakArea)},${sqlValue(peakArea)},'Synthetic worker capacity area',9997,'https://example.invalid/worker','Synthetic test only','${'a'.repeat(64)}','SRID=4326;MULTIPOLYGON(((154 -44,156 -44,156 -42,154 -42,154 -44)))');
  insert into public.available_now_sessions(barber_id,location,status,available_until,public_area_id)
   select '${users.barberB}','SRID=4326;POINT(155 -43)','expired',clock_timestamp()-interval '1 day',${sqlValue(peakArea)} from generate_series(1,${config.peakHistoricalSessions});
  with new_auth as(insert into auth.users(id) select gen_random_uuid() from generate_series(1,${config.peakDueSessions}) returning id),
  new_profiles as(insert into public.profiles(id,role,verification_status) select id,'barber','not_started' from new_auth returning id),
  new_barbers as(insert into public.barber_profiles(id) select id from new_profiles returning id),
  timing as materialized(select clock_timestamp()+${config.sweepSeconds}*2*interval '1 second' as deadline)
  insert into public.available_now_sessions(barber_id,location,status,available_until,public_area_id)
   select b.id,'SRID=4326;POINT(155 -43)','active',t.deadline,${sqlValue(peakArea)} from new_barbers b cross join timing t;
  analyze public.available_now_sessions;`);
  const plan =
    sql(`explain(format json) select s.id from public.available_now_sessions s
   cross join lateral(select p.id from public.profiles p where p.id=s.barber_id for update skip locked) claimed
   where s.status='active' and s.available_until<=statement_timestamp()+${config.sweepSeconds}*2*interval '1 second'
   order by s.available_until,s.id limit ${config.batchSize};`);
  writeFileSync(
    resolve(evidence, 'due-plan.json'),
    JSON.stringify(plan, null, 2) + '\n',
  );
  assert.ok(
    JSON.stringify(plan).includes('available_now_due'),
    'Natural due-session index plan required.',
  );
  pause(true);
  const capacityEnd =
    Date.now() +
    config.sweepSeconds * 2 * 1000 +
    config.peakExpiryLatenessSecondsExclusive * 1000;
  while (
    row(
      `(select count(*) from public.available_now_sessions where public_area_id=${sqlValue(peakArea)} and status='active')`,
    ) > 0
  ) {
    assert.ok(Date.now() < capacityEnd, 'Capacity deadline exceeded.');
    await delay(500);
  }
  const capacity = row(
    `(select jsonb_build_object('dueSessions',count(*),'early',count(*) filter(where updated_at<available_until),'maxLatenessSeconds',max(extract(epoch from(updated_at-available_until))),'p95LatenessSeconds',percentile_cont(0.95) within group(order by extract(epoch from(updated_at-available_until)))) from public.available_now_sessions where public_area_id=${sqlValue(peakArea)} and barber_id<>'${users.barberB}')`,
  );
  assert.equal(capacity.dueSessions, config.peakDueSessions);
  assert.equal(capacity.early, 0);
  assert.ok(
    capacity.maxLatenessSeconds < config.peakExpiryLatenessSecondsExclusive,
    'Peak lateness must be below the approved bound.',
  );
  console.log(
    JSON.stringify({
      target: target.name,
      result: 'PASS',
      historicalSessions: config.peakHistoricalSessions,
      ...capacity,
    }),
  );
  writeFileSync(
    resolve(evidence, 'capacity.json'),
    JSON.stringify(
      {
        target: target.name,
        result: 'PASS',
        historicalSessions: config.peakHistoricalSessions,
        ...capacity,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  sql(
    `do $$ begin ${jobs.map((j) => `perform cron.alter_job(${j.id},active:=${j.active});`).join('\n')} end $$;`,
  );
  if (peakArea) {
    const ids = row(
      `(select coalesce(jsonb_agg(distinct barber_id),'[]'::jsonb) from public.available_now_sessions where public_area_id=${sqlValue(peakArea)} and barber_id<>${sqlValue(users.barberB ?? '00000000-0000-0000-0000-000000000000')})`,
    );
    sql(
      `delete from public.available_now_sessions where public_area_id=${sqlValue(peakArea)}; delete from public.public_areas where id=${sqlValue(peakArea)};`,
    );
    if (ids.length) {
      const list = ids.map(sqlValue).join(',');
      sql(
        `delete from public.barber_profiles where id in (${list}); delete from public.profiles where id in (${list}); delete from auth.users where id in (${list});`,
      );
    }
  }
  if (sessionIds.length)
    sql(
      `update public.available_now_sessions set status='cancelled' where id in (${sessionIds.map(sqlValue).join(',')}) and status='active';`,
    );
  for (const id of Object.values(users))
    await workerRequest(
      api,
      `/auth/v1/admin/users/${id}`,
      api.SERVICE_ROLE_KEY,
      { method: 'DELETE', body: JSON.stringify({ should_soft_delete: true }) },
    );
}
