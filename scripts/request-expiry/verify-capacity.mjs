import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { workerConfig } from '../availability/worker-operator.mjs';
import { sqlValue as q } from '../db/core-fixtures.mjs';
import { assertLocalProject, projectId } from '../db/local.mjs';
import { queryLocal } from '../db/verify.mjs';

assertLocalProject();
const config = workerConfig('CFG-REQUEST-EXPIRY-WORKER-OPERATIONS');
const runtime = JSON.parse(
  queryLocal('select private.booking_request_expiry_config()'),
);
assert.deepEqual(runtime, config);
const database = 'expiry_qa_' + randomUUID().replaceAll('-', '');
const job = 'quicktrimr.' + database;
const container = `supabase_db_${projectId}`;
function docker(args, input) {
  try {
    return execFileSync('docker', ['exec', '-i', container, ...args], {
      encoding: 'utf8',
      input,
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(
      'Disposable database command failed. Local command details suppressed.',
    );
  }
}
const sql = (command) =>
  docker(
    [
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      database,
      '-Atq',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    command,
  );
let scheduled = false;
docker(['createdb', '-U', 'postgres', '-T', 'template0', database]);
try {
  // A schema-only clone ensures the load never sees real or demo app records.
  const schema = docker([
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--schema-only',
    '--schema=auth',
    '--schema=public',
    '--schema=private',
    '--no-privileges',
    '--no-owner',
  ]);
  sql(
    'drop schema public; create schema extensions; create extension postgis with schema extensions; create extension pgcrypto with schema extensions;',
  );
  sql(schema);
  const client = q(randomUUID());
  const barber = q(randomUUID());
  const session = q(randomUUID());
  const threshold = JSON.parse(
    queryLocal(
      "select value from private.platform_config where key = 'missed_request_threshold'",
    ),
  );
  sql(`insert into auth.users(id,email) values (${client},'client@example.invalid'),(${barber},'barber@example.invalid');
    insert into public.profiles(id,role,verification_status)
      values(${client},'client','not_started'),(${barber},'barber','verified');
    insert into public.client_profiles(id) values (${client});
    insert into public.barber_profiles(id) values (${barber});
    insert into private.platform_config(key,value) values
      ('booking_request_expiry_operations',${q(JSON.stringify(config))}),
      ('missed_request_threshold',${q(JSON.stringify(threshold))});
    insert into public.available_now_sessions(id,barber_id,location,status,location_source,radius_km,available_until)
      values(${session},${barber},'SRID=4326;POINT(145.2 -38.2)'::extensions.geography,'active','gps',12,now()+interval '1 hour');
    insert into public.booking_requests(client_id,barber_id,booking_type,status,expires_at)
      select ${client},${barber},'scheduled','expired',now()-interval '1 day'
      from generate_series(1,${config.peakHistoricalRequests});
    insert into public.booking_requests(client_id,barber_id,booking_type,status,expires_at,available_now_session_id)
      select ${client},${barber},
        (case when n % 2 = 0 then 'available_now' else 'scheduled' end)::public.booking_type,
        'pending',statement_timestamp()+${config.sweepSeconds}*interval '1 second',
        case when n % 2 = 0 then ${session}::uuid end
    from generate_series(1,${config.peakDueRequests}) n;`);
  sql('vacuum analyze public.booking_requests;');
  const plan =
    sql(`explain select id,barber_id,expires_at from public.booking_requests
    where status='pending' and expires_at is not null and expires_at <= statement_timestamp()+interval '1 minute'
    order by expires_at,id limit ${config.batchSize};`);
  assert.match(plan, /booking_requests_due_idx/);
  queryLocal(`select cron.schedule_in_database(${q(job)}, ${q(config.sweepSeconds + ' seconds')},
    $$select private.run_booking_request_expiry('primary');$$, ${q(database)});`);
  scheduled = true;
  const finish =
    performance.now() +
    (config.peakExpiryLatenessSecondsExclusive + config.sweepSeconds) * 1000;
  while (
    sql(
      "select count(*) from public.booking_requests where status='pending';",
    ) !== '0'
  ) {
    assert.ok(
      performance.now() < finish,
      'Scheduled peak expiry exceeded the approved lateness window.',
    );
    await delay(1000);
  }
  const observed = JSON.parse(
    sql(`select jsonb_build_object(
    'audited',count(*), 'uniqueRequests', count(distinct request.id),
    'earliestSeconds',min(extract(epoch from audit.created_at-request.expires_at)),
    'latestSeconds',max(extract(epoch from audit.created_at-request.expires_at)),
    'historical',(select count(*) from public.booking_requests)-count(*),
    'receipts',(select count(*) from private.available_now_request_receipts),
    'maximumBatch',(select max(processed) from private.booking_request_expiry_runs),
    'failed',(select sum(failed) from private.booking_request_expiry_runs)
  ) from public.audit_logs audit join public.booking_requests request on request.id=audit.entity_id
  where audit.action='booking_request.expired' and request.status='expired';`),
  );
  assert.equal(observed.audited, config.peakDueRequests);
  assert.equal(observed.uniqueRequests, config.peakDueRequests);
  assert.equal(observed.historical, config.peakHistoricalRequests);
  assert.equal(observed.receipts, Math.floor(config.peakDueRequests / 2));
  assert.equal(observed.failed, 0);
  assert.ok(
    observed.maximumBatch > 0 && observed.maximumBatch <= config.batchSize,
  );
  assert.ok(
    observed.earliestSeconds >= 0 &&
      observed.latestSeconds < config.peakExpiryLatenessSecondsExclusive,
  );
  console.log(
    JSON.stringify(
      {
        ...observed,
        scheduler: 'pg_cron',
        index: 'booking_requests_due_idx',
        fixture: 'local schema-only clone',
      },
      null,
      2,
    ),
  );
} finally {
  try {
    if (scheduled) queryLocal(`select cron.unschedule(${q(job)});`);
  } finally {
    docker(['dropdb', '-U', 'postgres', '--force', database]);
  }
}
