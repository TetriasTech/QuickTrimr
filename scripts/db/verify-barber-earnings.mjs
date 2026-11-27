import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  cancellationRefundCents,
  earningAllocation,
} from '../../packages/domain/src/index.ts';

import { apiJson, assertRawBody, makeUsers } from './api-test-helpers.mjs';
import { sqlValue as q } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal as sql } from './verify.mjs';

const stack = localStatus();
const service = stack.SERVICE_ROLE_KEY;
const { users, tokens } = await makeUsers(stack, { additional: ['admin'] });
const client = q(users.clientA);
const barber = q(users.barberA);
const uid = () => randomUUID().replaceAll('-', '');
const edge = (route, input, token = service) =>
  apiJson(stack, '/functions/v1/' + route, token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
const rpc = (route, input, token = service) =>
  apiJson(stack, '/rest/v1/rpc/' + route, token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
const create = (bookingId) => edge('create-barber-earning', { bookingId });
const release = (earningId) => edge('release-barber-earning', { earningId });
const amount = 4503;
const fee = 107;
const location = "'SRID=4326;POINT(151.2 -33.8)'::extensions.geography";
const address = q(randomUUID());
const session = q(randomUUID());
const activeCommission = Number(
  sql("select value from private.platform_config where key='commission_pct'"),
);
const snapshotCommission = activeCommission === 20 ? 17 : 20;
const commission = Number((BigInt(amount) * BigInt(snapshotCommission)) / 100n);
const net = amount - commission;

function expectError(result, status, error) {
  assert.equal(result.status, status, 'Unexpected API status for ' + error);
  assertRawBody(result.body, { error }, 'Earning error response');
}

function booking(bookingType = 'scheduled') {
  const bookingId = randomUUID();
  const requestId = randomUUID();
  const paymentId = randomUUID();
  const intentId = 'pi_EarningQA' + uid();
  const chargeId = 'ch_EarningQA' + uid();
  const transactionId = 'txn_EarningQA' + uid();
  const refundPct = bookingType === 'scheduled' ? 75 : 50;
  sql(`begin;
    insert into public.booking_requests(id,client_id,barber_id,booking_type,status,scheduled_for,expires_at,available_now_session_id)
      values(${q(requestId)},${client},${barber},${q(bookingType)},'accepted',now()+interval '1 hour',
        now()+interval '30 minutes',${bookingType === 'available_now' ? session : 'null'});
    insert into private.booking_request_snapshots(request_id,service_price_cents,commission_pct_snapshot,gross_cents,
      commission_cents,barber_net_cents,cancellation_refund_pct,cancellation_inconvenience_pct,late_cancel_window_hours,
      client_address_id,address_snapshot,address_location,client_snapshot,barber_snapshot,service_snapshot,created_at)
      values(${q(requestId)},${amount},${snapshotCommission},${amount},${commission},${net},${refundPct},${100 - refundPct},12,
      ${address},'{}',${location},'{}','{}','{}',now());
    insert into public.bookings(id,request_id,client_id,barber_id,booking_type,status,service_price_cents,
      commission_pct_snapshot,gross_cents,commission_cents,barber_net_cents)
      values(${q(bookingId)},${q(requestId)},${client},${barber},${q(bookingType)},'accepted_pending_payment',
      ${amount},${snapshotCommission},${amount},${commission},${net});
    insert into public.payments(id,booking_request_id,booking_id,status,gross_cents,commission_cents,barber_net_cents,
      refunded_cents,stripe_payment_intent_id,authorisation_expires_at)
      values(${q(paymentId)},${q(requestId)},${q(bookingId)},'capture_pending',${amount},${commission},${net},0,
      ${q(intentId)},now()+interval '1 day');
    commit;`);
  return {
    id: bookingId,
    paymentId,
    refundPct,
    chargeId,
    complete: () =>
      rpc('capture_authorised_payment', {
        p_payment_id: paymentId,
        p_step: 'complete',
        p_intent_id: intentId,
        p_captured_cents: amount,
        p_charge_id: chargeId,
        p_balance_transaction_id: transactionId,
        p_fee_cents: fee,
      }),
  };
}

function row(fixture) {
  return JSON.parse(
    sql(
      `select row_to_json(e) from public.barber_earnings e where booking_id=${q(fixture.id)}`,
    ),
  );
}
function audit(earningId, action) {
  return Number(
    sql(
      `select count(*) from public.audit_logs where entity_id=${q(earningId)} and action=${q(action)}`,
    ),
  );
}
function bookingStatus(fixture, status) {
  sql(`begin;
    insert into public.booking_status_history (booking_id,from_status,to_status,reason)
      select id,status,${q(status)},'Synthetic lifecycle verification' from public.bookings where id=${q(fixture.id)};
    update public.bookings set status=${q(status)} where id=${q(fixture.id)};
    commit;`);
}
function dispute(fixture, status) {
  sql(
    `insert into public.disputes(booking_id,status) values(${q(fixture.id)},${q(status)});`,
  );
}
function refundMapping(fixture, refunded, status, cancellation) {
  const refund = 're_EarningQA' + uid();
  sql(`insert into private.stripe_refund_mappings(operation_id,payment_id,stripe_refund_id,amount_cents,provider_status,is_cancellation)
    values(${q(randomUUID())},${q(fixture.paymentId)},${q(refund)},${refunded},${q(status)},${cancellation});`);
  return refund;
}
function applyAdjustment(fixture, refund, cancelled) {
  const allocation = earningAllocation({
    grossCents: amount,
    originalCommissionCents: commission,
    refundedCents: refund,
    retainedProcessingFeeCents: fee,
    cancellation: cancelled,
  });
  sql(`begin;
    update public.payments set status='partially_refunded', refunded_cents=${refund} where id=${q(fixture.paymentId)};
    update public.barber_earnings set commission_cents=${allocation.commissionCents},
      barber_net_cents=${allocation.barberNetCents} where booking_id=${q(fixture.id)};
    commit;`);
  return allocation;
}
async function capture() {
  const fixture = booking();
  assert.equal((await fixture.complete()).status, 200);
  return fixture;
}
function duplicateInsert(fixture) {
  sql(`do $$ begin
    insert into public.barber_earnings(booking_id,barber_id,status,gross_cents,commission_cents,barber_net_cents)
      values(${q(fixture.id)},${barber},'pending',${amount},${commission},${net});
    raise exception 'duplicate insert unexpectedly allowed';
    exception when unique_violation then null;
    end $$;`);
}

try {
  sql(`begin;
    insert into public.profiles(id,role,verification_status) values
      (${client},'client','not_started'),(${barber},'barber','verified'),
      (${q(users.barberB)},'barber','verified'),(${q(users.admin)},'admin','verified');
    insert into public.client_profiles(id) values(${client});
    insert into public.barber_profiles(id,service_area) values(${barber},${location}),(${q(users.barberB)},${location});
    insert into public.available_now_sessions(id,barber_id,location,status) values(${session},${barber},${location},'expired');
    insert into public.client_addresses(id,client_id,location) values(${address},${client},${location});
    commit;`);
  let verification;
  for (let run = 0; run < 2; run++) {
    const fixture = booking();
    expectError(await create(fixture.id), 409, 'invalid_status_transition');
    assert.equal(
      sql(
        `select count(*) from public.barber_earnings where booking_id=${q(fixture.id)}`,
      ),
      '0',
    );
    const finalized = await Promise.all(
      Array.from({ length: 8 }, () => fixture.complete()),
    );
    assert.ok(finalized.every(({ status }) => status === 200));
    const saved = row(fixture);
    assert.equal(saved.status, 'pending');
    assert.equal(saved.gross_cents, amount);
    assert.equal(saved.commission_cents, commission);
    assert.equal(saved.barber_net_cents, net);
    assert.equal(saved.available_at, null);
    assert.equal(audit(saved.id, 'earning.created'), 1);
    assert.equal(
      sql(
        `select count(*) from public.booking_status_history where booking_id=${q(fixture.id)} and to_status='paid_confirmed'`,
      ),
      '1',
    );
    const replays = await Promise.all(
      Array.from({ length: 8 }, () => create(fixture.id)),
    );
    for (const { status, body } of replays) {
      assert.equal(status, 200);
      assertRawBody(
        body,
        {
          earningId: saved.id,
          bookingId: fixture.id,
          status: 'pending',
          grossCents: amount,
          commissionCents: commission,
          barberNetCents: net,
          commissionPctSnapshot: snapshotCommission,
          idempotent: true,
        },
        'Idempotent earning replay',
      );
    }
    duplicateInsert(fixture);
    assert.equal(audit(saved.id, 'earning.created'), 1);
    verification = { fixture, saved };
  }
  assert.notEqual(snapshotCommission, activeCommission);
  console.log(
    'PASS Two rounds of eight concurrent capture commits and eight create replays produced one pending earning, one capture history row and one creation audit per booking. Unique index denied a direct duplicate.',
  );
  console.log(
    'PASS Capture-pending state created no earning. Saved commission differed from current config. Gross less commission equalled barber net in integer cents with no deduction for the recorded Stripe fee.',
  );

  const { fixture, saved } = verification;
  for (const [route, parameter, id, rpcRoute, rpcParameter] of [
    [
      'create-barber-earning',
      'bookingId',
      fixture.id,
      'create_barber_earning',
      'p_booking_id',
    ],
    [
      'release-barber-earning',
      'earningId',
      saved.id,
      'release_barber_earning',
      'p_earning_id',
    ],
  ]) {
    assert.equal((await edge(route, { [parameter]: id }, null)).status, 401);
    for (const token of [
      tokens.clientA,
      tokens.barberA,
      tokens.barberB,
      tokens.admin,
    ]) {
      expectError(
        await edge(route, { [parameter]: id }, token),
        403,
        'forbidden',
      );
      assert.equal(
        (await rpc(rpcRoute, { [rpcParameter]: id }, token)).status,
        403,
      );
    }
    const invalid = await edge(route, { [parameter]: 'invalid' });
    assert.equal(invalid.status, 422);
    assert.ok(typeof invalid.body.fields[parameter] === 'string');
    const expected = await edge(route, { [parameter]: id });
    const ignored = await edge(route, {
      [parameter]: id,
      barberNetCents: 9999,
    });
    assert.equal(ignored.status, expected.status);
    assertRawBody(ignored.body, expected.body, 'Caller amount has no effect');
    assert.equal(
      (await edge(route, { [parameter]: id, roleClaim: 'admin' })).status,
      422,
    );
    expectError(
      await edge(route, { [parameter]: randomUUID() }),
      404,
      'not_found',
    );
  }
  const ownPath =
    '/rest/v1/barber_earnings?id=eq.' +
    saved.id +
    '&select=id,booking_id,barber_id,status,gross_cents,commission_cents,barber_net_cents';
  const own = await apiJson(stack, ownPath, tokens.barberA);
  assertRawBody(
    own.body,
    [
      {
        id: saved.id,
        booking_id: fixture.id,
        barber_id: users.barberA,
        status: 'pending',
        gross_cents: amount,
        commission_cents: commission,
        barber_net_cents: net,
      },
    ],
    'Assigned barber earnings projection',
  );
  for (const token of [tokens.clientA, tokens.barberB]) {
    assertRawBody(
      (await apiJson(stack, ownPath, token)).body,
      [],
      'Unrelated earning is private',
    );
  }
  for (const token of [tokens.barberA, tokens.barberB, tokens.admin]) {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const result = await apiJson(stack, ownPath, token, {
        method,
        ...(method === 'DELETE' ? {} : { body: '{"status":"available"}' }),
      });
      assert.equal(result.status, 403, 'User table mutation denied.');
    }
  }
  console.log(
    'PASS The two running Edge Functions and their RPCs deny participant, foreign barber and admin mutations. Missing credentials, invalid UUID, extra amount, unknown entity and owning-barber-only raw row access passed.',
  );

  expectError(await release(saved.id), 409, 'invalid_status_transition');
  bookingStatus(fixture, 'completed_by_barber');
  expectError(await release(saved.id), 409, 'invalid_status_transition');
  bookingStatus(fixture, 'completed');
  const releases = await Promise.all(
    Array.from({ length: 8 }, () => release(saved.id)),
  );
  assert.ok(
    releases.every(
      ({ status, body }) => status === 200 && body.status === 'available',
    ),
  );
  assert.equal(releases.filter(({ body }) => body.applied).length, 1);
  const available = row(fixture);
  assert.ok(available.available_at);
  assert.equal(audit(saved.id, 'earning.released'), 1);
  assert.equal((await release(saved.id)).body.applied, false);
  assert.equal(row(fixture).available_at, available.available_at);
  console.log(
    'PASS Acceptance and barber-only completion denied release. Completed booking released once under eight parallel calls, preserving the first server availability timestamp and one audit record.',
  );

  const disputed = await capture();
  const disputeEarning = row(disputed).id;
  bookingStatus(disputed, 'completed');
  for (const status of ['open', 'under_review']) {
    dispute(disputed, status);
    expectError(await release(disputeEarning), 409, 'dispute_open');
    assert.equal(row(disputed).status, 'pending');
    assert.equal(audit(disputeEarning, 'earning.released'), 0);
    sql(
      `update public.disputes set status='cancelled' where booking_id=${q(disputed.id)};`,
    );
  }
  console.log(
    'PASS An open or under-review dispute returned 409 dispute_open and kept the earning pending, even when the booking fixture said completed.',
  );

  for (const type of ['scheduled', 'available_now']) {
    const cancelled = booking(type);
    assert.equal((await cancelled.complete()).status, 200);
    const earned = row(cancelled);
    const refunded = cancellationRefundCents(amount, cancelled.refundPct);
    bookingStatus(cancelled, 'cancelled');
    const allocation = applyAdjustment(cancelled, refunded, true);
    const reference = refundMapping(cancelled, refunded, 'pending', true);
    const setRefund = (status) =>
      sql(
        `update private.stripe_refund_mappings set provider_status=${q(status)} where stripe_refund_id=${q(reference)};`,
      );
    for (const status of ['pending', 'failed']) {
      setRefund(status);
      expectError(await release(earned.id), 409, 'invalid_status_transition');
    }
    setRefund('succeeded');
    sql(
      `update public.barber_earnings set barber_net_cents=${net} where id=${q(earned.id)};`,
    );
    expectError(await release(earned.id), 409, 'invalid_status_transition');
    applyAdjustment(cancelled, refunded, true);
    const outcome = await release(earned.id);
    assert.equal(outcome.status, 200);
    assertRawBody(
      outcome.body,
      {
        earningId: earned.id,
        applied: true,
        status: 'available',
        barberNetCents: allocation.barberNetCents,
      },
      'Adjusted cancellation release',
    );
    assert.equal(allocation.platformAfterProcessingCents, -fee);
    assert.equal(
      refunded +
        row(cancelled).barber_net_cents +
        row(cancelled).commission_cents,
      amount,
    );
    assert.equal(
      sql(
        `select status||':'||barber_net_cents from public.bookings where id=${q(cancelled.id)}`,
      ),
      'cancelled:' + net,
    );
    assert.equal(
      sql(
        `select count(*) from public.booking_status_history where booking_id=${q(cancelled.id)} and to_status='completed'`,
      ),
      '0',
    );
    assert.equal(audit(earned.id, 'earning.released'), 1);
  }
  console.log(
    'PASS Late Scheduled and Available Now cancellation fixtures rejected pending/failed refund mappings and the old service net. Verified adjusted cents released once with zero commission and no fake completion.',
  );

  const partial = await capture();
  const partialId = row(partial).id;
  bookingStatus(partial, 'admin_resolved');
  dispute(partial, 'resolved_operational');
  expectError(await release(partialId), 409, 'invalid_status_transition');
  const refunded = 2251;
  const serviceAllocation = applyAdjustment(partial, refunded, false);
  refundMapping(partial, refunded, 'succeeded', false);
  sql(
    `update public.disputes set status='resolved_partial_refund' where booking_id=${q(partial.id)};`,
  );
  assert.equal(
    (await release(partialId)).body.barberNetCents,
    serviceAllocation.barberNetCents,
  );
  assert.equal(
    refunded + row(partial).commission_cents + row(partial).barber_net_cents,
    amount,
  );

  const barberPaid = await capture();
  bookingStatus(barberPaid, 'admin_resolved');
  dispute(barberPaid, 'resolved_barber_paid');
  assert.equal((await release(row(barberPaid).id)).body.barberNetCents, net);
  const full = await capture();
  bookingStatus(full, 'refunded');
  dispute(full, 'resolved_client_refund');
  sql(
    `update public.payments set status='refunded', refunded_cents=${amount} where id=${q(full.paymentId)};`,
  );
  expectError(await release(row(full).id), 409, 'invalid_status_transition');
  console.log(
    'PASS Admin barber-paid used the normal split and a verified partial service refund used proportional commission. Operational-only and full-refund outcomes had no release.',
  );

  sql(`insert into private.stripe_payment_reviews(payment_id,source,object_id,observed_cents,provider_status)
    values(${q(fixture.paymentId)},'bank_dispute',${q('du_EarningQA' + uid())},${amount},'needs_response');`);
  sql(`do $$ declare detail text; begin
    update public.barber_earnings set status='queued_for_payout' where id=${q(saved.id)};
    raise exception 'provider review hold unexpectedly bypassed';
    exception when check_violation then
      get stacked diagnostics detail = message_text;
      if detail <> 'stripe_payment_review_hold' then raise; end if;
    end $$;`);
  assert.equal(row(fixture).status, 'available');
  console.log(
    'PASS Existing Stripe financial-review hold still blocked payout queueing for the released earning.',
  );
} finally {
  for (const id of Object.values(users))
    await apiJson(stack, '/auth/v1/admin/users/' + id, service, {
      method: 'DELETE',
      body: '{"should_soft_delete":true}',
    });
}
