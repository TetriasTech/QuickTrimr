// P2-T08: real local JWT/API/concurrency evidence. No hosted or Stripe calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  requestSnapshot,
  scheduledTimeIssue,
} from '../../packages/domain/src/index.ts';
import { createBookingRequestResponseSchema } from '../../packages/validation/src/index.ts';

import { apiJson, makeUsers } from './api-test-helpers.mjs';
import { sqlValue } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal } from './verify.mjs';
assert.equal(process.argv.length, 2);
mkdirSync('docs/qa/evidence/P2-T08', { recursive: true });
const evidencePath = 'docs/qa/evidence/P2-T08/api.json';
writeFileSync(evidencePath, JSON.stringify({ result: 'RUNNING' }) + '\n');
const status = localStatus();
assert.equal(status.API_URL, 'http://127.0.0.1:55321');
const { users, tokens } = await makeUsers(status, { additional: ['admin'] });
const post = (name, token, input) =>
  apiJson(status, '/functions/v1/' + name, token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
const sql = queryLocal;
const q = sqlValue;
const read = (s) => JSON.parse(sql(s));
const checks = [];
const pass = (label) => {
  checks.push(label);
  console.log('PASS ' + label);
};
const category = randomUUID(),
  address = randomUUID(),
  foreignAddress = randomUUID(),
  service = randomUUID();
const cfgKeys = [
  'commission_pct',
  'available_request_expiry_minutes',
  'scheduled_request_expiry_hours',
  'cancel_refund_pct',
  'inconvenience_pct',
  'late_cancel_window_hours',
];
const savedConfig = read(
  `select jsonb_object_agg(key,value) from private.platform_config where key in (${cfgKeys.map(q).join(',')});`,
);
const policy = {
  commissionPct: 20,
  refundPct: { scheduled: 75, available_now: 50 },
  inconveniencePct: { scheduled: 25, available_now: 50 },
  lateCancellationHours: 12,
  availableExpiryMinutes: 5,
  scheduledExpiryHours: 2,
};
const clearPending = () =>
  sql(
    `update public.booking_requests set status='cancelled' where client_id=${q(users.clientA)} and status='pending';`,
  );
let requestId;
try {
  for (const name of ['clientA', 'clientB', 'barberA', 'barberB'])
    assert.equal(
      (
        await post('create-or-sync-profile', tokens[name], {
          role: name.startsWith('client') ? 'client' : 'barber',
        })
      ).status,
      200,
    );
  sql(`insert into public.profiles(id,role,verification_status) values(${q(users.admin)},'admin','not_started');
 update public.client_profiles set display_name='Synthetic QA Client',mobile='+61400000000' where id in(${q(users.clientA)},${q(users.clientB)});
 update public.barber_profiles set display_name='Synthetic QA Barber',bio='Disposable local request verification',years_experience=10,service_area='SRID=4326;POINT(145.2 -38.2)',service_radius_km=12 where id in(${q(users.barberA)},${q(users.barberB)});
 insert into public.service_categories(id,slug,display_name,description,display_order,min_price_cents,max_price_cents) values(${q(category)},${q('request-qa-' + category)},'Synthetic QA Haircut','Local request evidence',0,2000,15000);
 insert into public.barber_services(id,barber_id,service_category_id,price_cents) values(${q(service)},${q(users.barberA)},${q(category)},4503);
 insert into public.client_addresses(id,client_id,location,directory_id,label,line1,suburb,state,postcode,unit,access_notes) values
 (${q(address)},${q(users.clientA)},'SRID=4326;POINT(145.2 -38.2)','synthetic-local-request','QA Home','Synthetic private road','Synthetic locality','VIC','3000','','Synthetic access note'),
 (${q(foreignAddress)},${q(users.clientB)},'SRID=4326;POINT(145.2 -38.2)','synthetic-local-request','QA Other','Synthetic other road','Synthetic locality','VIC','3000','','');
 insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled) values(${q(users.barberA)},'acct_LocalFixturePlatform',${q('acct_LocalFixture' + randomUUID().replaceAll('-', ''))},'verified',true,true);
 update public.profiles set verification_status='verified' where id=${q(users.barberA)};
 insert into public.available_now_sessions(barber_id,location,status,location_source,radius_km,available_until) values(${q(users.barberA)},'SRID=4326;POINT(145.2 -38.2)','active','gps',12,clock_timestamp()+interval '6 hours');`);
  // Reuse installed public SAL data; no synthetic geography or image artifact.
  const area = sql(
    `select id from public.public_areas where extensions.st_covers(boundary,extensions.st_setsrid(extensions.st_point(145.2,-38.2),4326)) order by id limit 1`,
  );
  assert.ok(
    area,
    'Import the public SAL dataset before the discovery-to-request proof',
  );
  sql(`update public.barber_profiles set public_area_id=${q(area)} where id in(${q(users.barberA)},${q(users.barberB)});
   update public.available_now_sessions set public_area_id=${q(area)} where barber_id=${q(users.barberA)} and status='active';
   insert into public.barber_services(barber_id,service_category_id,price_cents) values(${q(users.barberB)},${q(category)},4503);
   insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled) values(${q(users.barberB)},'acct_LocalFixturePlatform',${q('acct_LocalFixture' + randomUUID().replaceAll('-', ''))},'verified',true,true);
   update public.profiles set verification_status='verified' where id=${q(users.barberB)};
   insert into public.available_now_sessions(barber_id,location,status,location_source,radius_km,available_until,public_area_id) values(${q(users.barberB)},'SRID=4326;POINT(145.2 -38.2)','active','gps',12,clock_timestamp()+interval '6 hours',${q(area)});`);
  const input = {
    bookingType: 'available_now',
    barberId: users.barberA,
    serviceCategoryId: category,
    clientAddressId: address,
    notes: 'Synthetic private request note',
  };
  const call = (extra = {}, token = tokens.clientA) =>
    post('create-booking-request', token, { ...input, ...extra });
  const noAuth = await call({}, null);
  assert.equal(noAuth.status, 401);
  for (const name of ['barberA', 'barberB', 'admin'])
    assert.equal((await call({}, tokens[name])).status, 403);
  for (const extra of [
    { barberId: 'bad' },
    { bookingType: 'scheduled' },
    { scheduledFor: '2026-12-01T00:00:00Z' },
  ]) {
    const r = await call(extra);
    assert.equal(r.status, 422);
    assert.ok(Object.keys(r.body.fields).length);
  }
  const rpc = await apiJson(
    status,
    '/rest/v1/rpc/create_booking_request',
    tokens.clientA,
    {
      method: 'POST',
      body: JSON.stringify({ p_client_id: users.clientB, p_input: input }),
    },
  );
  assert.ok([401, 403, 404].includes(rpc.status));
  pass(
    'Real JWT auth, every unpermitted role, field validation and direct RPC denial',
  );
  const forged = {
    userId: users.clientB,
    status: 'accepted',
    amountCents: 1,
    servicePriceCents: 1,
    commissionPct: 99,
    grossCents: 1,
    commissionCents: 0,
    barberNetCents: 1,
    idempotencyKey: 'fake',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  let response = await call(forged);
  assert.equal(response.status, 200);
  createBookingRequestResponseSchema.parse(response.body);
  requestId = response.body.id;
  const expected = requestSnapshot(
    4503,
    'available_now',
    Date.parse(response.body.createdAt),
    policy,
  );
  for (const name of [
    'servicePriceCents',
    'commissionPct',
    'grossCents',
    'commissionCents',
    'barberNetCents',
  ])
    assert.equal(response.body[name], expected[name]);
  assert.equal(
    Date.parse(response.body.expiresAt) - Date.parse(response.body.createdAt),
    300000,
  );
  const original = sql(
    `select to_jsonb(s)::text from private.booking_request_snapshots s where request_id=${q(requestId)}`,
  );
  const privateRow = JSON.parse(original);
  assert.equal(privateRow.client_address_id, address);
  assert.equal(privateRow.cancellation_refund_pct, 50);
  assert.equal(privateRow.cancellation_inconvenience_pct, 50);
  assert.equal(privateRow.late_cancel_window_hours, 12);
  assert.equal(
    sql(
      `select available_now_session_id=(select id from public.available_now_sessions where barber_id=${q(users.barberA)} and status='active') from public.booking_requests where id=${q(requestId)}`,
    ),
    't',
  );
  const duplicate = await call();
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, 'active_request_exists');
  pass(
    'Available Now snapshots: integer cents, uneven-cent rounding, ignored forged amounts and current source session',
  );
  // Private snapshots never become a barber pre-acceptance read. All API verbs.
  for (const token of [
    tokens.clientA,
    tokens.clientB,
    tokens.barberA,
    tokens.barberB,
    tokens.admin,
  ]) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const r = await apiJson(
        status,
        '/rest/v1/booking_request_snapshots',
        token,
        {
          method,
          headers: {
            [method === 'GET' ? 'accept-profile' : 'content-profile']:
              'private',
          },
          ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
        },
      );
      assert.equal(r.status, 406);
      assert.equal(r.body.code, 'PGRST106');
    }
  }
  assert.equal(
    sql(
      "select relrowsecurity from pg_class where oid='private.booking_request_snapshots'::regclass",
    ),
    't',
  );
  const safeFields =
    'id,client_id,barber_id,booking_type,status,service_category_id,barber_service_id,scheduled_for,expires_at,created_at,updated_at';
  const own = await apiJson(
    status,
    `/rest/v1/booking_requests?select=${safeFields}&id=eq.${requestId}`,
    tokens.barberA,
  );
  assert.equal(own.status, 200);
  assert.equal(own.body.length, 1);
  assert.deepEqual(
    Object.keys(own.body[0]).sort(),
    safeFields.split(',').sort(),
  );
  for (const token of [tokens.clientB, tokens.barberB]) {
    const r = await apiJson(
      status,
      `/rest/v1/booking_requests?select=${safeFields}&id=eq.${requestId}`,
      token,
    );
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
  }
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const r = await apiJson(
      status,
      '/rest/v1/booking_requests?id=eq.' + requestId,
      tokens.clientA,
      {
        method,
        ...(method === 'DELETE'
          ? {}
          : {
              body: JSON.stringify(
                method === 'POST'
                  ? {
                      client_id: users.clientA,
                      barber_id: users.barberA,
                      booking_type: 'available_now',
                      status: 'pending',
                    }
                  : { status: 'accepted' },
              ),
            }),
      },
    );
    assert.equal(r.status, 403);
    assert.equal(r.body.code, '42501');
  }
  const hidden = await apiJson(
    status,
    '/rest/v1/booking_requests?select=intent_key&id=eq.' + requestId,
    tokens.barberA,
  );
  assert.equal(hidden.status, 403);
  assert.equal(
    sql(
      `select count(*) from public.audit_logs where entity_id=${q(requestId)} and action='booking_request.created'`,
    ),
    '1',
  );
  for (const table of [
    'private.booking_request_snapshots',
    'public.audit_logs',
  ]) {
    const canMutate = sql(
      `do $$begin begin update ${table} set ${table.startsWith('private') ? 'notes=notes' : 'action=action'} where ${table.startsWith('private') ? 'request_id' : 'entity_id'}=${q(requestId)}; raise exception 'mutation_was_allowed'; exception when sqlstate '55000' then null; end; end $$;`,
    );
    assert.equal(canMutate, 'DO');
  }
  pass(
    'Private snapshot API denial for all roles/verbs; raw barber response, cross-user RLS, direct-write denial and append-only audit',
  );
  clearPending();
  const scheduledFor = new Date(Date.now() + 86400000).toISOString();
  response = await call({ bookingType: 'scheduled', scheduledFor });
  assert.equal(response.status, 200);
  const scheduledId = response.body.id;
  assert.equal(
    Date.parse(response.body.expiresAt) - Date.parse(response.body.createdAt),
    7200000,
  );
  const scheduledOriginal = sql(
    `select to_jsonb(s)::text from private.booking_request_snapshots s where request_id=${q(scheduledId)}`,
  );
  const scheduledRow = JSON.parse(scheduledOriginal);
  assert.equal(scheduledRow.cancellation_refund_pct, 75);
  assert.equal(scheduledRow.cancellation_inconvenience_pct, 25);
  // Same time/intent remains a duplicate with alternate timezone notation/address/notes/key.
  const dupe = await call({
    bookingType: 'scheduled',
    scheduledFor: scheduledFor.replace('Z', '+00:00'),
    notes: 'different',
    idempotencyKey: 'different',
  });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.body.error, 'duplicate_request_intent');
  assert.equal(
    (
      await call({
        bookingType: 'scheduled',
        scheduledFor: new Date(Date.parse(scheduledFor) + 1000).toISOString(),
      })
    ).status,
    200,
  );
  pass(
    'Scheduled snapshots, canonical-time duplicate intent and distinct nearby requested times without an invented overlap/calendar rule',
  );
  sql(`update private.platform_config set value=case key when 'commission_pct' then '33'::jsonb when 'cancel_refund_pct' then '{"scheduled":80,"available_now":60}'::jsonb when 'inconvenience_pct' then '{"scheduled":20,"available_now":40}'::jsonb when 'late_cancel_window_hours' then '8'::jsonb when 'available_request_expiry_minutes' then '7'::jsonb when 'scheduled_request_expiry_hours' then '3'::jsonb end where key in (${cfgKeys.map(q).join(',')});
 update public.client_addresses set line1='Synthetic changed road',access_notes='Changed access' where id=${q(address)};`);
  const repriced = await post('upsert-barber-service', tokens.barberA, {
    serviceCategoryId: category,
    priceCents: 4999,
    enabled: true,
  });
  assert.equal(repriced.status, 200);
  assert.ok(
    sql(
      `select to_jsonb(s)::text from private.booking_request_snapshots s where request_id=${q(requestId)}`,
    ) === original,
    'Available snapshot changed (values suppressed)',
  );
  assert.ok(
    sql(
      `select to_jsonb(s)::text from private.booking_request_snapshots s where request_id=${q(scheduledId)}`,
    ) === scheduledOriginal,
    'Scheduled snapshot changed (values suppressed)',
  );
  response = await call({
    bookingType: 'scheduled',
    scheduledFor: new Date(Date.now() + 2 * 86400000).toISOString(),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.servicePriceCents, 4999);
  assert.equal(response.body.commissionPct, 33);
  assert.equal(response.body.commissionCents, 1649);
  assert.equal(
    Date.parse(response.body.expiresAt) - Date.parse(response.body.createdAt),
    10800000,
  );
  const changed = read(
    `select jsonb_build_object('refund',cancellation_refund_pct,'inconvenience',cancellation_inconvenience_pct,'window',late_cancel_window_hours) from private.booking_request_snapshots where request_id=${q(response.body.id)}`,
  );
  assert.deepEqual(changed, { refund: 80, inconvenience: 20, window: 8 });
  pass(
    'Historical price/address/cancellation snapshots survive edits; new requests use changed server config and price',
  );
  clearPending();
  for (const extra of [
    { clientAddressId: foreignAddress },
    { clientAddressId: randomUUID() },
  ]) {
    const r = await call(extra);
    assert.equal(r.status, 422);
    assert.ok(r.body.fields.clientAddressId);
  }
  sql(
    `update public.client_addresses set archived_at=now() where id=${q(address)};`,
  );
  assert.equal((await call()).status, 422);
  sql(
    `update public.client_addresses set archived_at=null where id=${q(address)};`,
  );
  sql(
    `update public.client_profiles set mobile=null where id=${q(users.clientA)};`,
  );
  assert.equal((await call()).status, 403);
  sql(
    `update public.client_profiles set mobile='+61400000000' where id=${q(users.clientA)};`,
  );
  for (const date of [
    new Date(Date.now() + 3600000),
    new Date(Date.now() + 31 * 86400000),
  ]) {
    const r = await call({
      bookingType: 'scheduled',
      scheduledFor: date.toISOString(),
    });
    assert.equal(r.status, 422);
    assert.ok(r.body.fields.scheduledFor);
  }
  pass(
    'Foreign/archived/missing addresses, incomplete client and out-of-bounds scheduled times rejected',
  );
  for (const mutation of [
    `update private.stripe_connect_accounts set charges_enabled=false where barber_id=${q(users.barberA)}`,
    `update private.stripe_connect_accounts set payouts_enabled=false where barber_id=${q(users.barberA)}`,
    `update public.barber_services set archived_at=now() where id=${q(service)}`,
    `update public.available_now_sessions set status='manually_disabled' where barber_id=${q(users.barberA)} and status='active'`,
    `update public.client_addresses set location='SRID=4326;POINT(151 -33)' where id=${q(address)}`,
  ]) {
    sql(mutation);
    const r = await call();
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'barber_unavailable');
    const scheduled = await call({
      bookingType: 'scheduled',
      scheduledFor: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(
      scheduled.status,
      mutation.includes('manually_disabled') ? 200 : 409,
    );
    clearPending();
    sql(`update private.stripe_connect_accounts set charges_enabled=true,payouts_enabled=true where barber_id=${q(users.barberA)};
   update public.barber_services set archived_at=null where id=${q(service)};
   update public.available_now_sessions set status='active' where barber_id=${q(users.barberA)} and status='manually_disabled';
   update public.client_addresses set location='SRID=4326;POINT(145.2 -38.2)' where id=${q(address)};`);
  }
  for (const type of ['available_now', 'scheduled']) {
    const search = await post('search-available-now-barbers', tokens.clientA, {
      bookingType: type,
      ...(type === 'scheduled'
        ? { scheduledFor: new Date(Date.now() + 86400000).toISOString() }
        : {}),
      serviceCategoryId: category,
      lat: -38.2,
      lng: 145.2,
      radiusKm: 10,
    });
    assert.equal(search.status, 200);
    assert.ok(search.body.results.some((r) => r.barberId === users.barberA));
    const before = sql(
      `select count(*) from public.booking_requests where client_id=${q(users.clientA)}`,
    );
    sql(
      `insert into public.barber_reliability_state(id,level) values(${q(users.barberA)},'suspended') on conflict(id) do update set level='suspended'`,
    );
    const denied = await call({
      bookingType: type,
      ...(type === 'scheduled'
        ? { scheduledFor: new Date(Date.now() + 86400000).toISOString() }
        : {}),
    });
    assert.equal(denied.status, 409);
    assert.equal(denied.body.error, 'barber_unavailable');
    assert.equal(
      sql(
        `select count(*) from public.booking_requests where client_id=${q(users.clientA)}`,
      ),
      before,
    );
    sql(
      `update public.barber_reliability_state set level='good_standing',cooldown_until=null where id=${q(users.barberA)}`,
    );
  }
  pass(
    'Successful discovery followed by suspension cannot create a request in either type; denial has no request side effect',
  );
  // The target is looked up fresh, even after successful discovery/public reads.
  for (const type of ['available_now', 'scheduled'])
    for (const level of [
      'good_standing',
      'watch',
      'limited',
      'restricted',
      'suspended',
    ])
      for (const delta of [-1, 0, 1]) {
        const now = '2026-11-22T00:00:00Z',
          deadline = new Date(Date.parse(now) + delta).toISOString();
        sql(
          `insert into public.barber_reliability_state(id,level,cooldown_until) values(${q(users.barberA)},${q(level)},${q(delta > 0 ? new Date(Date.now() + 3600000).toISOString() : new Date(Date.now() - 3600000).toISOString())}) on conflict(id) do update set level=excluded.level,cooldown_until=excluded.cooldown_until;`,
        );
        // Future-facing deadline is relevant only to Available Now, regardless of level.
        const expectedAllowed =
          level !== 'suspended' && (type === 'scheduled' || delta <= 0);
        const r = await call({
          bookingType: type,
          ...(type === 'scheduled'
            ? { scheduledFor: new Date(Date.now() + 86400000).toISOString() }
            : {}),
        });
        assert.equal(
          r.status,
          expectedAllowed ? 200 : 409,
          `${type}/${level}/${delta}`,
        );
        if (!expectedAllowed) assert.equal(r.body.error, 'barber_unavailable');
        clearPending();
        sql(
          `update public.barber_reliability_state set cooldown_until=${q(deadline)} where id=${q(users.barberA)};`,
        );
        const edge = read(
          `select to_jsonb(e) from private.barber_booking_eligibility(${q(users.barberA)},${q(now)}) e;`,
        );
        assert.equal(
          edge.available_now_allowed,
          level !== 'suspended' && delta <= 0,
        );
        assert.equal(edge.scheduled_allowed, level !== 'suspended');
      }
  sql(
    `update public.barber_reliability_state set level='suspended',cooldown_until=null where id=${q(users.barberA)};`,
  );
  for (const extra of [
    { level: 'good_standing' },
    { cooldownUntil: null },
    { available_now_session_id: randomUUID() },
    { availableNowAllowed: true },
  ])
    assert.equal((await call(extra)).status, 422);
  sql(
    `update public.barber_reliability_state set level='good_standing',cooldown_until=null where id=${q(users.barberA)};`,
  );
  pass(
    'Direct request eligibility covers both types, all levels and exact cooldown boundaries; forged standing/deadline/session rejected',
  );
  for (const type of ['available_now', 'scheduled'])
    for (let run = 0; run < 5; run++) {
      const extra = {
        bookingType: type,
        ...(type === 'scheduled'
          ? {
              scheduledFor: new Date(
                Date.now() + 86400000 + run * 1000,
              ).toISOString(),
            }
          : {}),
      };
      const results = await Promise.all(
        Array.from({ length: 8 }, () => call(extra)),
      );
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      assert.equal(results.filter((r) => r.status === 409).length, 7);
      const winner = results.find((r) => r.status === 200).body.id;
      assert.equal(
        sql(
          `select count(*) from public.audit_logs where entity_id=${q(winner)} and action='booking_request.created'`,
        ),
        '1',
      );
      assert.equal(
        sql(
          `select count(*) from public.booking_requests where client_id=${q(users.clientA)} and status='pending'`,
        ),
        '1',
      );
      clearPending();
    }
  pass(
    'Real parallel double-submit: five runs × eight calls per type; exactly one request/snapshot/audit winner',
  );
  for (let run = 0; run < 5; run++) {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        call({ barberId: i % 2 ? users.barberA : users.barberB }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(
      results.filter(
        (r) => r.status === 409 && r.body.error === 'active_request_exists',
      ).length,
      7,
    );
    clearPending();
  }
  pass(
    'Five parallel cross-barber batches preserve the client-wide one-active-Available-Now invariant',
  );
  // A source-session replacement never rewrites earlier request provenance.
  const prior = await call();
  assert.equal(prior.status, 200);
  const oldSession = sql(
    `select available_now_session_id from public.booking_requests where id=${q(prior.body.id)}`,
  );
  clearPending();
  sql(`begin;select 1 from public.profiles where id=${q(users.barberA)} for update;
    update public.available_now_sessions set status='cancelled' where barber_id=${q(users.barberA)} and status='active';
    insert into public.available_now_sessions(barber_id,location,status,location_source,radius_km,available_until,public_area_id) values(${q(users.barberA)},'SRID=4326;POINT(145.2 -38.2)','active','gps',12,clock_timestamp()+interval '6 hours',${q(area)});commit;`);
  const replacement = await call();
  assert.equal(replacement.status, 200);
  assert.equal(
    sql(
      `select available_now_session_id from public.booking_requests where id=${q(prior.body.id)}`,
    ),
    oldSession,
  );
  assert.notEqual(
    sql(
      `select available_now_session_id from public.booking_requests where id=${q(replacement.body.id)}`,
    ),
    oldSession,
  );
  clearPending();
  pass(
    'Server source-session selection follows replacement; earlier request provenance remains unchanged',
  );
  // Reproduce the competing Connect writer without any provider call. Its own
  // transaction owns the account row before publishing the profile gate.
  const fixtureAccount = sql(
    `select stripe_account_id from private.stripe_connect_accounts where barber_id=${q(users.barberA)}`,
  );
  for (let run = 0; run < 5; run++) {
    const refreshToken = randomUUID();
    sql(
      `update private.stripe_connect_accounts set refresh_token=${q(refreshToken)},refresh_until=clock_timestamp()+interval '1 minute',refresh_actor=${q(users.barberA)} where barber_id=${q(users.barberA)}`,
    );
    const [request, refresh] = await Promise.all([
      call(),
      apiJson(
        status,
        '/rest/v1/rpc/finish_stripe_connect_refresh',
        status.SERVICE_ROLE_KEY,
        {
          method: 'POST',
          body: JSON.stringify({
            p_platform: 'acct_LocalFixturePlatform',
            p_account_id: fixtureAccount,
            p_token: refreshToken,
            p_state: {
              accountStatus: 'requires_review',
              chargesEnabled: false,
              payoutsEnabled: false,
              detailsSubmitted: true,
            },
          }),
        },
      ),
    ]);
    assert.ok(
      [200, 409].includes(request.status),
      'Concurrent Connect refresh caused an unexpected request error',
    );
    assert.equal(refresh.status, 200);
    assert.equal((await call()).status, 409);
    clearPending();
    sql(
      `update private.stripe_connect_accounts set account_status='verified',charges_enabled=true,payouts_enabled=true where barber_id=${q(users.barberA)}; update public.profiles set verification_status='verified' where id=${q(users.barberA)}`,
    );
  }
  pass(
    'Five real parallel Connect-refresh/request races: no deadlocks or partial writes; committed loss of eligibility blocks new requests',
  );
  // Pure SQL/domain boundary parity, no injectable production clock.
  const fixed = Date.parse('2026-11-22T00:00:00Z');
  for (const offset of [
    240 * 60000 - 1,
    240 * 60000,
    240 * 60000 + 1,
    30 * 86400000 - 1,
    30 * 86400000,
    30 * 86400000 + 1,
  ]) {
    const at = new Date(fixed + offset).toISOString();
    const result = sql(
      `select coalesce(private.request_scheduled_error(${q(at)},'2026-11-22T00:00:00Z',240,30),'')`,
    );
    assert.equal(
      result,
      scheduledTimeIssue(fixed + offset, fixed, {
        minimumLeadMinutes: 240,
        maximumHorizonDays: 30,
      }) ?? '',
    );
  }
  for (const minimumLeadMinutes of [90, 240])
    for (const fixedNow of ['2026-10-03T16:00:00Z', '2026-04-04T16:00:00Z']) {
      const epoch = Date.parse(fixedNow);
      for (const offset of [
        minimumLeadMinutes * 60000 - 1,
        minimumLeadMinutes * 60000,
        30 * 86400000,
        30 * 86400000 + 1,
      ]) {
        const actual = sql(
          `set timezone='Australia/Sydney'; select coalesce(private.request_scheduled_error(${q(new Date(epoch + offset).toISOString())},${q(fixedNow)},${minimumLeadMinutes},30),'')`,
        )
          .split('\n')
          .slice(1)
          .join('\n');
        assert.equal(
          actual,
          scheduledTimeIssue(epoch + offset, epoch, {
            minimumLeadMinutes,
            maximumHorizonDays: 30,
          }) ?? '',
        );
      }
    }
  for (const type of ['available_now', 'scheduled'])
    for (const price of [1, 4500, 4503, 2147483647])
      for (const pct of [0, 20, 33, 100]) {
        const p = { ...policy, commissionPct: pct };
        const actual = read(
          `select private.request_money_snapshot(${price},${q(type)},'2026-11-22T00:00:00Z',${q(JSON.stringify(p))}::jsonb)`,
        );
        actual.expiresAt = new Date(actual.expiresAt).toISOString();
        assert.deepEqual(actual, requestSnapshot(price, type, fixed, p));
      }
  assert.equal(
    sql(
      `select count(*) from public.payments p join public.bookings b on b.id=p.booking_id where b.client_id=${q(users.clientA)}`,
    ),
    '0',
  );
  pass(
    'SQL/domain parity: inclusive scheduling boundaries, integer rounding, configured per-type expiry; zero payment side effects',
  );
  sql(
    `update public.service_categories set archived_at=now() where id=${q(category)}`,
  );
  assert.equal((await call()).status, 409);
  pass(
    'Archived category unavailable; no unarchive path used by fixture cleanup',
  );
} finally {
  for (const [key, value] of Object.entries(savedConfig))
    sql(
      `update private.platform_config set value=${q(JSON.stringify(value))}::jsonb where key=${q(key)}`,
    );
  clearPending();
  sql(`update public.available_now_sessions set status='manually_disabled' where barber_id in(${q(users.barberA)},${q(users.barberB)}) and status='active';
 update public.barber_services set archived_at=coalesce(archived_at,now()) where service_category_id=${q(category)};
 update public.service_categories set archived_at=coalesce(archived_at,now()) where id=${q(category)};`);
  for (const user of Object.values(users)) {
    const r = await apiJson(
      status,
      '/auth/v1/admin/users/' + user,
      status.SERVICE_ROLE_KEY,
      { method: 'DELETE', body: JSON.stringify({ should_soft_delete: true }) },
    );
    assert.equal(r.status, 200);
  }
  console.log(
    'PASS Synthetic fixtures archived, logins soft-deleted and original local config restored; immutable history preserved',
  );
  // A failed run must not leave a previous successful artifact looking current.
  // Only the normal completion below can replace this with PASS.
  writeFileSync(
    evidencePath,
    JSON.stringify({ result: 'INCOMPLETE', checks }) + '\n',
  );
}
writeFileSync(
  evidencePath,
  JSON.stringify(
    {
      result: 'PASS',
      environment: 'local QuickTrimr only',
      checks,
      parallel: { runsPerType: 5, callsPerRun: 8 },
      cleanup:
        'Synthetic fixtures archived; logins soft-deleted; config restored; immutable history preserved',
    },
    null,
    2,
  ) + '\n',
);
