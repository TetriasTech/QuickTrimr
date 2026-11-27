import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import Stripe from 'stripe';

import { createCaptureHandler } from '../../supabase/functions/capture-authorised-payment/handler.ts';
import { apiJson, assertRawBody, makeUsers } from '../db/api-test-helpers.mjs';
import { sqlValue as q } from '../db/core-fixtures.mjs';
import { localStatus } from '../db/local-api.mjs';
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
const { users, tokens } = await makeUsers(stack, { adversarialMetadata: true });
const serviceToken = stack.SERVICE_ROLE_KEY;
const barber = q(users.barberA);
const client = q(users.clientA);
const address = randomUUID();
const category = randomUUID();
const service = randomUUID();
const point = "'SRID=4326;POINT(145.2 -38.2)'::extensions.geography";
const requests = [];
const tracked = new Set();
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

async function fixture({ accept = true } = {}) {
  const reply = await edge('create-booking-request', tokens.clientA, {
    bookingType: 'scheduled',
    barberId: users.barberA,
    serviceCategoryId: category,
    clientAddressId: address,
    scheduledFor: new Date(
      Date.now() + 86_400_000 + requests.length * 3_600_000,
    ).toISOString(),
  });
  assert.equal(reply.status, 200, 'Synthetic request creation.');
  const requestId = reply.body.id;
  requests.push(requestId);
  const prepared = await edge('create-payment-authorisation', tokens.clientA, {
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
  const verified = await edge('create-payment-authorisation', tokens.clientA, {
    bookingRequestId: requestId,
    operation: 'verify',
  });
  assert.equal(verified.status, 200, 'Sandbox authorisation verify.');
  if (!accept) return { requestId, paymentId, intentId };
  const accepted = await edge('accept-booking-request', tokens.barberA, {
    requestId,
  });
  assert.equal(accepted.status, 200, 'Actual barber acceptance.');
  return { requestId, paymentId, intentId, bookingId: accepted.body.bookingId };
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
  sql(`begin;
    insert into public.profiles(id,role,verification_status,onboarding_completed_at)
      values(${client},'client','not_started',now()),(${q(users.clientB)},'client','not_started',now()),
      (${barber},'barber','verified',now()),(${q(users.barberB)},'barber','not_started',now());
    insert into public.client_profiles(id,display_name,mobile) values(${client},'QA Capture Client','+61400000000');
    insert into public.barber_profiles(id,display_name,service_area, service_radius_km)
      values(${barber},'QA Capture Barber',${point},10);
    insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled)
      values(${barber},'acct_LocalFixturePlatform',${q('acct_CaptureQA' + service.replaceAll('-', ''))},'verified',true,true);
    insert into public.service_categories(id,slug,display_name,description,display_order,min_price_cents,max_price_cents)
      values(${q(category)},${q('capture-qa-' + category)},'Synthetic QA Haircut','Local capture verification',0,2000,15000);
    insert into public.barber_services(id,barber_id,service_category_id,price_cents)
      values(${q(service)},${barber},${q(category)},4503);
    insert into public.client_addresses(id,client_id,location,directory_id,label,line1,suburb,state,postcode,unit,access_notes)
      values (${q(address)},${client},${point},'synthetic-capture-qa','QA Address','Synthetic street','Carlton','VIC','3053','','');
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
  assert.equal(snapshot(expired).notices, 0);
  pass('Expired hold returned its distinct 409 and produced zero capture.');

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
} finally {
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
  sql(`update public.client_addresses set archived_at=now() where id=${q(address)};
    update public.barber_services set archived_at=now() where id=${q(service)};
    update public.service_categories set archived_at=now() where id=${q(category)};`);
  for (const id of Object.values(users))
    await apiJson(stack, '/auth/v1/admin/users/' + id, serviceToken, {
      method: 'DELETE',
      body: '{"should_soft_delete":true}',
    });
}
