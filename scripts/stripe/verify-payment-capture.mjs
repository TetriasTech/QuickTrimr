import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import Stripe from 'stripe';

import { paymentRecoveryDeadline } from '../../packages/domain/src/index.ts';
import { createCaptureHandler } from '../../supabase/functions/capture-authorised-payment/handler.ts';
import { apiJson, assertRawBody, makeUsers } from '../db/api-test-helpers.mjs';
import { sqlValue as q } from '../db/core-fixtures.mjs';
import { localStatus } from '../db/local-api.mjs';
import { projectId } from '../db/local.mjs';
import { queryLocal as sql } from '../db/verify.mjs';

const key = process.env.STRIPE_SECRET_KEY ?? '';
const account = process.env.STRIPE_CONNECT_SANDBOX_ACCOUNT_ID ?? '';
assert.ok(
  /^(sk|rk)_test_[A-Za-z0-9]+$/.test(key) &&
    /^acct_[A-Za-z0-9]+$/.test(account),
);
const stripe = new Stripe(key, { maxNetworkRetries: 0, telemetry: false });
async function sanitized(call) {
  try {
    return await call();
  } catch {
    throw new Error('Sandbox API call failed. Provider details suppressed.');
  }
}
assert.ok(
  (await sanitized(() => stripe.accounts.retrieveCurrent())).id === account,
);
const stack = localStatus();
const { users, tokens } = await makeUsers(stack, {
  additional: ['bulkClient'],
  adversarialMetadata: true,
});
const serviceToken = stack.SERVICE_ROLE_KEY;
const barber = q(users.barberA);
const client = q(users.clientA);
const address = randomUUID();
const otherAddresses = { clientB: randomUUID(), bulkClient: randomUUID() };
const category = randomUUID();
const service = randomUUID();
const point = "'SRID=4326;POINT(145.2 -38.2)'::extensions.geography";
const requests = [];
const tracked = new Set();
const scheduler = 'quicktrimr.request_payments';
let installed = false;
let ownsCredential = false;
const pass = (message) => console.log('PASS ' + message);
const post = (path, token, input) =>
  apiJson(stack, path, token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
const edge = (name, token, input) =>
  post('/functions/v1/' + name, token, input);
const rpc = (name, token, input) => post('/rest/v1/rpc/' + name, token, input);
const capture = (paymentId, token = serviceToken, extra = {}) =>
  edge('capture-authorised-payment', token, { paymentId, ...extra });

async function draft(bookingType = 'scheduled', owner = 'clientA') {
  const reply = await edge('create-booking-request', tokens[owner], {
    bookingType,
    barberId: users.barberA,
    serviceCategoryId: category,
    clientAddressId: otherAddresses[owner] ?? address,
    ...(bookingType === 'scheduled'
      ? {
          scheduledFor: new Date(
            Date.now() + 86_400_000 + requests.length * 3_600_000,
          ).toISOString(),
        }
      : {}),
  });
  assert.equal(reply.status, 200, 'Synthetic request creation.');
  const requestId = reply.body.id;
  requests.push(requestId);
  return requestId;
}

async function fixture({
  accept = true,
  type = 'scheduled',
  owner = 'clientA',
} = {}) {
  const requestId = await draft(type, owner);
  const prepared = await edge('create-payment-authorisation', tokens[owner], {
    bookingRequestId: requestId,
    operation: 'prepare',
  });
  assert.equal(prepared.status, 200, 'Sandbox authorisation prepare.');
  const paymentId = prepared.body.paymentId;
  const intentId = sql(
    `select stripe_payment_intent_id from public.payments where id=${q(paymentId)}`,
  );
  assert.match(intentId, /^pi_[A-Za-z0-9]+$/);
  tracked.add(intentId);
  const hold = await sanitized(() =>
    stripe.paymentIntents.confirm(
      intentId,
      {
        payment_method: 'pm_card_visa',
        return_url: 'quicktrimr://stripe-redirect',
      },
      { idempotencyKey: 'quicktrimr:capture-qa-authorise:' + paymentId },
    ),
  );
  assert.equal(hold.status, 'requires_capture');
  const verify = () =>
    edge('create-payment-authorisation', tokens[owner], {
      bookingRequestId: requestId,
      operation: 'verify',
    });
  let verified = await verify();
  // Stripe transport outages are retryable. Re-read the already-created hold.
  for (let attempt = 0; attempt < 2 && verified.status === 502; attempt++) {
    await delay(500);
    verified = await verify();
  }
  assert.equal(verified.status, 200, 'Sandbox authorisation verify.');
  if (!accept) return { requestId, paymentId, intentId };
  const accepted = await rpc('accept_booking_request', serviceToken, {
    p_request_id: requestId,
    p_barber_id: users.barberA,
  });
  assert.equal(accepted.status, 200, 'Actual barber acceptance.');
  return { requestId, paymentId, intentId, bookingId: accepted.body.bookingId };
}
function localSqlInput(statement) {
  const result = spawnSync(
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
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: statement, encoding: 'utf8' },
  );
  assert.equal(
    result.status,
    0,
    'Local scheduler setup failed. Details suppressed.',
  );
}
function expireFixture(requestId) {
  // Use an elapsed deadline on this one disposable fixture, never the real clock.
  sql(`begin; alter table public.booking_requests disable trigger request_intent_immutable;
    update public.booking_requests set expires_at=clock_timestamp() where id=${q(requestId)};
    alter table public.booking_requests enable trigger request_intent_immutable; commit;`);
}
function snapshot({ paymentId, bookingId }) {
  return JSON.parse(
    sql(`select jsonb_build_object(
    'payment',p.status, 'gross',p.gross_cents, 'net',p.barber_net_cents, 'commission',p.commission_cents,
    'fee',p.processing_fee_cents, 'booking',b.status,
    'transitions',(select count(*) from public.booking_status_history where booking_id=b.id and to_status='paid_confirmed'),
    'notices',(select count(*) from private.payment_capture_events where payment_id=p.id),
    'outcomes',(select count(*) from public.audit_logs where entity_id=p.id and action in ('payment.captured','payment.capture_failed'))
  ) from public.payments p cross join public.bookings b where p.id=${q(paymentId)} and b.id=${q(bookingId)}`),
  );
}
async function checkNotices({ requestId, bookingId }, outcome) {
  const clientView = { p_request_id: requestId };
  const barberView = { p_booking_id: bookingId };
  const clientResult = await rpc(
    'get_client_booking_request',
    tokens.clientA,
    clientView,
  );
  const barberResult = await rpc(
    'get_barber_booking_status',
    tokens.barberA,
    barberView,
  );
  assert.equal(clientResult.status, 200);
  assert.deepEqual(Object.keys(clientResult.body).sort(), [
    'bookingType',
    'captureNotice',
    'expiresAt',
    'id',
    ...(outcome === 'capture_failed' ? ['paymentRecoveryDeadline'] : []),
    'serverNow',
    'status',
  ]);
  assert.equal(clientResult.body.captureNotice, outcome);
  assertRawBody(
    barberResult.body,
    {
      id: bookingId,
      status:
        outcome === 'captured' ? 'paid_confirmed' : 'accepted_pending_payment',
      captureNotice: outcome,
    },
    'Barber-only notice projection',
  );
  assert.equal(
    (await rpc('get_client_booking_request', tokens.clientB, clientView)).body,
    null,
  );
  assert.equal(
    (await rpc('get_barber_booking_status', tokens.barberB, barberView)).body,
    null,
  );
  assert.equal(
    (await rpc('get_barber_booking_status', tokens.clientA, barberView)).body,
    null,
  );
}

try {
  const config = JSON.parse(
    sql(
      "select value from private.platform_config where key='accepted_payment_recovery_window'",
    ),
  );
  const firstFailure = Date.parse('2026-11-28T01:00:00Z');
  for (const [kind, appointment] of [
    ['available_now', null],
    ['scheduled', firstFailure + 7_000],
    ['scheduled', firstFailure + 10_800_000],
  ]) {
    const deadline = Number(
      sql(`select extract(epoch from private.accepted_payment_recovery_deadline(
      ${q(kind)},to_timestamp(${firstFailure / 1000}),${appointment === null ? 'null' : `to_timestamp(${appointment / 1000})`},
      ${q(JSON.stringify(config))}::jsonb))*1000`),
    );
    assert.equal(
      deadline,
      paymentRecoveryDeadline(kind, firstFailure, appointment, config),
    );
  }
  pass(
    'Database and domain recovery deadlines agree for Available Now, Scheduled, and a Scheduled appointment within the recovery window.',
  );
  sql(`begin;
    insert into public.profiles(id,role,verification_status,onboarding_completed_at)
      values(${client},'client','not_started',now()),(${q(users.clientB)},'client','not_started',now()),
      (${barber},'barber','verified',now()),(${q(users.barberB)},'barber','not_started',now()),
      (${q(users.bulkClient)},'client','not_started',now());
    insert into public.client_profiles(id,display_name,mobile) values(${client},'QA Capture Client','+61400000000'),
      (${q(users.clientB)},'QA Capture Client B','+61400000001'),
      (${q(users.bulkClient)},'QA Bulk Client','+61400000002');
    insert into public.barber_profiles(id,display_name,service_area, service_radius_km)
      values(${barber},'QA Capture Barber',${point},10);
    insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled)
      values(${barber},'acct_LocalFixturePlatform',${q('acct_CaptureQA' + service.replaceAll('-', ''))},'verified',true,true);
    insert into public.service_categories(id,slug,display_name,description,display_order,min_price_cents,max_price_cents)
      values(${q(category)},${q('capture-qa-' + category)},'Synthetic QA Haircut','Local capture verification',0,2000,15000);
    insert into public.barber_services(id,barber_id,service_category_id,price_cents)
      values(${q(service)},${barber},${q(category)},4503);
    insert into public.client_addresses(id,client_id,location,directory_id,label,line1,suburb,state,postcode,unit,access_notes)
      values (${q(address)},${client},${point},'synthetic-capture-qa','QA Address','Synthetic street','Carlton','VIC','3053','',''),
      (${q(otherAddresses.clientB)},${q(users.clientB)},${point},'synthetic-capture-qa','QA Address','Synthetic street','Carlton','VIC','3053','',''),
      (${q(otherAddresses.bulkClient)},${q(users.bulkClient)},${point},'synthetic-capture-qa','QA Address','Synthetic street','Carlton','VIC','3053','','');
    commit;`);

  const pending = await fixture({ accept: false });
  assert.equal((await capture(pending.paymentId, null)).status, 401);
  for (const token of [tokens.clientA, tokens.barberA, tokens.clientB]) {
    assert.equal((await capture(pending.paymentId, token)).status, 403);
    assert.equal(
      (
        await rpc('capture_authorised_payment', token, {
          p_payment_id: pending.paymentId,
          p_step: 'begin',
        })
      ).status,
      403,
    );
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const result = await apiJson(
        stack,
        '/rest/v1/payment_capture_events',
        token,
        {
          method,
          ...(method === 'POST' || method === 'PATCH' ? { body: '{}' } : {}),
        },
      );
      assert.equal(
        result.status,
        404,
        'Private event table is absent from public API.',
      );
    }
  }
  const invalid = await capture('invalid');
  assert.equal(invalid.status, 422);
  assert.ok(invalid.body.fields.paymentId);
  assertRawBody(
    (await capture(pending.paymentId)).body,
    { error: 'invalid_status_transition' },
    'Unaccepted request denied',
  );
  const unaccepted = await sanitized(() =>
    stripe.paymentIntents.retrieve(pending.intentId),
  );
  assert.equal(unaccepted.amount_received, 0);
  pass(
    'Capture and event writes deny anonymous, participant and foreign callers. Field validation and unaccepted-booking rejection passed.',
  );

  for (let run = 1; run <= 2; run++) {
    const current = await fixture();
    const replies = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        capture(current.paymentId, serviceToken, {
          amountCents: index + 1,
          idempotencyKey: 'forged-' + index,
        }),
      ),
    );
    assert.ok(
      replies.every((reply) => [200, 502].includes(reply.status)),
      'Unexpected parallel capture response.',
    );
    for (const reply of replies.filter(({ status }) => status === 200)) {
      assert.equal(reply.body.capturedCents, 4503);
      assert.equal(reply.body.bookingStatus, 'paid_confirmed');
    }
    const repeat = await capture(current.paymentId);
    assert.equal(repeat.status, 200);
    assertRawBody(
      repeat.body,
      {
        paymentId: current.paymentId,
        status: 'captured',
        capturedCents: 4503,
        bookingStatus: 'paid_confirmed',
        idempotent: true,
      },
      'Idempotent response',
    );
    const charges = await sanitized(() =>
      stripe.charges.list({ payment_intent: current.intentId, limit: 10 }),
    );
    assert.equal(charges.data.length, 1);
    const charge = await sanitized(() =>
      stripe.charges.retrieve(charges.data[0].id, {
        expand: ['balance_transaction'],
      }),
    );
    assert.ok(
      charge.captured &&
        charge.livemode === false &&
        charge.amount_captured === 4503,
    );
    const state = snapshot(current);
    assertRawBody(
      state,
      {
        payment: 'captured',
        gross: 4503,
        net: 3603,
        commission: 900,
        fee: state.fee,
        booking: 'paid_confirmed',
        transitions: 1,
        notices: 1,
        outcomes: 1,
      },
      'One locally finalised capture and notice',
    );
    if (state.fee !== null)
      assert.equal(state.fee, charge.balance_transaction?.fee);
    await checkNotices(current, 'captured');
    pass(
      `Run ${run}: eight concurrent calls and a replay produced one Stripe charge for 4503 cents, one booking transition, one audit and one participant notice event.`,
    );
  }

  const expired = await fixture();
  sql(
    `update public.payments set authorisation_expires_at=clock_timestamp() where id=${q(expired.paymentId)}`,
  );
  const expiredResult = await capture(expired.paymentId);
  assert.equal(expiredResult.status, 409);
  assertRawBody(
    expiredResult.body,
    { error: 'authorisation_expired' },
    'Expired hold',
  );
  assert.equal(
    (await sanitized(() => stripe.paymentIntents.retrieve(expired.intentId)))
      .amount_received,
    0,
  );
  assert.equal(snapshot(expired).notices, 1);
  assert.equal(snapshot(expired).payment, 'capture_failed');
  await checkNotices(expired, 'capture_failed');
  pass(
    'Expired hold returned its distinct 409, wrote a recovery notice and produced zero capture.',
  );

  const failure = await fixture();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const handler = createCaptureHandler({
    supabaseUrl: stack.API_URL,
    serviceRoleKey: serviceToken,
    provider: {
      read: async () => ({
        status: 'capturable',
        expiresAt: Date.now() + 60_000,
      }),
      capture: async () => {
        entered.resolve();
        await release.promise;
        return { status: 'failed' };
      },
    },
  });
  const inFlight = handler(
    new Request('http://localhost/capture', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + serviceToken },
      body: JSON.stringify({ paymentId: failure.paymentId }),
    }),
  );
  try {
    await Promise.race([
      entered.promise,
      inFlight.then(() => {
        throw Error('Capture did not reach provider.');
      }),
    ]);
    const state = snapshot(failure);
    assert.equal(state.payment, 'capture_pending');
    assert.equal(state.notices, 0);
    assert.equal(
      sql(`begin; set local lock_timeout='750ms';
      select count(*) from (select id from public.booking_requests where id=${q(failure.requestId)} for update) r;
      select count(*) from (select id from public.bookings where id=${q(failure.bookingId)} for update) b;
      select count(*) from (select id from public.payments where id=${q(failure.paymentId)} for update) p;
      rollback;`)
        .split('\n')
        .filter((line) => line === '1').length,
      3,
    );
    const load = await Promise.all(
      Array.from({ length: 32 }, () =>
        rpc('get_barber_booking_status', tokens.barberA, {
          p_booking_id: failure.bookingId,
        }),
      ),
    );
    assert.ok(
      load.every(
        (item) => item.status === 200 && item.body.captureNotice === undefined,
      ),
    );
  } finally {
    release.resolve();
  }
  const failed = await inFlight;
  assert.equal(failed.status, 402);
  assertRawBody(
    await failed.json(),
    { error: 'capture_failed' },
    'Confirmed capture failure',
  );
  const state = snapshot(failure);
  assertRawBody(
    state,
    {
      payment: 'capture_failed',
      gross: 4503,
      commission: 900,
      net: 3603,
      fee: null,
      booking: 'accepted_pending_payment',
      transitions: 0,
      notices: 1,
      outcomes: 1,
    },
    'Failed capture is recoverable',
  );
  await checkNotices(failure, 'capture_failed');
  pass(
    'Injected provider rejection left booking pending, wrote one audit and notice, and 32 parallel reads plus all three row locks succeeded during suspended provider I/O.',
  );

  const swept = (requestId, token = serviceToken) =>
    edge('capture-authorised-payment/sweep', token, { requestId });
  const readIntent = (id) =>
    sanitized(() => stripe.paymentIntents.retrieve(id));
  const recover = (operation, token = tokens.clientA) =>
    edge('create-payment-authorisation', token, {
      bookingRequestId: failure.requestId,
      operation,
      recovery: true,
    });
  assert.equal((await recover('prepare', tokens.clientB)).status, 403);
  const reopened = await recover('prepare');
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.paymentId, failure.paymentId);
  const replacement = sql(
    `select stripe_payment_intent_id from public.payments where id=${q(failure.paymentId)}`,
  );
  tracked.add(replacement);
  assert.notEqual(replacement, failure.intentId);
  assert.equal((await readIntent(failure.intentId)).status, 'canceled');
  await sanitized(() =>
    stripe.paymentIntents.confirm(
      replacement,
      {
        payment_method: 'pm_card_visa',
        return_url: 'quicktrimr://stripe-redirect',
      },
      { idempotencyKey: 'quicktrimr:recovery-qa:' + failure.paymentId },
    ),
  );
  assert.equal((await recover('verify')).status, 200);
  const recoverySweep = await Promise.all(
    Array.from({ length: 8 }, () => swept(failure.requestId)),
  );
  assert.ok(recoverySweep.every(({ status }) => status === 200));
  assert.equal(snapshot(failure).payment, 'captured');
  assert.equal(snapshot(failure).transitions, 1);
  assert.equal((await readIntent(replacement)).amount_received, 4503);
  assert.equal((await readIntent(failure.intentId)).amount_received, 0);
  assert.equal(snapshot(failure).notices, 2);
  await checkNotices(failure, 'captured');
  for (const token of [
    tokens.clientA,
    tokens.clientB,
    tokens.barberA,
    tokens.barberB,
  ]) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const denied = await apiJson(
        stack,
        '/rest/v1/retired_request_payment_intents',
        token,
        {
          method,
          ...(['POST', 'PATCH'].includes(method) ? { body: '{}' } : {}),
        },
      );
      assert.equal(
        denied.status,
        404,
        'Prior provider identities are private at the API.',
      );
    }
  }
  pass(
    'Only the owning client recovered the same booking and price. Stripe confirmed release of the old hold, one replacement capture under parallel sweeps and both original failure and success notices.',
  );
  pass(
    'The retired payment identity table denied all Data API verbs to both participants and foreign users.',
  );

  const unpaid = await draft();
  const unpaidPayment = await edge(
    'create-payment-authorisation',
    tokens.clientA,
    {
      bookingRequestId: unpaid,
      operation: 'prepare',
    },
  );
  assert.equal(unpaidPayment.status, 200);
  const unpaidIntent = sql(
    `select stripe_payment_intent_id from public.payments where booking_request_id=${q(unpaid)}`,
  );
  tracked.add(unpaidIntent);
  await assert.rejects(
    () =>
      stripe.paymentIntents.confirm(
        unpaidIntent,
        {
          payment_method: 'pm_card_chargeDeclined',
          return_url: 'quicktrimr://stripe-redirect',
        },
        {
          idempotencyKey:
            'quicktrimr:decline-qa:' + unpaidPayment.body.paymentId,
        },
      ),
    (error) => error instanceof Stripe.errors.StripeCardError,
    'Expected an actual test card decline.',
  );
  const declinedAuthorisation = await edge(
    'create-payment-authorisation',
    tokens.clientA,
    {
      bookingRequestId: unpaid,
      operation: 'verify',
    },
  );
  assert.equal(declinedAuthorisation.status, 402);
  const ownerDraft = await rpc('get_client_booking_request', tokens.clientA, {
    p_request_id: unpaid,
  });
  assert.equal(ownerDraft.body.paymentRequired, true);
  const inbox = await rpc('list_barber_booking_requests', tokens.barberA, {
    p_request_id: unpaid,
  });
  assert.equal(inbox.status, 200);
  assertRawBody(inbox.body.requests, [], 'Unfunded draft is invisible');
  assertRawBody(
    (
      await apiJson(
        stack,
        '/rest/v1/booking_requests?id=eq.' + unpaid + '&select=id,status',
        tokens.barberA,
      )
    ).body,
    [],
    'Unfunded row denied through Data API',
  );
  assert.equal(
    (
      await edge('accept-booking-request', tokens.barberA, {
        requestId: unpaid,
      })
    ).status,
    409,
  );
  assert.equal((await swept(unpaid, tokens.barberA)).status, 403);
  pass(
    'A real test card decline left an owner-only draft. It was absent from the inbox and raw barber API, could not be accepted and could not trigger a worker call.',
  );

  const integrated = await fixture({ accept: false });
  const accepts = await Promise.all(
    Array.from({ length: 8 }, () =>
      edge('accept-booking-request', tokens.barberA, {
        requestId: integrated.requestId,
      }),
    ),
  );
  const winner = accepts.filter(({ status }) => status === 200);
  assert.equal(winner.length, 1);
  assert.ok(accepts.every(({ status }) => status === 200 || status === 409));
  assert.equal(winner[0].body.bookingStatus, 'paid_confirmed');
  assert.equal((await readIntent(integrated.intentId)).amount_received, 4503);
  await checkNotices(
    { ...integrated, bookingId: winner[0].body.bookingId },
    'captured',
  );
  pass(
    'Eight requests through the actual accept endpoint yielded a single winner, one verified charge and paid confirmation.',
  );

  for (const action of ['decline', 'expire', 'cancel']) {
    const current = await fixture({ accept: false });
    let terminal;
    if (action === 'decline') {
      terminal = await edge('decline-booking-request', tokens.barberA, {
        requestId: current.requestId,
      });
    } else if (action === 'expire') {
      expireFixture(current.requestId);
      terminal = await edge('expire-booking-request', serviceToken, {
        requestId: current.requestId,
      });
    } else {
      terminal = await rpc('cancel_booking_request', tokens.clientA, {
        p_request_id: current.requestId,
      });
    }
    assert.equal(terminal.status, 200);
    assert.equal((await swept(current.requestId)).status, 200);
    assert.equal((await swept(current.requestId)).status, 200);
    const released = await readIntent(current.intentId);
    assert.equal(released.status, 'canceled');
    assert.equal(released.amount_received, 0);
    assert.equal(
      sql(
        `select status from public.payments where id=${q(current.paymentId)}`,
      ),
      'authorisation_cancelled',
    );
  }
  pass(
    'Decline, expiry and client cancellation all released Stripe holds with zero capture. Repeat sweeps remained safe no-ops.',
  );

  sql(`update public.payments set recovery_deadline=clock_timestamp(),lifecycle_due_at=clock_timestamp()
    where id=${q(expired.paymentId)}`);
  assert.equal((await swept(expired.requestId)).status, 200);
  assert.equal((await readIntent(expired.intentId)).status, 'canceled');
  assert.equal(snapshot(expired).booking, 'cancelled');
  assert.equal(snapshot(expired).transitions, 0);
  assert.equal(
    sql(`select count(*) from public.booking_status_history where booking_id=${q(expired.bookingId)}
    and from_status='accepted_pending_payment' and to_status='cancelled'`),
    '1',
  );
  pass(
    'When the recovery window ended, the worker verified release and closed the unpaid booking without recording a paid confirmation.',
  );

  sql(`insert into public.available_now_sessions(barber_id,location,status,location_source,radius_km,available_until)
    values(${barber},${point},'active','manual',10,now()+interval '1 hour');`);
  const queue = [];
  for (const owner of ['clientA', 'clientB', 'bulkClient'])
    queue.push(await fixture({ accept: false, type: 'available_now', owner }));
  const [winnerRequest, other, overdue] = queue;
  expireFixture(overdue.requestId);
  const available = await edge('accept-booking-request', tokens.barberA, {
    requestId: winnerRequest.requestId,
  });
  assert.equal(available.status, 200);
  assert.equal(
    (await readIntent(winnerRequest.intentId)).amount_received,
    4503,
  );
  for (const [closed, requestStatus] of [
    [other, 'declined'],
    [overdue, 'expired'],
  ]) {
    assert.equal(
      sql(
        `select status from public.booking_requests where id=${q(closed.requestId)}`,
      ),
      requestStatus,
    );
    assert.equal((await swept(closed.requestId)).status, 200);
    const ended = await readIntent(closed.intentId);
    assert.equal(ended.status, 'canceled');
    assert.equal(ended.amount_received, 0);
    assert.equal(
      sql(
        `select count(*) from private.available_now_request_receipts where request_id=${q(closed.requestId)}`,
      ),
      '0',
    );
  }
  pass(
    'Available Now accepted and captured only the winning request. Bulk decline and expiry released both other holds without adding miss or response receipts.',
  );

  assert.equal(
    sql(`select count(*) from cron.job where jobname=${q(scheduler)}`),
    '0',
    'Use a local stack without a pre-existing lifecycle schedule for this check.',
  );
  const disconnected = await fixture({ accept: false });
  assert.equal(
    (
      await rpc('cancel_booking_request', tokens.clientA, {
        p_request_id: disconnected.requestId,
      })
    ).status,
    200,
  );
  if (
    sql(
      "select count(*) from vault.secrets where name='stripe_financial_worker_jwt'",
    ) === '0'
  ) {
    localSqlInput(
      `select vault.create_secret(${q(serviceToken)},'stripe_financial_worker_jwt');`,
    );
    ownsCredential = true;
  }
  localSqlInput(
    readFileSync(
      new URL(
        '../../supabase/operations/request-payment-lifecycle.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  installed = true;
  const waitUntil = performance.now() + 30_000;
  let persisted = '';
  do {
    persisted = sql(
      `select status from public.payments where id=${q(disconnected.paymentId)}`,
    );
    if (persisted === 'authorisation_cancelled') break;
    await delay(500);
  } while (performance.now() < waitUntil);
  assert.equal(persisted, 'authorisation_cancelled');
  assert.equal((await readIntent(disconnected.intentId)).status, 'canceled');
  pass(
    'The installed versioned pg_cron job released the remaining hold after the client disconnected, without a manual payment sweep.',
  );
} finally {
  if (installed)
    sql(
      `select cron.unschedule(jobid) from cron.job where jobname=${q(scheduler)};`,
    );
  if (ownsCredential)
    sql("delete from vault.secrets where name='stripe_financial_worker_jwt';");
  for (const id of tracked) {
    const intent = await sanitized(() => stripe.paymentIntents.retrieve(id));
    assert.equal(intent.livemode, false);
    if (intent.status === 'requires_capture')
      await sanitized(() =>
        stripe.paymentIntents.cancel(
          id,
          {},
          { idempotencyKey: 'quicktrimr:capture-qa-release:' + id },
        ),
      );
  }
  if (requests.length)
    sql(`update public.booking_requests set status='cancelled'
    where id in (${requests.map(q).join(',')}) and status='pending';`);
  sql(`update public.client_addresses set archived_at=now() where id in (${[address, ...Object.values(otherAddresses)].map(q).join(',')});
    update public.available_now_sessions set status='cancelled' where barber_id=${barber} and status in ('active','busy');
    update public.barber_services set archived_at=now() where id=${q(service)};
    update public.service_categories set archived_at=now() where id=${q(category)};`);
  for (const id of Object.values(users))
    await apiJson(stack, '/auth/v1/admin/users/' + id, serviceToken, {
      method: 'DELETE',
      body: '{"should_soft_delete":true}',
    });
}
