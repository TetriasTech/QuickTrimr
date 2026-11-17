// Local-only transaction/lease checks with fictional Stripe identifiers.
// These verify database recovery and denial, without contacting Stripe.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { apiJson, assertRawBody, makeUsers } from './api-test-helpers.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal } from './verify.mjs';

let phase = 'local status';
async function verify() {
  const local = localStatus();
  phase = 'Auth fixtures';
  const { users } = await makeUsers(local);
  const id = users.barberA;
  const platform = 'acct_QuickTrimrStorageFixture';
  const account = 'acct_StorageFixture' + randomUUID().replaceAll('-', '');
  const service = local.SERVICE_ROLE_KEY;
  const rpc = (name, input) =>
    apiJson(local, '/rest/v1/rpc/' + name, service, {
      method: 'POST',
      body: JSON.stringify({ p_platform: platform, ...input }),
    });
  queryLocal(`insert into public.profiles (id,role,verification_status)
  values ('${id}'::uuid,'barber','not_started');
  insert into public.barber_profiles (id) values ('${id}'::uuid);`);
  phase = 'reserve association';
  const reserve = await rpc('reserve_stripe_connect_account', {
    p_user_id: id,
  });
  assert.equal(reserve.status, 200);
  phase = 'record association';
  const record = await apiJson(
    local,
    '/rest/v1/rpc/record_stripe_connect_account',
    service,
    {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: id,
        p_operation_id: reserve.body.operationId,
        p_account_id: account,
      }),
    },
  );
  assert.equal(record.status, 204);
  const verified = {
    accountStatus: 'verified',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  };
  const pending = {
    accountStatus: 'requires_review',
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: true,
  };
  const start = () => rpc('begin_stripe_connect_refresh', { p_user_id: id });
  const finish = (token, state) =>
    rpc('finish_stripe_connect_refresh', {
      p_account_id: account,
      p_token: token,
      p_state: state,
    });
  const fingerprint = () =>
    queryLocal(`select json_build_object('status',a.account_status,
  'charges',a.charges_enabled,'payouts',a.payouts_enabled,
  'audits',(select count(*) from public.audit_logs where entity_id='${id}'::uuid and action='stripe.connect_status_changed'))
  from private.stripe_connect_accounts a where barber_id='${id}'::uuid;`);

  phase = 'first lease';
  let first = await start();
  assert.ok(first.body.token);
  assertRawBody(
    (await start()).body,
    { busy: true },
    'Unexpired lease serializes provider reads',
  );
  const initial = fingerprint();
  queryLocal(
    `update private.stripe_connect_accounts set refresh_until=clock_timestamp()-interval '1 second' where barber_id='${id}'::uuid;`,
  );
  phase = 'replace expired lease';
  const replacement = await start();
  assert.ok(
    replacement.body.token && replacement.body.token !== first.body.token,
  );
  phase = 'reject stale holder';
  const stale = await finish(first.body.token, verified);
  assert.notEqual(stale.status, 200);
  assert.equal(
    fingerprint(),
    initial,
    'Stale holder cannot overwrite a newer lease',
  );
  assert.equal((await finish(replacement.body.token, verified)).status, 200);
  assert.equal(
    queryLocal(
      `select count(*) from private.connect_eligible_barbers where barber_id='${id}'::uuid;`,
    ),
    '1',
  );

  phase = 'receipt conflict rollback';
  const eventId = 'evt_local_storage_' + randomUUID().replaceAll('-', '');
  const claim = await rpc('begin_stripe_connect_refresh', {
    p_account_id: account,
    p_event_id: eventId,
    p_event_type: 'v2.core.account.updated',
  });
  assert.ok(claim.body.token);
  const before = fingerprint();
  // Simulate a competing committed receipt to force a UNIQUE failure at the final
  // statement, after the proposed state and audit writes in the same transaction.
  queryLocal(`insert into private.stripe_webhook_events (platform_account_id,event_id,event_type,stripe_account_id)
  values ('${platform}','${eventId}','v2.core.account.updated','${account}');`);
  assert.notEqual((await finish(claim.body.token, pending)).status, 200);
  assert.equal(
    fingerprint(),
    before,
    'Receipt conflict rolls back both state and appended transition audit',
  );
  assert.equal(
    queryLocal(
      `select count(*) from private.connect_eligible_barbers where barber_id='${id}'::uuid;`,
    ),
    '1',
  );
  assert.equal(
    (
      await rpc('release_stripe_connect_refresh', {
        p_account_id: account,
        p_token: claim.body.token,
      })
    ).status,
    204,
  );
  assertRawBody(
    (
      await rpc('begin_stripe_connect_refresh', {
        p_account_id: account,
        p_event_id: eventId,
        p_event_type: 'v2.core.account.updated',
      })
    ).body,
    { duplicate: true },
    'Receipt survives failed duplicate processing',
  );

  phase = 'committed restriction';
  const actualEvent =
    'evt_local_transition_' + randomUUID().replaceAll('-', '');
  first = await rpc('begin_stripe_connect_refresh', {
    p_account_id: account,
    p_event_id: actualEvent,
    p_event_type: 'v2.core.account.updated',
  });
  assert.equal((await finish(first.body.token, pending)).status, 200);
  assert.equal(
    queryLocal(
      `select count(*) from private.connect_eligible_barbers where barber_id='${id}'::uuid;`,
    ),
    '0',
  );
  phase = 'append-only denial';
  for (const sql of [
    `update private.stripe_webhook_events set event_type='changed' where platform_account_id='${platform}' and event_id='${actualEvent}';`,
    `delete from private.stripe_webhook_events where platform_account_id='${platform}' and event_id='${actualEvent}';`,
  ]) {
    let denied = false;
    try {
      queryLocal(sql);
    } catch {
      denied = true;
    }
    assert.ok(denied, 'Even privileged SQL cannot rewrite event receipts.');
  }
  console.log(
    'PASS: busy lease, expired-holder fencing, receipt-conflict transaction rollback, safe restriction exclusion, durable replay receipt and append-only event ledger.',
  );
}
try {
  await verify();
} catch (error) {
  console.error(
    'Storage check failed at ' +
      phase +
      (error instanceof assert.AssertionError
        ? ': ' + error.message
        : '. Safe error only.'),
  );
  process.exitCode = 1;
}
