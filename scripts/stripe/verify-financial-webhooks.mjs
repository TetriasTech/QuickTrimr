import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import Stripe from 'stripe';

import { createFinancialWorker } from '../../supabase/functions/stripe-webhook/financial-worker.ts';
import { apiJson, assertRawBody, makeUsers } from '../db/api-test-helpers.mjs';
import { sqlValue as q } from '../db/core-fixtures.mjs';
import { localStatus } from '../db/local-api.mjs';
import { projectId } from '../db/local.mjs';
import { queryLocal as sql } from '../db/verify.mjs';

const key = process.env.STRIPE_SECRET_KEY ?? '';
const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const platformId = process.env.STRIPE_CONNECT_SANDBOX_ACCOUNT_ID ?? '';
assert.ok(/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key), 'Use sandbox credentials.');
assert.ok(/^whsec_/.test(secret), 'Set the dedicated local signing key.');
const stripe = new Stripe(key, { maxNetworkRetries: 0, telemetry: false });
async function sandbox(call) {
  try {
    return await call();
  } catch {
    throw Error('Stripe synthetic fixture failed. Provider data suppressed.');
  }
}
assert.ok(
  (await sandbox(() => stripe.accounts.retrieveCurrent())).id === platformId,
  'Expected the Quick Trimr sandbox.',
);
const stack = localStatus();
const token = stack.SERVICE_ROLE_KEY;
const basePath = '/functions/v1/stripe-webhook';
const tag = 'evt_QT62_' + randomUUID().replaceAll('-', '') + '_';
const suffix = () => randomUUID().replaceAll('-', '');
const job = 'quicktrimr.stripe_financial_webhooks';
const receipts = () =>
  Number(
    sql(`select count(*) from private.stripe_financial_events
  where left(event_id,${tag.length})=${q(tag)}`),
  );
const stateOf = (id) =>
  sql(
    `select state from private.stripe_financial_events where event_id=${q(id)}`,
  );
const pass = (message) => console.log('PASS ' + message);
const post = (path, body, credential = token, headers = {}) =>
  apiJson(stack, path, credential, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
const rpc = (name, body = {}, credential = token) =>
  post('/rest/v1/rpc/' + name, body, credential);

function event(type, kind, objectId, account) {
  return {
    id: tag + suffix(),
    type,
    livemode: false,
    ...(account ? { account } : {}),
    data: {
      object: {
        id: objectId,
        object: kind,
        billing_details: { name: 'SYNTHETIC_PRIVATE_SENTINEL' },
      },
    },
  };
}
async function send(value, { missing = false, tampered = false } = {}) {
  const raw = JSON.stringify(value);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret,
  });
  const start = performance.now();
  const result = await apiJson(stack, basePath, null, {
    method: 'POST',
    body: tampered ? raw + ' ' : raw,
    headers: missing ? {} : { 'stripe-signature': signature },
  });
  return { ...result, ms: performance.now() - start };
}
async function sweep() {
  const result = await post(basePath + '/sweep', {});
  assert.equal(result.status, 200, 'Protected Edge worker returned an error.');
  return result.body;
}
async function deliver(value) {
  const reply = await send(value);
  assert.equal(reply.status, 200, 'Signed event was not acknowledged.');
  assertRawBody(reply.body, { received: true }, 'First receipt');
}
function psqlInput(statement) {
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
    'Local scheduler configuration failed; details suppressed.',
  );
}
function waiter(predicate) {
  return async () => {
    for (let check = 0; check < 45; check++) {
      if (predicate()) return;
      await delay(600);
    }
    throw Error('Scheduled financial event did not complete.');
  };
}

assert.equal(
  sql(`select count(*) from cron.job where jobname=${q(job)}`),
  '0',
  'Use a local stack without a pre-existing financial webhook job.',
);
assert.equal(
  sql(
    `select count(*) from private.stripe_financial_events where state in ('queued','running')`,
  ),
  '0',
  'Use a local stack without pending financial events.',
);
const { users, tokens } = await makeUsers(stack, { adversarialMetadata: true });
const client = q(users.clientA);
const barber = q(users.barberA);
const account = 'acct_QT62' + suffix();
const sandboxIntents = new Set();
let installed = false;
function booking(phase = 'accepted_pending_payment') {
  const requestId = randomUUID(),
    bookingId = randomUUID();
  sql(`begin;
    insert into public.booking_requests(id,client_id,barber_id,booking_type,status,scheduled_for,expires_at)
      values(${q(requestId)},${client},${barber},'scheduled','accepted',now()+interval '1 day',now()+interval '1 hour');
    insert into public.bookings(id,request_id,client_id,barber_id,booking_type,status,service_price_cents,
      commission_pct_snapshot,gross_cents,commission_cents,barber_net_cents)
      values(${q(bookingId)},${q(requestId)},${client},${barber},'scheduled',${q(phase)},4503,20,4503,900,3603);
    commit;`);
  return { requestId, bookingId };
}
async function payment(method = 'pm_card_visa', capture = true) {
  const fixture = booking();
  const intent = await sandbox(() =>
    stripe.paymentIntents.create(
      {
        currency: 'aud',
        amount: 4503,
        capture_method: 'manual',
        payment_method: method,
        confirm: true,
        allowed_payment_method_types: ['card'],
        return_url: 'quicktrimr://stripe-redirect',
        metadata: { quicktrimr_request_id: fixture.requestId },
      },
      { idempotencyKey: 'quicktrimr:qt62:setup:' + fixture.requestId },
    ),
  );
  assert.ok(
    intent.livemode === false && intent.status === 'requires_capture',
    'Expected a synthetic provider hold.',
  );
  sandboxIntents.add(intent.id);
  const details = await sandbox(() =>
    stripe.paymentIntents.retrieve(intent.id, { expand: ['latest_charge'] }),
  );
  const deadline =
    details.latest_charge?.payment_method_details?.card?.capture_before;
  assert.ok(
    Number.isSafeInteger(deadline),
    'Stripe did not supply a hold deadline.',
  );
  const paymentId = randomUUID();
  sql(`insert into public.payments(id,booking_request_id,booking_id,status,gross_cents,commission_cents,barber_net_cents,
    refunded_cents,stripe_payment_intent_id,authorisation_expires_at)
    values(${q(paymentId)},${q(fixture.requestId)},${q(fixture.bookingId)},${q(capture ? 'capture_pending' : 'authorised')},
      4503,900,3603,0,${q(intent.id)},to_timestamp(${deadline}));`);
  const settled = capture
    ? await sandbox(() =>
        stripe.paymentIntents.capture(
          intent.id,
          { amount_to_capture: 4503 },
          {
            idempotencyKey: 'quicktrimr:qt62:capture:' + paymentId,
          },
        ),
      )
    : intent;
  if (capture) assert.equal(settled.status, 'succeeded');
  return {
    ...fixture,
    paymentId,
    intentId: intent.id,
    chargeId: settled.latest_charge,
  };
}
function ledger(fixture) {
  return JSON.parse(
    sql(`select jsonb_build_object(
    'booking',b.status,'payment',p.status,'refunded',p.refunded_cents,
    'history',(select count(*) from public.booking_status_history where booking_id=b.id and to_status='paid_confirmed'),
    'notices',(select count(*) from private.payment_capture_events where payment_id=p.id),
    'holds',(select count(*) from private.stripe_payment_reviews where payment_id=p.id)
  ) from public.payments p join public.bookings b on b.id=p.booking_id where p.id=${q(fixture.paymentId)}`),
  );
}
function auditCount(entityId, action) {
  return Number(
    sql(
      `select count(*) from public.audit_logs where entity_id=${q(entityId)} and action=${q(action)}`,
    ),
  );
}
function reviewAuditCount(paymentId) {
  return Number(
    sql(`select count(*) from public.audit_logs a join private.stripe_payment_reviews r on r.id=a.entity_id
      where r.payment_id=${q(paymentId)} and a.action='payment.stripe_review_hold'`),
  );
}
function payoutProjection(item, earning) {
  return sql(`select i.status||':'||b.status||':'||e.status from public.payout_batch_items i
    join public.payout_batches b on b.id=i.batch_id cross join public.barber_earnings e
    where i.id=${q(item)} and e.id=${q(earning)}`);
}

try {
  sql(`begin;
    insert into public.profiles(id,role,verification_status) values
      (${client},'client','not_started'),(${barber},'barber','verified');
    insert into public.client_profiles(id) values(${client});
    insert into public.barber_profiles(id) values(${barber});
    insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,
      account_status,charges_enabled,payouts_enabled)
      values(${barber},${q(platformId)},${q(account)},'verified',true,true);
    commit;`);

  const before = receipts();
  const probe = event(
    'payment_intent.succeeded',
    'payment_intent',
    'pi_QAProbe',
  );
  for (const options of [{ missing: true }, { tampered: true }]) {
    const reply = await send(probe, options);
    assert.equal(reply.status, 400);
    assertRawBody(
      reply.body,
      { error: 'invalid_signature' },
      'Signature denial',
    );
  }
  assert.equal(receipts(), before);
  assert.equal((await post(basePath + '/sweep', {}, null)).status, 403);
  for (const auth of [tokens.clientA, tokens.barberA, tokens.clientB]) {
    assert.equal((await post(basePath + '/sweep', {}, auth)).status, 403);
    const privateTables = [
      'stripe_financial_events',
      'stripe_financial_event_attempts',
      'stripe_financial_worker',
      'stripe_refund_mappings',
      'stripe_payout_mappings',
      'stripe_payout_earning_links',
      'stripe_payment_reviews',
    ];
    await Promise.all(
      privateTables.flatMap((table) =>
        ['GET', 'POST', 'PATCH', 'DELETE'].map(async (method) => {
          const result = await apiJson(stack, '/rest/v1/' + table, auth, {
            method,
            ...(['POST', 'PATCH'].includes(method) ? { body: '{}' } : {}),
          });
          assert.equal(
            result.status,
            404,
            'Private webhook rows are absent from the client API.',
          );
        }),
      ),
    );
    for (const [name, body] of [
      ['claim_stripe_financial_events', {}],
      ['replay_stripe_financial_event', { p_event_id: probe.id }],
      ['stripe_financial_worker_health', {}],
    ])
      assert.equal((await rpc(name, body, auth)).status, 403);
  }
  assertRawBody(
    (await send(event('transfer.created', 'transfer', 'tr_QAFunding', account)))
      .body,
    { received: true },
    'Transfer acknowledgement',
  );
  assert.equal(receipts(), before);
  pass(
    'Missing and tampered signatures write nothing. Worker, replay and private rows deny participant and foreign users. Transfer events are ignored.',
  );

  await deliver(probe);
  const measurements = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      send({ ...probe, id: tag + 'load' + index }),
    ),
  );
  assert.ok(
    measurements.every((reply) => reply.status === 200),
    'Load deliveries must all acknowledge.',
  );
  const sorted = measurements.map((reply) => reply.ms).sort((a, b) => a - b);
  const p99 = sorted[98];
  assert.ok(
    p99 < 1000,
    'Acknowledgement p99 exceeded the approved one-second target (' +
      Math.round(p99) +
      ' ms).',
  );
  assert.equal(receipts(), before + 101);
  assert.equal(
    sql(`select count(*) from private.stripe_financial_events where left(event_id,${tag.length})=${q(tag)}
    and state='queued' and attempts=0`),
    '101',
  );
  const bounded = await rpc('claim_stripe_financial_events');
  assert.equal(bounded.body.jobs.length, 20);
  assert.equal(bounded.body.concurrency, 4);
  sql(
    `delete from private.stripe_financial_events where left(event_id,${tag.length})=${q(tag)}`,
  );
  assert.equal(
    (
      await rpc('release_stripe_financial_sweep', {
        p_lease: bounded.body.lease,
      })
    ).status,
    204,
  );
  pass(
    `100 concurrent signed acknowledgements with processing paused, p99 ${Math.round(p99)} ms. Receipts committed before response; a worker claim was bounded to 20 jobs and four concurrent reconciliations.`,
  );

  const paid = await payment();
  const succeeded = event(
    'payment_intent.succeeded',
    'payment_intent',
    paid.intentId,
  );
  const repeated = await Promise.all(
    Array.from({ length: 3 }, () => send(succeeded)),
  );
  assert.ok(repeated.every((reply) => reply.status === 200));
  assert.equal(
    repeated.filter(({ body }) => body.duplicate === true).length,
    2,
  );
  assert.equal(ledger(paid).payment, 'capture_pending');
  await sweep();
  assertRawBody(
    ledger(paid),
    {
      booking: 'paid_confirmed',
      payment: 'captured',
      refunded: 0,
      history: 1,
      notices: 1,
      holds: 0,
    },
    'Capture recovered with one effect',
  );
  for (const type of [
    'payment_intent.payment_failed',
    'payment_intent.succeeded',
  ])
    await deliver(event(type, 'payment_intent', paid.intentId));
  await sweep();
  assert.equal(ledger(paid).history, 1);
  assert.equal(ledger(paid).notices, 1);
  assert.equal(ledger(paid).payment, 'captured');
  assert.equal(auditCount(paid.paymentId, 'payment.captured'), 1);
  pass(
    'Three simultaneous deliveries reconciled one Stripe capture. Late payment-failed and success deliveries read the current intent. History, audit and notice counts stayed at one.',
  );

  const cancelled = await payment('pm_card_visa', false);
  await sandbox(() =>
    stripe.paymentIntents.cancel(
      cancelled.intentId,
      {},
      {
        idempotencyKey: 'quicktrimr:qt62:cancel:' + cancelled.paymentId,
      },
    ),
  );
  await deliver(
    event('payment_intent.canceled', 'payment_intent', cancelled.intentId),
  );
  await sweep();
  assert.equal(ledger(cancelled).payment, 'authorisation_cancelled');
  assert.equal(ledger(cancelled).booking, 'accepted_pending_payment');
  assert.equal(
    auditCount(cancelled.paymentId, 'payment.authorisation_cancelled'),
    1,
  );
  pass(
    'A canceled Stripe authorisation reconciled without booking confirmation.',
  );

  const firstRefund = await sandbox(() =>
    stripe.refunds.create(
      { payment_intent: paid.intentId, amount: 503 },
      {
        idempotencyKey: 'quicktrimr:qt62:mapped:' + paid.paymentId,
      },
    ),
  );
  assert.equal(firstRefund.status, 'succeeded');
  sql(`insert into private.stripe_refund_mappings(operation_id,payment_id,stripe_refund_id,amount_cents)
    values(${q(randomUUID())},${q(paid.paymentId)},${q(firstRefund.id)},503)`);
  const mappedRefund = event('charge.refunded', 'charge', paid.chargeId);
  await deliver(mappedRefund);
  const pendingRefundWorker = createFinancialWorker({
    supabaseUrl: stack.API_URL,
    serviceRoleKey: token,
    provider: async () => ({
      chargeId: paid.chargeId,
      intentId: paid.intentId,
      refunds: [{ id: firstRefund.id, status: 'pending', amount_cents: 503 }],
    }),
    log: { error: () => undefined },
  });
  assert.equal(
    (
      await pendingRefundWorker.sweep(
        new Request('http://localhost/stripe-webhook/sweep', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token },
        }),
      )
    ).status,
    200,
  );
  assert.equal(stateOf(mappedRefund.id), 'queued');
  assert.equal(ledger(paid).refunded, 0);
  sql(
    `update private.stripe_financial_events set due_at=clock_timestamp() where event_id=${q(mappedRefund.id)}`,
  );
  await sweep();
  assert.equal(ledger(paid).refunded, 503);
  assert.equal(ledger(paid).payment, 'partially_refunded');
  const other = await sandbox(() =>
    stripe.refunds.create(
      { payment_intent: paid.intentId, amount: 700 },
      {
        idempotencyKey: 'quicktrimr:qt62:unmatched:' + paid.paymentId,
      },
    ),
  );
  assert.equal(other.status, 'succeeded');
  await deliver(event('charge.refunded', 'charge', paid.chargeId));
  await sweep();
  assert.equal(ledger(paid).refunded, 503);
  assert.equal(ledger(paid).holds, 1);
  assert.equal(ledger(paid).booking, 'paid_confirmed');
  assert.equal(
    auditCount(paid.paymentId, 'payment.stripe_refund_total_reconciled'),
    1,
  );
  assert.equal(reviewAuditCount(paid.paymentId), 1);
  assert.equal(
    sql(`select private.has_stripe_payment_review_hold(${q(paid.bookingId)})`),
    't',
  );
  assert.equal(
    sql(`do $$declare detail text; begin
    insert into public.barber_earnings(booking_id,barber_id,status,gross_cents,commission_cents,barber_net_cents)
      values(${q(paid.bookingId)},${barber},'queued_for_payout',4503,900,3603);
    raise exception 'review hold failed';
    exception when check_violation then
      get stacked diagnostics detail = message_text;
      if detail <> 'stripe_payment_review_hold' then raise; end if;
    end $$;`),
    'DO',
  );
  pass(
    'A pending refund stayed queued until Stripe confirmed 503 mapped cents. An unmatched 700-cent refund created a review hold and denied queueing without changing the booking.',
  );

  const disputed = await payment('pm_card_createDispute');
  await deliver(
    event('payment_intent.succeeded', 'payment_intent', disputed.intentId),
  );
  await sweep();
  let dispute;
  for (let attempt = 0; attempt < 10 && !dispute; attempt++) {
    const records = await sandbox(() =>
      stripe.disputes.list({ charge: disputed.chargeId, limit: 1 }),
    );
    dispute = records.data[0];
    if (!dispute) await delay(500);
  }
  assert.ok(
    dispute && dispute.livemode === false,
    'Synthetic dispute was not created.',
  );
  await deliver(event('charge.dispute.created', 'dispute', dispute.id));
  await sweep();
  assert.equal(ledger(disputed).holds, 1);
  assert.equal(ledger(disputed).booking, 'paid_confirmed');
  assert.equal(ledger(disputed).payment, 'captured');
  assert.equal(reviewAuditCount(disputed.paymentId), 1);
  pass(
    'A genuine Stripe sandbox bank dispute created a review hold and preserved booking and payment history.',
  );

  const payoutBooking = booking('completed');
  const batch = randomUUID(),
    item = randomUUID(),
    earning = randomUUID(),
    payout = 'po_QT62' + suffix();
  sql(`begin;
    insert into public.barber_earnings(id,booking_id,barber_id,status,gross_cents,commission_cents,barber_net_cents)
      values(${q(earning)},${q(payoutBooking.bookingId)},${barber},'queued_for_payout',4503,900,3603);
    insert into public.payout_batches(id,status) values(${q(batch)},'processing');
    insert into public.payout_batch_items(id,batch_id,barber_id,status,barber_net_cents)
      values(${q(item)},${q(batch)},${barber},'processing',3603);
    insert into private.stripe_payout_earning_links(earning_id,item_id) values(${q(earning)},${q(item)});
    insert into private.stripe_payout_mappings(stripe_payout_id,stripe_account_id,item_id)
      values(${q(payout)},${q(account)},${q(item)});
    commit;`);
  let providerStatus = 'paid';
  const worker = createFinancialWorker({
    supabaseUrl: stack.API_URL,
    serviceRoleKey: token,
    provider: async () => ({
      status: providerStatus,
      amountCents: 3603,
      platformId,
    }),
    log: { error: () => undefined },
  });
  const workerSweep = () =>
    worker.sweep(
      new Request('http://localhost/stripe-webhook/sweep', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token },
      }),
    );
  await deliver(
    event('payout.paid', 'payout', payout, 'acct_Foreign' + suffix()),
  );
  assert.equal((await workerSweep()).status, 200);
  assert.equal(
    payoutProjection(item, earning),
    'processing:processing:queued_for_payout',
  );
  const paidPayout = event('payout.paid', 'payout', payout, account);
  await deliver(paidPayout);
  assert.equal((await workerSweep()).status, 200);
  assert.equal(payoutProjection(item, earning), 'paid:paid:paid_out');
  providerStatus = 'failed';
  await deliver(event('payout.updated', 'payout', payout, account));
  assert.equal((await workerSweep()).status, 200);
  assert.equal(
    payoutProjection(item, earning),
    'failed:failed:queued_for_payout',
  );
  providerStatus = 'paid';
  await deliver(event('payout.paid', 'payout', payout, account));
  assert.equal((await workerSweep()).status, 200);
  assert.equal(
    payoutProjection(item, earning),
    'failed:failed:queued_for_payout',
  );
  assert.equal(auditCount(item, 'payout.stripe_bank_reconciled'), 2);
  pass(
    'Payout mapper rejected the wrong account. Mapped paid then late failed reconciled with append-only effects. Stale paid did not re-credit an earning. Provider boundary simulated for P3-T11.',
  );

  const unavailable = event(
    'payment_intent.succeeded',
    'payment_intent',
    'pi_QAUnavailable',
  );
  await deliver(unavailable);
  const failedWorker = createFinancialWorker({
    supabaseUrl: stack.API_URL,
    serviceRoleKey: token,
    provider: async () => {
      throw Error('SYNTHETIC_PRIVATE_SENTINEL');
    },
    log: { error: () => undefined },
  });
  const failingSweep = () =>
    failedWorker.sweep(
      new Request('http://localhost/stripe-webhook/sweep', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token },
      }),
    );
  for (const expectedDelay of [60, 300, 900, 3600, 0]) {
    assert.equal((await failingSweep()).status, 200);
    const state = stateOf(unavailable.id);
    assert.equal(state, expectedDelay ? 'queued' : 'review');
    if (!expectedDelay) break;
    const scheduled =
      sql(`select round(extract(epoch from e.due_at-a.observed_at))::integer
      from private.stripe_financial_events e join private.stripe_financial_event_attempts a
        on a.event_id=e.id and a.attempt=e.attempts where e.event_id=${q(unavailable.id)}`);
    assert.equal(scheduled, String(expectedDelay));
    sql(
      `update private.stripe_financial_events set due_at=clock_timestamp() where event_id=${q(unavailable.id)}`,
    );
  }
  assert.equal(
    (await rpc('replay_stripe_financial_event', { p_event_id: unavailable.id }))
      .body,
    true,
  );
  const claim = await rpc('claim_stripe_financial_events');
  assert.equal(claim.status, 200);
  assert.ok(claim.body.jobs.some(({ eventId }) => eventId === unavailable.id));
  assert.equal((await rpc('claim_stripe_financial_events')).body, null);
  sql(
    'update private.stripe_financial_worker set lease_deadline=clock_timestamp()',
  );
  assert.equal((await rpc('claim_stripe_financial_events')).body, null);
  assert.equal(stateOf(unavailable.id), 'queued');
  assert.equal(
    sql(`select count(*) from private.stripe_financial_event_attempts a join private.stripe_financial_events e
    on e.id=a.event_id where e.event_id=${q(unavailable.id)} and outcome='worker_interrupted'`),
    '1',
  );
  pass(
    'Backoff was 1, 5, 15 and 60 minutes. The fifth failure entered review. Replay kept attempts, overlapping sweeps were denied, and an expired lease was recovered.',
  );

  const scheduled = event(
    'payment_intent.succeeded',
    'payment_intent',
    paid.intentId,
  );
  await deliver(scheduled);
  psqlInput(
    `select vault.create_secret(${q(token)},'stripe_financial_worker_jwt');`,
  );
  installed = true;
  psqlInput(
    readFileSync(
      new URL(
        '../../supabase/operations/stripe-webhook-worker.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await waiter(() => stateOf(scheduled.id) === 'processed')();
  assert.ok((await rpc('stripe_financial_worker_health')).body.heartbeatAt);
  pass(
    'Versioned 10-second pg_cron and pg_net executed the protected local Edge sweep and updated the heartbeat.',
  );
} finally {
  if (installed)
    sql(`select cron.unschedule(jobid) from cron.job where jobname=${q(job)};
    delete from vault.secrets where name='stripe_financial_worker_jwt';`);
  sql(`begin;
    insert into private.stripe_financial_event_attempts(event_id,attempt,outcome)
      select id,attempts,'verification_ended' from private.stripe_financial_events
        where left(event_id,${tag.length})=${q(tag)} and state='running'
      on conflict do nothing;
    update private.stripe_financial_events set state='review',lease=null
      where left(event_id,${tag.length})=${q(tag)} and state in ('queued','running');
    update private.stripe_financial_worker w set lease=null,lease_deadline=null where singleton and lease is not null
      and not exists (select from private.stripe_financial_events e where e.lease=w.lease);
    commit;`);
  for (const id of sandboxIntents) {
    const intent = await sandbox(() => stripe.paymentIntents.retrieve(id));
    if (intent.status === 'requires_capture')
      await sandbox(() =>
        stripe.paymentIntents.cancel(
          id,
          {},
          { idempotencyKey: 'quicktrimr:qt62:cleanup:' + id },
        ),
      );
  }
  for (const id of Object.values(users))
    await apiJson(stack, '/auth/v1/admin/users/' + id, token, {
      method: 'DELETE',
      body: '{"should_soft_delete":true}',
    });
}
