import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  availabilityTransition,
  availabilityWorkerHealth,
} from '../../packages/domain/src/index.ts';
import { AVAIL_STATUS } from '../../packages/shared/src/index.ts';

import { sqlValue } from './core-fixtures.mjs';
import { withIsolatedSchema } from './isolated-schema.mjs';

await withIsolatedSchema(async ({ query, replay, files, database }) => {
  const q = (sql) => query(sql).stdout.trim();
  const migration = '20261120120000_available_now_transitions.sql';
  replay(files.filter((f) => f < migration));
  const barber = randomUUID(),
    client = randomUUID();
  q(`insert into auth.users(id) values('${barber}'),('${client}');
    insert into public.profiles(id,role,verification_status) values('${barber}','barber','verified'),('${client}','client','not_started');
    insert into public.barber_profiles(id) values('${barber}'); insert into public.client_profiles(id) values('${client}');`);
  const legacy = randomUUID();
  q(
    `insert into public.available_now_sessions(id,barber_id,location,status) values('${legacy}','${barber}','SRID=4326;POINT(155 -43)','active');`,
  );
  replay([migration]);
  assert.equal(
    q(
      `select status||':'||consecutive_misses||':'||(disabled_reason is null)::text from public.available_now_sessions where id='${legacy}'`,
    ),
    'active:0:true',
  );
  for (const status of AVAIL_STATUS)
    for (const event of [
      'expired',
      'missed',
      'responded',
      'accepted',
      'manually_disabled',
      'check_misses',
    ])
      for (const now of [999, 1000, 1001]) {
        const actual = JSON.parse(
          q(
            `select private.available_now_transition_effect('${status}',1,to_timestamp(1),${sqlValue(event)},to_timestamp(${now}/1000.0),2)`,
          ),
        );
        assert.deepEqual(
          actual,
          availabilityTransition(
            { status, misses: 1, availableUntil: 1000 },
            event,
            now,
            2,
          ),
        );
      }
  console.log('108 exact SQL/domain transition cases: PASS');
  const parallel = (sql) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        'docker',
        [
          'exec',
          '-i',
          'supabase_db_quicktrimr',
          'sh',
          '-c',
          'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql "$@"',
          'worker-proof',
          '-X',
          '-U',
          'supabase_admin',
          '-d',
          database,
          '-At',
          '-v',
          'ON_ERROR_STOP=1',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let out = '';
      child.stdout.on('data', (b) => {
        out += String(b);
      });
      child.stderr.resume();
      child.on('error', () =>
        reject(new Error('Parallel SQL process failed; details suppressed')),
      );
      child.on('close', (code) =>
        code === 0
          ? resolve(out.trim())
          : reject(new Error('Parallel SQL query failed; details suppressed')),
      );
      child.stdin.end(sql);
    });
  const session = () => {
    q(
      `update public.available_now_sessions set status='cancelled' where barber_id='${barber}' and status='active'`,
    );
    const id = randomUUID();
    q(
      `insert into public.available_now_sessions(id,barber_id,location,status,available_until) values('${id}','${barber}','SRID=4326;POINT(155 -43)','active',clock_timestamp()+interval '1 hour')`,
    );
    return id;
  };
  const request = (sessionId, status, bookingType = 'available_now') => {
    const id = randomUUID();
    q(
      `insert into public.booking_requests(id,client_id,barber_id,booking_type,status,available_now_session_id) values('${id}','${client}','${barber}','${bookingType}','${status}','${sessionId}')`,
    );
    return id;
  };
  const outcome = (id, status) =>
    q(
      `select private.record_available_now_request_outcome('${id}','${status}')`,
    );
  let id = session();
  for (const status of ['expired', 'declined', 'expired'])
    outcome(request(id, status), status);
  assert.equal(
    q(
      `select status||':'||consecutive_misses from public.available_now_sessions where id='${id}'`,
    ),
    'active:1',
  );
  const missed = request(id, 'expired');
  assert.equal(outcome(missed, 'expired'), 't');
  assert.equal(outcome(missed, 'expired'), 'f');
  assert.equal(
    q(
      `select status||':'||consecutive_misses||':'||disabled_reason from public.available_now_sessions where id='${id}'`,
    ),
    'auto_disabled:2:missed_requests',
  );
  assert.equal(q('select count(*) from public.barber_reliability_events'), '0');
  id = session();
  q(
    `update private.platform_config set value='3' where key='missed_request_threshold'`,
  );
  for (let n = 0; n < 2; n++) outcome(request(id, 'expired'), 'expired');
  assert.equal(
    q(`select status from public.available_now_sessions where id='${id}'`),
    'active',
  );
  outcome(request(id, 'expired'), 'expired');
  assert.equal(
    q(`select status from public.available_now_sessions where id='${id}'`),
    'auto_disabled',
  );
  q(
    `update private.platform_config set value='2' where key='missed_request_threshold'`,
  );
  for (let round = 0; round < 5; round++) {
    id = session();
    const r = request(id, 'expired');
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        parallel(
          `select private.record_available_now_request_outcome('${r}','expired')`,
        ),
      ),
    );
    assert.equal(results.filter((x) => x === 't').length, 1);
    assert.equal(
      q(
        `select consecutive_misses from public.available_now_sessions where id='${id}'`,
      ),
      '1',
    );
  }
  console.log(
    'Five real six-connection duplicate receipt races, exactly one count: PASS',
  );
  for (let round = 0; round < 5; round++) {
    id = session();
    q(
      `update public.available_now_sessions set available_until=clock_timestamp()-interval '1 second' where id='${id}'`,
    );
    const before = Number(
      q(`select count(*) from public.audit_logs where entity_id='${id}'`),
    );
    await Promise.all(
      ['expired', 'manually_disabled'].map((event) =>
        parallel(
          `select private.transition_available_now_session('${id}','${event}')`,
        ),
      ),
    );
    assert.ok(
      ['expired', 'manually_disabled'].includes(
        q(`select status from public.available_now_sessions where id='${id}'`),
      ),
    );
    assert.equal(
      Number(
        q(`select count(*) from public.audit_logs where entity_id='${id}'`),
      ) - before,
      1,
    );
  }
  id = session();
  const accepted = request(id, 'accepted');
  outcome(accepted, 'accepted');
  assert.equal(
    q(
      `select status||':'||consecutive_misses from public.available_now_sessions where id='${id}'`,
    ),
    'busy:0',
  );
  assert.equal(outcome(accepted, 'accepted'), 'f');
  // Accepted request from a replaced session disables current availability;
  // a late old miss never disables its replacement.
  const old = session(),
    oldMiss = request(old, 'expired'),
    oldAccept = request(old, 'accepted');
  const replacement = session();
  outcome(oldMiss, 'expired');
  assert.equal(
    q(
      `select consecutive_misses from public.available_now_sessions where id='${replacement}'`,
    ),
    '0',
  );
  outcome(oldAccept, 'accepted');
  assert.equal(
    q(
      `select status from public.available_now_sessions where id='${replacement}'`,
    ),
    'busy',
  );
  id = session();
  const scheduled = request(id, 'expired', 'scheduled');
  assert.equal(outcome(scheduled, 'expired'), 'f');
  const pending = request(id, 'pending');
  assert.notEqual(
    query(
      `select private.record_available_now_request_outcome('${pending}','expired')`,
      { mustSucceed: false },
    ).status,
    0,
  );
  for (const verb of [
    `update private.available_now_request_receipts set created_at=created_at`,
    `delete from private.available_now_request_receipts`,
    `truncate private.available_now_request_receipts`,
  ])
    assert.notEqual(query(verb, { mustSucceed: false }).status, 0);
  assert.equal(
    q(
      `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='available_now_request_receipts' and c.relrowsecurity`,
    ),
    '1',
  );
  console.log(
    'Upgrade preservation, response reset, config, stale states, acceptance, unchanged reliability and immutable receipts: PASS',
  );
  replay(files.filter((f) => f > migration));
  const stopped = session();
  q(
    `select private.transition_available_now_session('${stopped}','manually_disabled'); update public.available_now_sessions set available_until=clock_timestamp()-interval '1 second' where id='${stopped}';`,
  );
  const busy = session();
  q(
    `select private.transition_available_now_session('${busy}','accepted'); update public.available_now_sessions set available_until=clock_timestamp()-interval '1 second' where id='${busy}';`,
  );
  assert.equal(
    JSON.parse(q('select private.run_available_now_expiry()')).processed,
    0,
  );
  assert.equal(
    q(`select status from public.available_now_sessions where id='${stopped}'`),
    'manually_disabled',
  );
  assert.equal(
    q(`select status from public.available_now_sessions where id='${busy}'`),
    'busy',
  );
  const operations = JSON.parse(
    q(
      "select value from private.platform_config where key='available_now_worker_operations'",
    ),
  );
  for (const last of [null, 0, 1])
    for (const oldest of [null, 60000, 60001])
      for (const failures of [0, 1]) {
        const timestamp = (value) =>
          value === null ? 'null' : `to_timestamp(${value}/1000.0)`;
        const actual = JSON.parse(
          q(
            `select private.available_now_health_effect(${timestamp(last)},${timestamp(oldest)},${failures},to_timestamp(120.001),${sqlValue(JSON.stringify(operations))}::jsonb)`,
          ),
        );
        assert.deepEqual(
          actual,
          availabilityWorkerHealth(last, oldest, failures, 120001, operations),
        );
      }
  id = session();
  q(`update public.available_now_sessions set available_until=clock_timestamp()-interval '1 second' where id='${id}';
    update private.platform_config set value='0' where key='missed_request_threshold';`);
  assert.equal(
    JSON.parse(
      q(
        'select private.run_available_now_expiry() /* scratch failure probe */',
      ),
    ).outcome,
    'failed',
  );
  assert.equal(
    q(`select status from public.available_now_sessions where id='${id}'`),
    'active',
  );
  assert.equal(
    q('select count(*) from private.available_now_worker_failures'),
    '1',
  );
  assert.equal(
    q(
      "select count(*) from private.available_now_worker_runs where outcome='failed' and processed=0 and error_code is not null",
    ),
    '1',
  );
  q(
    "update private.platform_config set value='2' where key='missed_request_threshold'",
  );
  assert.equal(
    JSON.parse(
      q('select private.run_available_now_expiry() /* scratch retry probe */'),
    ).processed,
    1,
  );
  const immutableBefore = q('select count(*) from public.audit_logs'),
    receiptsBefore = q(
      'select count(*) from private.available_now_request_receipts',
    );
  q(`insert into private.available_now_worker_runs(started_at,finished_at,outcome,processed) values(clock_timestamp()-interval '31 days',clock_timestamp()-interval '31 days','succeeded',0);
    insert into private.available_now_worker_failures(source,source_id,detected_at) values('worker',-1,clock_timestamp()-interval '31 days');
    select private.prune_available_now_worker_history();`);
  assert.equal(
    q(
      "select count(*) from private.available_now_worker_runs where finished_at<clock_timestamp()-interval '30 days'",
    ),
    '0',
  );
  assert.equal(
    q(
      'select count(*) from private.available_now_worker_failures where source_id=-1',
    ),
    '1',
    'Unreported failure survives retention.',
  );
  q(
    'update private.available_now_worker_state set failure_ack=(select max(id) from private.available_now_worker_failures); select private.prune_available_now_worker_history();',
  );
  assert.equal(
    q(
      'select count(*) from private.available_now_worker_failures where source_id=-1',
    ),
    '0',
  );
  assert.equal(q('select count(*) from public.audit_logs'), immutableBefore);
  assert.equal(
    q('select count(*) from private.available_now_request_receipts'),
    receiptsBefore,
  );
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(
      q(
        `select has_function_privilege('${role}','private.run_available_now_expiry()','execute')`,
      ),
      'f',
    );
  }
  console.log(
    'Full worker migration replay, health parity, atomic failed batch/retry, 30-day retention and immutable history: PASS',
  );
});
