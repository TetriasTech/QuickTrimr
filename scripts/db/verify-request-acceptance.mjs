import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { requestDeadlineReached } from '../../packages/domain/src/index.ts';
import { REQUEST_DECLINE_REASONS } from '../../packages/shared/src/index.ts';
import {
  acceptBookingRequestResponseSchema,
  clientBookingRequestSchema,
  declineBookingRequestResponseSchema,
} from '../../packages/validation/src/index.ts';

import { apiJson, assertRawBody, makeUsers } from './api-test-helpers.mjs';
import { sqlValue as q } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { projectId } from './local.mjs';
import { queryLocal as sql } from './verify.mjs';

const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 1 && args[0] === '--with-decline'),
);
const stack = localStatus();
const { users, tokens } = await makeUsers(stack, {
  additional: ['admin', 'noProfile'],
  adversarialMetadata: true,
});
const barber = q(users.barberA);
const category = randomUUID();
const service = randomUUID();
const addresses = { clientA: randomUUID(), clientB: randomUUID() };
const sourceSession = randomUUID();
const currentSession = randomUUID();
const point = "'SRID=4326;POINT(145.2 -38.2)'::extensions.geography";
const post = (path, token, input) =>
  apiJson(stack, path, token, { method: 'POST', body: JSON.stringify(input) });
const edge = (name, token, input) =>
  post('/functions/v1/' + name, token, input);
const accept = (id, token = tokens.barberA, fields = {}) =>
  edge('accept-booking-request', token, { requestId: id, ...fields });
const decline = (id, reason, token = tokens.barberA) =>
  edge('decline-booking-request', token, { requestId: id, reason });
const read = (statement) => JSON.parse(sql(statement));
const pass = (message) => console.log(`PASS ${message}`);
const expectedWinner = (requestId, bookingId) => ({
  requestId,
  bookingId,
  requestStatus: 'accepted',
  bookingStatus: 'accepted_pending_payment',
});
function assertError(result, status, error) {
  assert.equal(result.status, status, error);
  assertRawBody(result.body, { error }, 'Shared error envelope');
}
function assertAccepted(result, requestId) {
  assert.equal(result.status, 200, 'Acceptance should succeed.');
  const { bookingId } = acceptBookingRequestResponseSchema.parse(result.body);
  assertRawBody(
    result.body,
    expectedWinner(requestId, bookingId),
    'Raw acceptance body',
  );
  return bookingId;
}
async function submit(bookingType, client = 'clientA') {
  const result = await edge('create-booking-request', tokens[client], {
    bookingType,
    barberId: users.barberA,
    serviceCategoryId: category,
    clientAddressId: addresses[client],
    notes: 'Private synthetic note',
    ...(bookingType === 'scheduled'
      ? { scheduledFor: new Date(Date.now() + 86_400_000).toISOString() }
      : {}),
  });
  assert.equal(result.status, 200, 'Live fixture request creation failed.');
  return result.body.id;
}
async function clientRequest(client, id) {
  const result = await post(
    '/rest/v1/rpc/get_client_booking_request',
    tokens[client],
    { p_request_id: id },
  );
  assert.equal(result.status, 200);
  const request = clientBookingRequestSchema.parse(result.body);
  assert.equal(request.id, id);
  return request.status;
}
function snapshotEffects(id) {
  return read(`select jsonb_build_object(
    'request',r.status,
    'bookings',(select count(*) from public.bookings where request_id=r.id),
    'history',(select count(*) from public.booking_status_history h join public.bookings b on b.id=h.booking_id where b.request_id=r.id),
    'lineItems',(select count(*) from public.booking_services l join public.bookings b on b.id=l.booking_id where b.request_id=r.id),
    'payments',(select count(*) from public.payments p join public.bookings b on b.id=p.booking_id where b.request_id=r.id),
    'acceptAudit',(select count(*) from public.audit_logs where entity_id=r.id and action='booking_request.accepted'),
    'receipt',(select count(*) from private.available_now_request_receipts where request_id=r.id)
  ) from public.booking_requests r where r.id=${q(id)}`);
}
function assertNoAcceptance(id, request = 'pending', receipt = 0) {
  assertRawBody(
    snapshotEffects(id),
    {
      request,
      bookings: 0,
      history: 0,
      lineItems: 0,
      payments: 0,
      acceptAudit: 0,
      receipt,
    },
    'No acceptance effects',
  );
}
function assertOneAcceptance(id, receipt) {
  assertRawBody(
    snapshotEffects(id),
    {
      request: 'accepted',
      bookings: 1,
      history: 1,
      lineItems: 1,
      payments: 0,
      acceptAudit: 1,
      receipt,
    },
    'Exactly one acceptance',
  );
}

// Clone only disposable records from the real creation handler, for controlled
// deadlines and repeat races. The production API never accepts these overrides.
function cloneRequest(
  template,
  deadline = "clock_timestamp()+interval '5 minutes'",
  requestStatus = 'pending',
) {
  const id = randomUUID();
  assert.equal(
    sql(`with copied as (
    insert into public.booking_requests(id,client_id,barber_id,booking_type,status,service_category_id,
      barber_service_id,scheduled_for,expires_at,available_now_session_id)
    select ${q(id)},client_id,barber_id,booking_type,${q(requestStatus)},service_category_id,
      barber_service_id,scheduled_for,${deadline},available_now_session_id
    from public.booking_requests where id=${q(template)} returning id
  ), saved as (
    insert into private.booking_request_snapshots(request_id,service_price_cents,commission_pct_snapshot,
      gross_cents,commission_cents,barber_net_cents,cancellation_refund_pct,cancellation_inconvenience_pct,
      late_cancel_window_hours,client_address_id,address_snapshot,address_location,client_snapshot,
      barber_snapshot,service_snapshot,notes,created_at)
    select c.id,s.service_price_cents,s.commission_pct_snapshot,s.gross_cents,s.commission_cents,
      s.barber_net_cents,s.cancellation_refund_pct,s.cancellation_inconvenience_pct,s.late_cancel_window_hours,
      s.client_address_id,s.address_snapshot,s.address_location,s.client_snapshot,s.barber_snapshot,
      s.service_snapshot,s.notes,clock_timestamp() from copied c cross join private.booking_request_snapshots s
      where s.request_id=${q(template)} returning request_id
  ) select count(*) from saved;`),
    '1',
  );
  return id;
}

const parentLock = `select 1 from public.profiles where id=${barber} for update`;
const standing = (
  level,
  cooldown = 'null',
) => `insert into public.barber_reliability_state(id,level,cooldown_until)
  values(${barber},${q(level)},${cooldown}) on conflict(id) do update set level=excluded.level, cooldown_until=excluded.cooldown_until`;
function setStanding(level, cooldown) {
  sql(`begin; ${parentLock}; ${standing(level, cooldown)}; commit;`);
}
function releaseFixtureJobs() {
  sql(`update public.bookings set status='cancelled' where barber_id=${barber}
    and booking_type='available_now' and status='accepted_pending_payment';`);
}

async function until(probe, message) {
  const timeout = performance.now() + 6500;
  do {
    const result = probe();
    if (result) return result;
    await delay(20);
  } while (performance.now() < timeout);
  throw new Error(message);
}
function transaction(setup) {
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
      '-d',
      'postgres',
      '-Atq',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: 'pipe' },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.resume();
  child.stdin.on('error', () => {});
  const finished = new Promise((resolve) => {
    child.once('error', () => resolve(-1));
    child.once('close', resolve);
  });
  child.stdin.write(`begin; set local statement_timeout='9s';
    set local idle_in_transaction_session_timeout='13s';
    ${setup}; select 'READY:'||pg_backend_pid();\n`);
  return {
    ready: () =>
      until(
        () => Number(output.match(/READY:(\d+)/)?.[1]),
        'Fixture transaction never acquired its lock.',
      ),
    async finish(command = 'commit;') {
      if (!child.stdin.writableEnded) child.stdin.end(command + '\n');
      assert.equal(await finished, 0, 'Fixture transaction failed.');
    },
  };
}
async function blockedBy(pid, query = 'accept_booking_request', minimum = 1) {
  return until(() => {
    const waiting = read(`with recursive waiters(waiter_pid) as (
      select a.pid from pg_stat_activity a where ${pid}=any(pg_blocking_pids(a.pid))
      union
      select a.pid from pg_stat_activity a join waiters w on w.waiter_pid=any(pg_blocking_pids(a.pid))
    ) select coalesce(jsonb_agg(a.pid), '[]') from pg_stat_activity a join waiters w on a.pid=w.waiter_pid
      where a.query like ${q('%' + query + '%')};`);
    return waiting.length >= minimum ? waiting[0] : 0;
  }, 'Expected real lock contention was not observed.');
}
async function race(ids) {
  const gate = transaction(parentLock);
  let calls;
  try {
    const pid = await gate.ready();
    calls = Promise.all(ids.map((id) => accept(id)));
    await blockedBy(pid, 'accept_booking_request', 2);
  } finally {
    await gate.finish();
  }
  return calls;
}

function requestDeclineAudit(id) {
  return read(`select coalesce(jsonb_agg(jsonb_build_object('actor',actor_id,'role',actor_role,
    'before',previous_value,'after',new_value,'reason',reason,'metadata',metadata)), '[]') from public.audit_logs
    where entity_type='booking_requests' and entity_id=${q(id)} and action='booking_request.declined'`);
}
function assertDeclined(result, requestId, bookingType, reason) {
  assert.equal(result.status, 200, 'Valid decline did not succeed.');
  declineBookingRequestResponseSchema.parse(result.body);
  assertRawBody(
    result.body,
    { requestId, status: 'declined' },
    'Raw decline body',
  );
  assertNoAcceptance(
    requestId,
    'declined',
    bookingType === 'available_now' ? 1 : 0,
  );
  assertRawBody(
    requestDeclineAudit(requestId),
    [
      {
        actor: users.barberA,
        role: 'barber',
        before: { status: 'pending' },
        after: { status: 'declined' },
        reason: 'Barber declined the booking request.',
        metadata: { bookingType, ...(reason ? { declineReason: reason } : {}) },
      },
    ],
    'One internal decline audit',
  );
}
async function orderedActions(id, first, following) {
  const gate = transaction(
    `select 1 from public.booking_requests where id=${q(id)} for update`,
  );
  const call = (operation) =>
    operation === 'accept' ? accept(id) : decline(id, 'too_far');
  let lead;
  let follower;
  try {
    const gatePid = await gate.ready();
    lead = call(first);
    const leadPid = await blockedBy(gatePid, first + '_booking_request');
    follower = call(following);
    await blockedBy(leadPid, following + '_booking_request');
  } finally {
    await gate.finish();
  }
  return Promise.all([lead, follower]);
}

async function verifyDecline(scheduled, bulkClosed) {
  setStanding('good_standing');
  sql(`update public.booking_requests set status='cancelled'
    where service_category_id=${q(category)} and booking_type='available_now' and status='pending';`);
  const session = randomUUID();
  sql(`insert into public.available_now_sessions(id,barber_id,location,status,location_source,radius_km,available_until,consecutive_misses)
    values(${q(session)},${barber},${point},'active','gps',12,clock_timestamp()+interval '6 hours',1);`);
  const immediate = await submit('available_now');

  assert.equal((await decline(immediate, undefined, null)).status, 401);
  for (const token of [
    tokens.clientA,
    tokens.admin,
    tokens.noProfile,
    tokens.barberB,
  ]) {
    assertError(await decline(immediate, undefined, token), 403, 'forbidden');
  }
  assertError(await decline(randomUUID()), 403, 'forbidden');
  for (const [result, field] of [
    [await decline('invalid'), 'requestId'],
    [await decline(immediate, 'unsupported_reason'), 'reason'],
    [await decline(immediate, ''), 'reason'],
  ]) {
    assert.equal(result.status, 422);
    assert.ok(result.body.fields[field]);
  }
  const direct = (token, reason) =>
    post('/rest/v1/rpc/decline_booking_request', token, {
      p_barber_id: users.barberA,
      p_request_id: immediate,
      p_reason: reason,
    });
  assert.equal((await direct(tokens.barberA, 'too_far')).status, 403);
  assert.equal(
    (await direct(stack.SERVICE_ROLE_KEY, 'unsupported_reason')).status,
    422,
  );
  assertNoAcceptance(immediate);
  assertRawBody(
    requestDeclineAudit(immediate),
    [],
    'Invalid actions leave no decline audit',
  );
  pass(
    'Decline verified JWT, stored role, ownership, field errors, direct RPC denial and a database reason-code guard.',
  );

  // A restriction disallows new acceptance and still permits a voluntary reply.
  setStanding('suspended');
  assertDeclined(
    await decline(immediate, 'too_far'),
    immediate,
    'available_now',
    'too_far',
  );
  assert.equal(await clientRequest('clientA', immediate), 'declined');
  assert.equal(
    sql(`select level from public.barber_reliability_state where id=${barber}`),
    'suspended',
  );
  assert.equal(
    sql(`select s.status||':'||s.consecutive_misses||':'||r.outcome
    from public.available_now_sessions s join private.available_now_request_receipts r on r.session_id=s.id
    where s.id=${q(session)} and r.request_id=${q(immediate)}`),
    'active:0:declined',
  );
  assert.equal(
    sql(
      `select count(*) from public.audit_logs where entity_id=${q(session)} and action='available_now.responded'`,
    ),
    '1',
  );
  const hiddenAudit = await apiJson(
    stack,
    '/rest/v1/audit_logs?select=metadata&entity_id=eq.' + immediate,
    tokens.clientA,
  );
  assert.equal(hiddenAudit.status, 200);
  assertRawBody(
    hiddenAudit.body,
    [],
    'Client cannot read the internal decline audit',
  );
  pass(
    'Available Now decline reset its source misses through one response receipt. The client sees only the declined state. Suspension state is preserved.',
  );

  sql(
    `update public.available_now_sessions set consecutive_misses=1 where id=${q(session)};`,
  );
  for (const reason of [undefined, ...REQUEST_DECLINE_REASONS]) {
    const id = cloneRequest(scheduled);
    assertDeclined(await decline(id, reason), id, 'scheduled', reason);
    assert.equal(await clientRequest('clientA', id), 'declined');
  }
  assert.equal(
    sql(
      `select status||':'||consecutive_misses from public.available_now_sessions where id=${q(session)}`,
    ),
    'active:1',
  );
  assertError(await decline(bulkClosed, 'too_far'), 409, 'request_not_pending');
  assertRawBody(
    requestDeclineAudit(bulkClosed),
    [],
    'Bulk closure retained its original audit and had no response',
  );
  pass(
    'The four codes and omitted reason round-tripped to the internal audit. Scheduled declines did not affect availability. Bulk closure could not be declined again.',
  );

  const expired = cloneRequest(
    scheduled,
    "clock_timestamp() - interval '1 second'",
  );
  const undated = cloneRequest(scheduled, 'null');
  for (const id of [expired, undated]) {
    assertError(await decline(id), 409, 'request_not_pending');
    assertNoAcceptance(id);
    assertRawBody(requestDeclineAudit(id), [], 'Ineligible decline is inert');
  }
  for (const state of ['accepted', 'declined', 'expired', 'cancelled']) {
    const id = cloneRequest(scheduled, undefined, state);
    assertError(await decline(id), 409, 'request_not_pending');
    assertNoAcceptance(id, state);
    assertRawBody(requestDeclineAudit(id), [], 'Terminal decline is inert');
  }
  const lockingExpiry = cloneRequest(
    scheduled,
    "clock_timestamp()+interval '3 seconds'",
  );
  const gate = transaction(
    `select 1 from public.booking_requests where id=${q(lockingExpiry)} for update`,
  );
  let delayed;
  try {
    const pid = await gate.ready();
    delayed = decline(lockingExpiry);
    await blockedBy(pid, 'decline_booking_request');
    assert.equal(
      sql(
        `select expires_at > clock_timestamp() from public.booking_requests where id=${q(lockingExpiry)}`,
      ),
      't',
    );
    await until(
      () =>
        sql(
          `select expires_at <= clock_timestamp() from public.booking_requests where id=${q(lockingExpiry)}`,
        ) === 't',
      'Decline fixture did not expire while blocked.',
    );
  } finally {
    await gate.finish();
  }
  assertError(await delayed, 409, 'request_not_pending');
  assertRawBody(
    requestDeclineAudit(lockingExpiry),
    [],
    'Deadline crossed while waiting rolled back',
  );
  assertNoAcceptance(lockingExpiry);
  pass(
    'Expired, terminal, undated, and lock-delayed declines returned the exact conflict envelope with no effects.',
  );

  const broken = randomUUID();
  sql(`insert into public.booking_requests(id,client_id,barber_id,booking_type,status,service_category_id,expires_at)
    values(${q(broken)},${q(users.clientA)},${barber},'available_now','pending',${q(category)},clock_timestamp()+interval '5 minutes')`);
  assertError(await decline(broken, 'too_far'), 500, 'internal_error');
  assertNoAcceptance(broken);
  assertRawBody(
    requestDeclineAudit(broken),
    [],
    'Failed session hook rolled back request and audit',
  );
  sql(
    `update public.booking_requests set status='cancelled' where id=${q(broken)};`,
  );
  pass(
    'A fixture session-hook failure rolled back the request update and produced only a safe error.',
  );

  setStanding('good_standing');
  for (const template of [scheduled, immediate, scheduled]) {
    const bookingType = template === scheduled ? 'scheduled' : 'available_now';
    for (const [first, following] of [
      ['accept', 'decline'],
      ['decline', 'accept'],
      ['decline', 'decline'],
    ]) {
      const id = cloneRequest(template);
      const [winner, loser] = await orderedActions(id, first, following);
      assertError(loser, 409, 'request_not_pending');
      if (first === 'accept') {
        assertAccepted(winner, id);
        assertOneAcceptance(id, bookingType === 'available_now' ? 1 : 0);
        assertRawBody(
          requestDeclineAudit(id),
          [],
          'Losing decline had no audit',
        );
        releaseFixtureJobs();
      } else {
        assertDeclined(winner, id, bookingType, 'too_far');
      }
    }
  }
  pass(
    'Six accept–decline races in both lock orders and three duplicate-decline races. The first writer won, the loser received 409, and booking, audit and session effects applied once.',
  );
}

try {
  for (const name of ['clientA', 'clientB', 'barberA', 'barberB']) {
    const sync = await edge('create-or-sync-profile', tokens[name], {
      role: name.slice(0, -1),
    });
    assert.equal(sync.status, 200);
  }
  sql(`begin;
    insert into public.profiles(id,role,verification_status) values(${q(users.admin)},'admin','not_started');
    update public.client_profiles set display_name='QA Client',mobile='+61400000000'
      where id in (${q(users.clientA)},${q(users.clientB)});
    update public.profiles set verification_status='verified' where id=${barber};
    update public.barber_profiles set display_name='QA Barber',service_area=${point},service_radius_km=12 where id=${barber};
    insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled)
      values(${barber},'acct_LocalFixturePlatform',${q('acct_LocalFixture' + randomUUID().replaceAll('-', ''))},'verified',true,true);
    insert into public.service_categories(id,slug,display_name,description,display_order,min_price_cents,max_price_cents)
      values(${q(category)},${q('accept-qa-' + category)},'Synthetic QA Haircut','Local transaction verification',0,2000,15000);
    insert into public.barber_services(id,barber_id,service_category_id,price_cents) values(${q(service)},${barber},${q(category)},4503);
    insert into public.client_addresses(id,client_id,location,directory_id,label,line1,suburb,state,postcode,unit,access_notes)
      values ${Object.entries(addresses)
        .map(
          ([
            name,
            id,
          ]) => `(${q(id)},${q(users[name])},${point},'synthetic-accept-qa',
        'QA Home','Synthetic street','Synthetic locality','VIC','3000','QA unit','Synthetic access note')`,
        )
        .join(',')};
    insert into public.available_now_sessions(id,barber_id,location,status,location_source,radius_km,available_until,consecutive_misses)
      values(${q(sourceSession)},${barber},${point},'active','gps',12,clock_timestamp()+interval '6 hours',1);
    commit;`);
  const immediate = await submit('available_now');
  const other = await submit('available_now', 'clientB');
  const scheduled = await submit('scheduled');
  const preserveScheduled = cloneRequest(scheduled);
  const overdue = cloneRequest(other, "clock_timestamp()-interval '1 second'");

  assert.equal((await accept(immediate, null)).status, 401);
  for (const token of [
    tokens.clientA,
    tokens.admin,
    tokens.noProfile,
    tokens.barberB,
  ]) {
    assertError(await accept(immediate, token), 403, 'forbidden');
  }
  assertError(await accept(randomUUID()), 403, 'forbidden');
  const invalid = await accept('invalid');
  assert.equal(invalid.status, 422);
  assert.ok(invalid.body.fields.requestId);
  const direct = await post(
    '/rest/v1/rpc/accept_booking_request',
    tokens.barberA,
    {
      p_barber_id: users.barberA,
      p_request_id: immediate,
    },
  );
  assert.equal(direct.status, 403);
  assertNoAcceptance(immediate);
  pass(
    'Anonymous, wrong persisted roles, foreign IDs, malformed input and direct RPC denial.',
  );

  assertAccepted(await accept(scheduled), scheduled);
  assertOneAcceptance(scheduled, 0);
  assert.equal(await clientRequest('clientB', other), 'pending');
  assert.equal(
    sql(
      `select status from public.available_now_sessions where id=${q(sourceSession)}`,
    ),
    'active',
  );
  pass('Scheduled acceptance preserves the Available Now queue and session.');

  sql(`begin; update public.barber_services set price_cents=9901 where id=${q(service)};
    update public.available_now_sessions set status='cancelled' where id=${q(sourceSession)};
    insert into public.available_now_sessions(id,barber_id,location,status,location_source,radius_km,available_until,consecutive_misses)
      values(${q(currentSession)},${barber},${point},'active','gps',12,clock_timestamp()+interval '6 hours',1);
    commit;`);
  const bookingId = assertAccepted(
    await accept(immediate, tokens.barberA, {
      userId: users.barberB,
      status: 'paid_confirmed',
      servicePriceCents: 1,
      grossCents: 1,
    }),
    immediate,
  );
  assertOneAcceptance(immediate, 1);
  assert.equal(await clientRequest('clientA', immediate), 'accepted');
  assert.equal(await clientRequest('clientB', other), 'declined');
  assert.equal(await clientRequest('clientB', overdue), 'expired');
  assert.equal(await clientRequest('clientA', preserveScheduled), 'pending');
  assertNoAcceptance(other, 'declined');
  assertNoAcceptance(overdue, 'expired');
  assert.equal(
    sql(`select count(*) from public.audit_logs where action='booking_request.closed_after_acceptance'
    and metadata->>'acceptingRequestId'=${q(immediate)} and actor_id=${barber}
    and (entity_id,new_value->>'status') in ((${q(other)}::uuid,'declined'),(${q(overdue)}::uuid,'expired'));`),
    '2',
  );
  assertRawBody(
    read(`select jsonb_build_object('matchesSnapshot',
    row(b.service_price_cents,b.commission_pct_snapshot,b.gross_cents,b.commission_cents,b.barber_net_cents)
      =row(s.service_price_cents,s.commission_pct_snapshot,s.gross_cents,s.commission_cents,s.barber_net_cents),
    'lineMatches',l.barber_service_id=${q(service)} and l.service_price_cents=s.service_price_cents,
    'status',b.status,'actor',h.actor_id,'role',h.actor_role,'previous',h.from_status,'next',h.to_status,'reason',h.reason,
    'auditMatches',a.metadata->>'bookingId'=b.id::text and a.actor_id=h.actor_id and a.created_at=h.created_at)
    from public.bookings b join private.booking_request_snapshots s on s.request_id=b.request_id
    join public.booking_services l on l.booking_id=b.id join public.booking_status_history h on h.booking_id=b.id
    join public.audit_logs a on a.entity_id=b.request_id and a.action='booking_request.accepted'
    where b.id=${q(bookingId)}`),
    {
      matchesSnapshot: true,
      lineMatches: true,
      status: 'accepted_pending_payment',
      actor: users.barberA,
      role: 'barber',
      previous: null,
      next: 'accepted_pending_payment',
      reason: 'Barber accepted the booking request.',
      auditMatches: true,
    },
    'Saved cents, initial history and acceptance audit',
  );
  assertRawBody(
    read(`select jsonb_build_object('source',old.status,'sourceMisses',old.consecutive_misses,
    'current',live.status,'currentMisses',live.consecutive_misses,'receipt',receipt.session_id,'outcome',receipt.outcome,
    'busyAudit',exists(select 1 from public.audit_logs where entity_id=live.id and action='available_now.accepted'))
    from public.available_now_sessions old cross join public.available_now_sessions live
    join private.available_now_request_receipts receipt on receipt.request_id=${q(immediate)}
    where old.id=${q(sourceSession)} and live.id=${q(currentSession)}`),
    {
      source: 'cancelled',
      sourceMisses: 1,
      current: 'busy',
      currentMisses: 0,
      receipt: sourceSession,
      outcome: 'accepted',
      busyAudit: true,
    },
    'P2-T03 acts on the current session and preserves the historical source',
  );
  pass(
    'Available Now acceptance copies immutable cents, writes history/audit, uses the session hook and closes only the correct requests.',
  );

  const activeJobConflict = cloneRequest(immediate);
  assertError(await accept(activeJobConflict), 409, 'active_job_exists');
  assertNoAcceptance(activeJobConflict);
  releaseFixtureJobs();
  sql(
    `update public.booking_requests set status='cancelled' where id=${q(activeJobConflict)};`,
  );

  for (let round = 0; round < 5; round++) {
    const id = cloneRequest(scheduled);
    const results = await race(Array(8).fill(id));
    assert.equal(results.filter((result) => result.status === 200).length, 1);
    for (const result of results) {
      if (result.status === 200) assertAccepted(result, id);
      else assertError(result, 409, 'request_not_pending');
    }
    assertOneAcceptance(id, 0);
    assertError(await accept(id), 409, 'request_not_pending');
  }
  pass(
    'Five rounds of eight simultaneous API accepts with database lock contention. One booking, line item, history row and acceptance audit per request.',
  );

  for (let round = 0; round < 5; round++) {
    const ids = [cloneRequest(immediate), cloneRequest(other)];
    const results = await race(ids);
    assert.equal(results.filter((result) => result.status === 200).length, 1);
    for (const [index, result] of results.entries()) {
      const id = ids[index];
      if (result.status === 200) {
        assertAccepted(result, id);
        assertOneAcceptance(id, 1);
      } else {
        assertError(result, 409, 'request_not_pending');
        assertNoAcceptance(id, 'declined');
      }
    }
    assert.equal(
      sql(`select count(*) from public.bookings where barber_id=${barber} and booking_type='available_now'
      and status='accepted_pending_payment'`),
      '1',
    );
    releaseFixtureJobs();
  }
  pass(
    'Five two-request Available Now races each leave one active job. A separate still-pending request receives active_job_exists while the slot is occupied.',
  );

  for (const status of ['accepted', 'declined', 'expired', 'cancelled']) {
    const id = cloneRequest(scheduled, undefined, status);
    assertError(await accept(id), 409, 'request_not_pending');
    assertNoAcceptance(id, status);
  }
  const legacy = cloneRequest(scheduled, 'null');
  assertError(await accept(legacy), 409, 'request_not_pending');
  assertNoAcceptance(legacy);
  const deadline = Date.parse('2026-11-26T00:05:00.000Z');
  const boundary =
    read(`select jsonb_agg(private.booking_request_deadline_reached(
    '2026-11-26T00:05:00.000Z'::timestamptz, '2026-11-26T00:05:00.000Z'::timestamptz + n*interval '1 microsecond') order by n)
    from generate_series(-1,1) n`);
  assertRawBody(
    boundary,
    [-1, 0, 1].map((delta) =>
      requestDeadlineReached(deadline, deadline + delta),
    ),
    'Deadline comparator parity',
  );
  const lockingExpiry = cloneRequest(
    scheduled,
    "clock_timestamp()+interval '3 seconds'",
  );
  const deadlineGate = transaction(
    `select 1 from public.booking_requests where id=${q(lockingExpiry)} for update`,
  );
  let delayed;
  try {
    const pid = await deadlineGate.ready();
    delayed = accept(lockingExpiry);
    await blockedBy(pid);
    assert.equal(
      sql(
        `select expires_at > clock_timestamp() from public.booking_requests where id=${q(lockingExpiry)}`,
      ),
      't',
    );
    await until(
      () =>
        sql(
          `select expires_at <= clock_timestamp() from public.booking_requests where id=${q(lockingExpiry)}`,
        ) === 't',
      'Request did not expire under the lock.',
    );
  } finally {
    await deadlineGate.finish();
  }
  assertError(await delayed, 409, 'request_not_pending');
  assertNoAcceptance(lockingExpiry);
  pass(
    'Terminal and legacy deadlines rejected. At one microsecond before, exactly at and one after, the SQL comparator matches the domain rule. Live request elapsed while waiting and was rejected.',
  );

  // A historical booking attached to a pending request cannot be duplicated.
  // The uniqueness conflict must also roll back the preceding request update.
  const bookedRequest = cloneRequest(scheduled);
  sql(`insert into public.bookings(request_id,client_id,barber_id,booking_type,status,
    service_price_cents,commission_pct_snapshot,gross_cents,commission_cents,barber_net_cents)
    select r.id,r.client_id,r.barber_id,r.booking_type,'requested',s.service_price_cents,
      s.commission_pct_snapshot,s.gross_cents,s.commission_cents,s.barber_net_cents
    from public.booking_requests r join private.booking_request_snapshots s on s.request_id=r.id
    where r.id=${q(bookedRequest)};`);
  const existing = snapshotEffects(bookedRequest);
  assert.equal(existing.bookings, 1);
  assertError(await accept(bookedRequest), 409, 'request_not_pending');
  assertRawBody(
    snapshotEffects(bookedRequest),
    existing,
    'Uniqueness conflict rolled back the transition',
  );
  pass(
    'A conflicting historical booking rolls back request acceptance with no duplicate row or audit.',
  );

  const immediateRestricted = cloneRequest(immediate);
  const scheduledRestricted = cloneRequest(scheduled);
  setStanding('suspended');
  for (const id of [immediateRestricted, scheduledRestricted]) {
    assertError(await accept(id), 409, 'barber_unavailable');
    assertNoAcceptance(id);
  }
  const cutoff = "'2026-11-26T00:00:00Z'::timestamptz";
  setStanding('restricted', cutoff);
  assertRawBody(
    read(`select jsonb_agg(jsonb_build_array(available_now_allowed,scheduled_allowed) order by n)
    from generate_series(-1,1) n cross join lateral private.barber_booking_eligibility(${barber},${cutoff}+n*interval '1 microsecond')`),
    [
      [false, true],
      [true, true],
      [true, true],
    ],
    'Cooldown boundary',
  );
  setStanding('restricted', "clock_timestamp()+interval '1 hour'");
  assertError(await accept(immediateRestricted), 409, 'barber_unavailable');
  assertNoAcceptance(immediateRestricted);
  assertAccepted(await accept(scheduledRestricted), scheduledRestricted);
  setStanding('restricted', "clock_timestamp()-interval '1 microsecond'");
  assertAccepted(await accept(immediateRestricted), immediateRestricted);
  releaseFixtureJobs();
  pass(
    'Suspension blocks both types. A live cooldown blocks only Available Now. Exact cooldown boundary and restricted outside cooldown pass. No acceptance effects on rejection.',
  );

  for (const template of [scheduled, immediate]) {
    const denied = cloneRequest(template);
    setStanding('good_standing');
    const writerFirst = transaction(`${parentLock}; ${standing('suspended')}`);
    let pending;
    try {
      const pid = await writerFirst.ready();
      pending = accept(denied);
      await blockedBy(pid);
    } finally {
      await writerFirst.finish();
    }
    assertError(await pending, 409, 'barber_unavailable');
    assertNoAcceptance(denied);
    sql(
      `update public.booking_requests set status='cancelled' where id=${q(denied)};`,
    );

    const allowed = cloneRequest(template);
    setStanding('good_standing');
    const gate = transaction(
      `select 1 from public.booking_requests where id=${q(allowed)} for update`,
    );
    let writer;
    try {
      const pid = await gate.ready();
      pending = accept(allowed);
      const acceptPid = await blockedBy(pid);
      writer = transaction(`${parentLock}; ${standing('suspended')}`);
      await blockedBy(acceptPid, 'select 1 from public.profiles');
    } finally {
      await gate.finish();
      if (writer) await writer.finish();
    }
    assertAccepted(await pending, allowed);
    assertOneAcceptance(allowed, template === immediate ? 1 : 0);
    assert.equal(
      sql(
        `select level from public.barber_reliability_state where id=${barber}`,
      ),
      'suspended',
    );
    releaseFixtureJobs();
  }
  pass(
    'Both request types serialized in both real lock orders against a restriction writer. Existing acceptance survives a later suspension.',
  );

  const foreign = await apiJson(
    stack,
    '/rest/v1/bookings?select=id,status&id=eq.' + bookingId,
    tokens.barberB,
  );
  assert.equal(foreign.status, 200);
  assertRawBody(foreign.body, [], 'Foreign booking remains inaccessible');
  assert.equal(
    sql(
      `select count(*) from public.payments p join public.bookings b on b.id=p.booking_id where b.barber_id=${barber}`,
    ),
    '0',
  );
  pass(
    'Existing booking RLS denies a foreign barber. No payment row exists under any success or rejection. The controller transport test allows only Auth, profile and the local acceptance RPC.',
  );
  if (args.includes('--with-decline')) await verifyDecline(scheduled, other);
} finally {
  releaseFixtureJobs();
  sql(`begin;
    update public.booking_requests set status='cancelled' where service_category_id=${q(category)} and status='pending';
    update public.available_now_sessions set status='manually_disabled' where barber_id=${barber} and status='active';
    update public.barber_services set archived_at=now() where id=${q(service)} and archived_at is null;
    update public.service_categories set archived_at=now() where id=${q(category)} and archived_at is null;
    update public.client_addresses set archived_at=now() where id in (${Object.values(addresses).map(q).join(',')}) and archived_at is null;
    commit;`);
  for (const userId of Object.values(users)) {
    const deleted = await apiJson(
      stack,
      '/auth/v1/admin/users/' + userId,
      stack.SERVICE_ROLE_KEY,
      {
        method: 'DELETE',
        body: JSON.stringify({ should_soft_delete: true }),
      },
    );
    assert.equal(deleted.status, 200, 'Fixture login cleanup failed.');
  }
  pass('Synthetic fixture logins soft-deleted and test supply archived.');
}
