import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

import { requestDeadlineReached } from '../../packages/domain/src/index.ts';
import { workerConfig } from '../availability/worker-operator.mjs';
import { apiJson, assertRawBody, makeUsers } from '../db/api-test-helpers.mjs';
import { sqlValue as q } from '../db/core-fixtures.mjs';
import { localStatus } from '../db/local-api.mjs';
import { projectId, root } from '../db/local.mjs';
import { queryLocal as sql } from '../db/verify.mjs';

const stack = localStatus();
const config = workerConfig('CFG-REQUEST-EXPIRY-WORKER-OPERATIONS');
const read = (query) => JSON.parse(sql(query));
assert.deepEqual(
  read('select private.booking_request_expiry_config()'),
  config,
);
const jobs = read(`select jsonb_object_agg(jobname,active) from cron.job
  where jobname in ('quicktrimr.request_expiry.primary', 'quicktrimr.request_expiry.reconcile')`);
assert.equal(
  Object.keys(jobs ?? {}).length,
  2,
  'Install the local expiry jobs first.',
);
function setJobs(primary, reconcile) {
  sql(`select cron.alter_job(jobid, active := case
    when jobname = 'quicktrimr.request_expiry.primary' then ${primary} else ${reconcile} end)
    from cron.job where jobname in ('quicktrimr.request_expiry.primary', 'quicktrimr.request_expiry.reconcile');`);
}
const post = (path, token, input) =>
  apiJson(stack, path, token, { method: 'POST', body: JSON.stringify(input) });
const expiryPath = '/functions/v1/expire-booking-request';
const expire = (id, token = stack.SERVICE_ROLE_KEY) =>
  post(expiryPath, token, { requestId: id });
const pass = (message) => console.log('PASS ' + message);
async function until(probe, message, seconds) {
  const deadline = performance.now() + seconds * 1000;
  do {
    const result = probe();
    if (result) return result;
    await delay(220);
  } while (performance.now() < deadline);
  throw new Error(message);
}
const users = {};
let monitor, receiver;
const session = randomUUID();
const category = randomUUID();
const service = randomUUID();
const address = randomUUID();
let barber, client;
const syntheticLocation =
  "'SRID=4326;POINT(145.2 -38.2)'::extensions.geography";
const fixture = (deadline, type = 'scheduled', source = 'null') =>
  sql(`insert into public.booking_requests(client_id,barber_id,booking_type,status,service_category_id,
    barber_service_id,scheduled_for,expires_at,available_now_session_id)
    values(${client},${barber},${q(type)},'pending',${q(category)},${q(service)},
    case when ${q(type)}='scheduled' then now()+interval '1 day' end,${deadline},${source}) returning id;`).split(
    '\n',
  )[0];
const status = (id) =>
  sql(`select status from public.booking_requests where id=${q(id)}`);
// Copy a synthetic Scheduled request and its acceptance snapshot using a
// short test deadline. The public controller never accepts a clock override.
function nearDeadline(template) {
  return sql(`with copied as (
    insert into public.booking_requests(client_id,barber_id,booking_type,status,service_category_id,
      barber_service_id,scheduled_for,expires_at)
    select client_id,barber_id,booking_type,'pending',service_category_id,
      barber_service_id,scheduled_for,clock_timestamp()+interval '5 seconds'
      from public.booking_requests where id=${q(template)} returning id
  )
    insert into private.booking_request_snapshots(request_id,service_price_cents,commission_pct_snapshot,
      gross_cents,commission_cents,barber_net_cents,cancellation_refund_pct,cancellation_inconvenience_pct,
      late_cancel_window_hours,client_address_id,address_snapshot,address_location,client_snapshot,
      barber_snapshot,service_snapshot,notes,created_at)
    select c.id,s.service_price_cents,s.commission_pct_snapshot,s.gross_cents,s.commission_cents,
      s.barber_net_cents,s.cancellation_refund_pct,s.cancellation_inconvenience_pct,s.late_cancel_window_hours,
      s.client_address_id,s.address_snapshot,s.address_location,s.client_snapshot,s.barber_snapshot,
      s.service_snapshot,s.notes,clock_timestamp()
      from copied c cross join private.booking_request_snapshots s where s.request_id=${q(template)}
      returning request_id;`).split('\n')[0];
}
const effects = (id) =>
  read(`select jsonb_build_object(
  'audit', (select count(*) from public.audit_logs where entity_id=${q(id)} and action='booking_request.expired'),
  'receipt', (select count(*) from private.available_now_request_receipts where request_id=${q(id)}),
  'bookings', (select count(*) from public.bookings where request_id=${q(id)}),
  'payments', (select count(*) from public.payments join public.bookings on booking_id=bookings.id where request_id=${q(id)})
)`);

// A real postgres connection stops after the first writer, with locks held.
function holdTransaction(command) {
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      `supabase_db_${projectId}`,
      'psql',
      '-X',
      '-U',
      'postgres',
      '-Atq',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stdin.on('error', () => {});
  const done = new Promise((resolve) => {
    child.on('error', () => resolve(-1));
    child.on('close', resolve);
  });
  child.stdin.write(
    `begin; set local idle_in_transaction_session_timeout='16s'; ${command}; select 'READY:'||pg_backend_pid();\n`,
  );
  return {
    ready: () =>
      until(
        () => Number(output.match(/READY:(\d+)/)?.[1]),
        'First writer did not obtain the lock.',
        5,
      ),
    async finish(action) {
      child.stdin.end(action + ';\n');
      assert.equal(await done, 0, 'First writer failed.');
    },
  };
}

try {
  setJobs(false, false);
  const identities = await makeUsers(stack, {
    additional: ['admin'],
    adversarialMetadata: true,
  });
  Object.assign(users, identities.users);
  const { tokens } = identities;
  client = q(users.clientA);
  barber = q(users.barberA);
  sql(`begin;
    insert into public.profiles(id,role,verification_status)
      values(${client},'client','not_started'),(${barber},'barber','verified'),(${q(users.admin)},'admin','not_started');
    insert into public.client_profiles(id,display_name,mobile) values(${client},'QA Client','+61400000000');
    insert into public.barber_profiles(id,display_name,service_area,service_radius_km)
      values(${barber},'QA Barber',${syntheticLocation},12);
    insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled)
      values(${barber},'acct_LocalFixturePlatform',${q('acct_LocalFixture' + randomUUID().replaceAll('-', ''))},'verified',true,true);
    insert into public.client_addresses(id,client_id,location,directory_id,label,line1,suburb,state,postcode,unit,access_notes)
      values(${q(address)},${client},${syntheticLocation},'synthetic-expiry','QA Home','Synthetic street','Synthetic locality','VIC','3000','','');
    insert into public.service_categories(id,slug,display_name,description,display_order,min_price_cents,max_price_cents)
      values(${q(category)},${q('expiry-qa-' + category)},'Synthetic QA Haircut','Local expiry QA',0,2000,15000);
    insert into public.barber_services(id,barber_id,service_category_id,price_cents)
      values(${q(service)},${barber},${q(category)},4503);
    insert into public.available_now_sessions(id,barber_id,location,status,location_source,radius_km,available_until,consecutive_misses)
      values(${q(session)},${barber},${syntheticLocation},'active','gps',12,now()+interval '6 hours',0);
    commit;`);

  const deadline = '2026-11-26T00:05:00Z';
  const comparator =
    read(`select jsonb_agg(private.booking_request_deadline_reached(${q(deadline)},
     ${q(deadline)}::timestamptz + n*interval '1 microsecond') order by n) from generate_series(-1,1) n`);
  assert.deepEqual(
    comparator,
    [-1, 0, 1].map((delta) =>
      requestDeadlineReached(
        Date.parse(deadline),
        Date.parse(deadline) + delta,
      ),
    ),
  );
  const future = fixture("now()+interval '1 hour'");
  const legacy = fixture('null');
  for (const id of [future, legacy]) {
    const result = await expire(id);
    assert.equal(result.status, 200);
    assertRawBody(
      result.body,
      { requestId: id, applied: false, status: 'pending' },
      'Early or undated request',
    );
  }
  for (const token of [null, stack.ANON_KEY, ...Object.values(tokens)]) {
    assert.ok(
      [401, 403].includes((await expire(future, token)).status),
      'Worker must deny mobile roles.',
    );
    const denied = await post('/rest/v1/rpc/expire_booking_request', token, {
      p_request_id: future,
    });
    assert.ok(
      [401, 403, 404].includes(denied.status),
      'Direct RPC must deny mobile roles.',
    );
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const result = await apiJson(
        stack,
        '/rest/v1/booking_request_expiry_runs',
        token,
        {
          method,
          ...(method === 'POST' || method === 'PATCH' ? { body: '{}' } : {}),
        },
      );
      assert.equal(
        result.status,
        404,
        'Private operational table must stay off the Data API.',
      );
    }
  }
  const invalid = await post(expiryPath, stack.SERVICE_ROLE_KEY, {
    requestId: 'invalid',
    now: deadline,
  });
  assert.equal(invalid.status, 422);
  assert.ok(invalid.body.fields.requestId);
  assert.equal((await expire(randomUUID())).status, 404);
  pass(
    'Exact deadline boundary, early/undated no-op, all mobile worker/RPC/operational table denials and field validation.',
  );

  const available = fixture(
    "now()-interval '1 second'",
    'available_now',
    q(session),
  );
  const duplicate = await Promise.all(
    Array.from({ length: 5 }, () => expire(available)),
  );
  assert.ok(duplicate.every((result) => result.status === 200));
  assert.equal(duplicate.filter((result) => result.body.applied).length, 1);
  for (const result of duplicate) {
    assertRawBody(
      result.body,
      { requestId: available, status: 'expired', applied: result.body.applied },
      'Expiry projection',
    );
  }
  assert.deepEqual(effects(available), {
    audit: 1,
    receipt: 1,
    bookings: 0,
    payments: 0,
  });
  assert.equal(
    sql(
      `select consecutive_misses from public.available_now_sessions where id=${q(session)}`,
    ),
    '1',
  );
  pass(
    'Five parallel expiry calls committed one Available Now miss, one receipt and one audit, with no booking or payment.',
  );

  for (const [round, first] of [
    'accept',
    'expire',
    'accept',
    'expire',
    'accept',
    'expire',
  ].entries()) {
    let id;
    if (first === 'accept') {
      const result = await post(
        '/functions/v1/create-booking-request',
        tokens.clientA,
        {
          bookingType: 'scheduled',
          barberId: users.barberA,
          serviceCategoryId: category,
          clientAddressId: address,
          scheduledFor: new Date(
            Date.now() + (round + 1) * 86_400_000,
          ).toISOString(),
        },
      );
      assert.equal(result.status, 200, 'Live Scheduled request creation.');
      id = nearDeadline(result.body.id);
    } else {
      id = fixture("now()-interval '1 second'");
    }
    const lock = holdTransaction(
      first === 'accept'
        ? `set local request.jwt.claims='{"role":"service_role"}'; select public.accept_booking_request(${barber},${q(id)})`
        : `select private.expire_booking_request(${q(id)})`,
    );
    let challenger;
    try {
      const pid = await lock.ready();
      challenger =
        first === 'accept'
          ? expire(id)
          : post('/functions/v1/accept-booking-request', tokens.barberA, {
              requestId: id,
            });
      await until(
        () =>
          sql(`select count(*) from pg_stat_activity
        where ${pid}=any(pg_blocking_pids(pid))`) !== '0',
        'No concurrent request waited for the first writer.',
        5,
      );
      if (first === 'accept') {
        await until(
          () =>
            sql(`select clock_timestamp() >= expires_at from public.booking_requests
            where id=${q(id)}`) === 't',
          'The stored deadline did not elapse while the stale delivery waited.',
          8,
        );
      }
    } finally {
      await lock.finish('commit');
    }
    const result = await challenger;
    if (first === 'accept') {
      assertRawBody(
        result.body,
        { requestId: id, status: 'accepted', applied: false },
        'Accepted request survives',
      );
      assert.deepEqual(effects(id), {
        audit: 0,
        receipt: 0,
        bookings: 1,
        payments: 0,
      });
    } else {
      assert.equal(result.status, 409);
      assertRawBody(
        result.body,
        { error: 'request_not_pending' },
        'Expired request stays expired',
      );
      assert.deepEqual(effects(id), {
        audit: 1,
        receipt: 0,
        bookings: 0,
        payments: 0,
      });
    }
  }
  pass(
    'Six real accept/expiry lock races covered both commit orders. Each accepted request crossed its deadline before the waiting expiry resumed and stayed accepted.',
  );

  const abandoned = fixture("now()-interval '1 second'");
  const interrupted = holdTransaction(
    `select private.run_booking_request_expiry('primary')`,
  );
  try {
    await interrupted.ready();
    assert.equal(status(abandoned), 'pending');
    assert.deepEqual(
      read("select private.run_booking_request_expiry('reconcile')"),
      { skipped: true },
    );
  } finally {
    await interrupted.finish('rollback');
  }
  assert.deepEqual(effects(abandoned), {
    audit: 0,
    receipt: 0,
    bookings: 0,
    payments: 0,
  });
  setJobs(false, true);
  await until(
    () => status(abandoned) === 'expired',
    'Reconciliation did not expire the interrupted request.',
    config.reconcileSeconds * 2,
  );
  assert.deepEqual(effects(abandoned), {
    audit: 1,
    receipt: 0,
    bookings: 0,
    payments: 0,
  });
  const clientView = await post(
    '/rest/v1/rpc/get_client_booking_request',
    tokens.clientA,
    { p_request_id: abandoned },
  );
  assert.equal(clientView.status, 200);
  assert.equal(clientView.body.status, 'expired');
  assert.ok(!('receipt' in clientView.body) && !('audit' in clientView.body));
  pass(
    'An interrupted primary claim rolled back. Real reconciliation recovered it with primary paused; the owner saw expired on the first read afterwards.',
  );

  setJobs(true, true);
  await until(
    () => {
      const health = read('select private.booking_request_expiry_health()');
      return [health.primaryHeartbeat, health.reconcileHeartbeat].every(
        (heartbeat) =>
          heartbeat &&
          Date.parse(health.serverNow) - Date.parse(heartbeat) <
            config.healthCheckSeconds * 1000,
      );
    },
    'Scheduled heartbeats are absent.',
    config.reconcileSeconds * 2,
  );
  const received = [];
  receiver = createServer(async (request, response) => {
    let input = '';
    for await (const chunk of request) input += chunk;
    received.push(JSON.parse(input));
    response.writeHead(204).end();
  });
  await new Promise((resolve, reject) =>
    receiver.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  monitor = spawn(
    process.execPath,
    [
      'scripts/request-expiry/monitor.mjs',
      `http://127.0.0.1:${receiver.address().port}`,
    ],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  setJobs(false, false);
  const fault = fixture("now()-interval '1 second'", 'available_now');
  const failedRun = read(
    "select private.run_booking_request_expiry('primary')",
  );
  assert.equal(
    failedRun.failed,
    1,
    'A missing synthetic source must roll back its request.',
  );
  assert.equal(status(fault), 'pending');
  assert.deepEqual(effects(fault), {
    audit: 0,
    receipt: 0,
    bookings: 0,
    payments: 0,
  });
  sql(
    `update public.booking_requests set status='cancelled' where id=${q(fault)};`,
  );
  const stranded = fixture(
    `now()-${config.overdueSeconds + 1}*interval '1 second'`,
  );
  await until(
    () =>
      received.some(
        (entry) =>
          entry.reasons.includes('failed_run') &&
          entry.reasons.includes('overdue_requests'),
      ),
    'Independent receiver missed a failure or overdue request.',
    config.healthCheckSeconds * 2,
  );
  await until(
    () => received.some((entry) => entry.reasons.includes('stale_heartbeat')),
    'Monitor did not detect two paused schedules.',
    config.staleHeartbeatSeconds + config.healthCheckSeconds * 2,
  );
  setJobs(true, true);
  await until(
    () => received.some((entry) => entry.status === 'recovered'),
    'Independent receiver missed the recovery.',
    config.healthCheckSeconds * 3,
  );
  assert.equal(status(stranded), 'expired');
  assert.ok(
    received.every(
      (entry) =>
        Object.keys(entry).sort().join(',') === 'reasons,status,worker',
    ),
  );
  pass(
    'A separate process delivered failed-run, overdue, stopped-scheduler and recovery notifications to the local receiver.',
  );

  const obsolete =
    sql(`insert into private.booking_request_expiry_runs(mode,started_at,finished_at,processed,failed)
    values('primary',now()-(${config.runRetentionDays}+1)*interval '1 day',now()-(${config.runRetentionDays}+1)*interval '1 day',0,0)
    returning id;`).split('\n')[0];
  assert.match(obsolete, /^\d+$/);
  await until(
    () =>
      sql(
        `select count(*) from private.booking_request_expiry_runs where id=${obsolete}`,
      ) === '0',
    'Reconciliation did not prune an old operational record.',
    config.reconcileSeconds * 2,
  );
  assert.equal(effects(available).audit, 1);
  assert.equal(effects(available).receipt, 1);
  pass(
    'Operational retention removed a stale run while the immutable expiry audit and receipt remained.',
  );
} finally {
  monitor?.kill();
  receiver?.close();
  setJobs(
    jobs['quicktrimr.request_expiry.primary'],
    jobs['quicktrimr.request_expiry.reconcile'],
  );
  if (barber && client) {
    sql(`begin;
      update public.booking_requests set status='cancelled' where service_category_id=${q(category)} and status='pending';
      update public.available_now_sessions set status='manually_disabled' where id=${q(session)} and status='active';
      update public.barber_services set archived_at=now() where id=${q(service)};
      update public.service_categories set archived_at=now() where id=${q(category)};
      update public.client_addresses set archived_at=now() where id=${q(address)};
      commit;`);
  }
  for (const id of Object.values(users)) {
    const result = await apiJson(
      stack,
      '/auth/v1/admin/users/' + id,
      stack.SERVICE_ROLE_KEY,
      {
        method: 'DELETE',
        body: '{"should_soft_delete":true}',
      },
    );
    assert.equal(result.status, 200, 'Synthetic fixture cleanup failed.');
  }
}
