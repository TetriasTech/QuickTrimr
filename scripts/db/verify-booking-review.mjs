import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  bookingRequestReviewSchema,
  clientBookingRequestSchema,
} from '../../packages/validation/src/index.ts';

import { apiJson, makeUsers } from './api-test-helpers.mjs';
import { sqlValue as q } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal as sql } from './verify.mjs';

const hold = process.argv[2] === '--simulator';
assert.equal(process.argv.length, hold ? 3 : 2);
const stack = localStatus();
const { users, tokens } = await makeUsers(stack, { additional: ['admin'] });
const barber = users.barberA;
const category = randomUUID();
const address = randomUUID(),
  foreignAddress = randomUUID();
const slug = 'booking-review-qa-' + category;
const addressFixture = (id, client) =>
  `(${q(id)},${q(client)},'SRID=4326;POINT(145.2 -38.2)','synthetic-booking-review','Test','1 Synthetic Road','Test','VIC','3000','','')`;
const post = (path, token, body) =>
  apiJson(stack, path, token, { method: 'POST', body: JSON.stringify(body) });
const rpc = (name, token, body = {}) =>
  post('/rest/v1/rpc/' + name, token, body);
const submit = (token, input) =>
  post('/functions/v1/create-booking-request', token, input);
const quote = (token, input) =>
  rpc('get_booking_request_review', token, { p_input: input });
const state = (token, id = null, active = false) =>
  rpc('get_client_booking_request', token, {
    p_request_id: id,
    p_active_available_now: active,
  });
const input = {
  bookingType: 'available_now',
  barberId: barber,
  serviceCategoryId: category,
  clientAddressId: address,
};
const config = {};
let simulatorClient;
try {
  for (const [name, role] of [
    ['clientA', 'client'],
    ['clientB', 'client'],
    ['barberA', 'barber'],
  ]) {
    assert.equal(
      (
        await post('/functions/v1/create-or-sync-profile', tokens[name], {
          role,
        })
      ).status,
      200,
    );
  }
  const area = sql(
    'select id from public.public_areas where extensions.st_covers(boundary,extensions.st_setsrid(extensions.st_point(145.2,-38.2),4326)) order by id limit 1',
  );
  assert.ok(area, 'The local public SAL dataset is required.');
  if (hold) {
    simulatorClient = JSON.parse(
      readFileSync('/private/tmp/quicktrimr48-ui.json', 'utf8'),
    ).id;
    assert.match(simulatorClient, /^[a-f0-9-]{36}$/);
  }
  sql(`update public.client_profiles set display_name='QA Client',mobile='+61400000000' where id in (${q(users.clientA)},${q(users.clientB)});
    insert into public.profiles(id,role,verification_status) values (${q(users.admin)},'admin','not_started');
    update public.profiles set verification_status='verified' where id=${q(barber)};
    update public.barber_profiles set display_name='Studio North QA',bio='Synthetic verification profile.',years_experience=10,service_area='SRID=4326;POINT(145.2 -38.2)',service_radius_km=12,public_area_id=${q(area)} where id=${q(barber)};
    insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled) values(${q(barber)},'acct_LocalFixturePlatform',${q('acct_LocalFixture' + randomUUID().replaceAll('-', ''))},'verified',true,true);
    insert into public.available_now_sessions(barber_id,location,status,location_source,radius_km,available_until,public_area_id) values (${q(barber)},'SRID=4326;POINT(145.2 -38.2)','active','gps',12,clock_timestamp()+interval '2 hours',${q(area)});
    insert into public.service_categories(id,slug,display_name,description,display_order,min_price_cents,max_price_cents) values(${q(category)},${q(slug)},'QA Studio Cut','Temporary local booking review fixture',0,2000,15000);
    insert into public.barber_services(barber_id,service_category_id,price_cents) values(${q(barber)},${q(category)},4503);
    insert into public.client_addresses(id,client_id,location,directory_id,label,line1,suburb,state,postcode,unit,access_notes) values ${addressFixture(address, users.clientA)}, ${addressFixture(foreignAddress, users.clientB)};`);
  if (hold) {
    console.log(
      'Ready: select QA Studio Cut and QA confirmed home in Available Now discovery.',
    );
    await new Promise((resolve) => {
      const finish = () => {
        process.stdin.pause();
        process.stdin.unref();
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(finish, 1800000);
      process.stdin.once('data', finish);
      process.once('SIGTERM', finish);
      process.once('SIGINT', finish);
      process.stdin.resume();
    });
  } else {
    const qa = tokens.clientA;
    const count = () =>
      sql(
        `select count(*) from public.booking_requests where client_id=${q(users.clientA)}`,
      );
    for (const token of [null, tokens.barberA, tokens.admin]) {
      assert.ok([401, 403, 404].includes((await quote(token, input)).status));
      assert.ok([401, 403, 404].includes((await state(token)).status));
    }
    assert.equal(
      (await quote(qa, { ...input, clientAddressId: foreignAddress })).status,
      422,
    );
    assert.equal(
      (await quote(qa, { ...input, bookingType: 'fake' })).status,
      400,
    );
    assert.deepEqual(await state(qa), { status: 200, body: null });
    const availableCall = await quote(qa, input);
    assert.equal(availableCall.status, 200);
    const available = bookingRequestReviewSchema.parse(availableCall.body);
    assert.equal(available.priceCents, 4503);
    assert.equal(available.cancellation.lateWindowHours, null);
    const scheduledInput = {
      ...input,
      bookingType: 'scheduled',
      scheduledFor: new Date(Date.now() + 86400000).toISOString(),
    };
    const scheduled = bookingRequestReviewSchema.parse(
      (await quote(qa, scheduledInput)).body,
    );
    assert.ok(scheduled.cancellation.lateWindowHours);
    assert.equal(scheduled.scheduledIssue, null);
    const tooSoon = bookingRequestReviewSchema.parse(
      (
        await quote(qa, {
          ...scheduledInput,
          scheduledFor: new Date().toISOString(),
        })
      ).body,
    );
    assert.match(tooSoon.scheduledIssue, /Scheduled bookings need at least/);
    console.log(
      'PASS Auth/roles, other client address denial, malformed input, own review and configured terms for both types.',
    );
    const keys = [
      'scheduled_min_lead_minutes',
      'cancel_refund_pct',
      'inconvenience_pct',
    ];
    Object.assign(
      config,
      JSON.parse(
        sql(
          `select json_object_agg(key,value) from private.platform_config where key in (${keys.map(q).join(',')})`,
        ),
      ),
    );
    sql(
      "update private.platform_config set value='1500' where key='scheduled_min_lead_minutes'",
    );
    assert.match(
      bookingRequestReviewSchema.parse((await quote(qa, scheduledInput)).body)
        .scheduledIssue,
      /25 hours/,
    );
    sql(
      `update private.platform_config set value=${q(JSON.stringify(config.scheduled_min_lead_minutes))}::jsonb where key='scheduled_min_lead_minutes'`,
    );
    sql(`begin;
      update private.platform_config set value='{"available_now":60,"scheduled":70}' where key='cancel_refund_pct';
      update private.platform_config set value='{"available_now":40,"scheduled":30}' where key='inconvenience_pct'; commit;`);
    for (const [draft, review] of [
      [input, available],
      [scheduledInput, scheduled],
    ]) {
      assert.deepEqual(
        await submit(qa, { ...draft, reviewToken: review.reviewToken }),
        { status: 409, body: { error: 'review_changed' } },
      );
    }
    assert.equal(count(), '0');
    assert.equal(
      sql(
        `select count(*) from public.audit_logs where actor_id=${q(users.clientA)} and action='booking_request.created'`,
      ),
      '0',
    );
    const updated = bookingRequestReviewSchema.parse(
      (await quote(qa, input)).body,
    );
    sql(
      `update public.barber_services set price_cents=4800 where barber_id=${q(barber)} and service_category_id=${q(category)}`,
    );
    assert.deepEqual(
      await submit(qa, { ...input, reviewToken: updated.reviewToken }),
      { status: 409, body: { error: 'review_changed' } },
    );
    const repriced = bookingRequestReviewSchema.parse(
      (await quote(qa, input)).body,
    );
    sql(
      `update public.client_addresses set line1='2 Synthetic Road' where id=${q(address)}`,
    );
    assert.deepEqual(
      await submit(qa, { ...input, reviewToken: repriced.reviewToken }),
      { status: 409, body: { error: 'review_changed' } },
    );
    assert.equal(count(), '0');
    console.log(
      'PASS Changed scheduling bounds, terms, price and address. Stale submissions leave zero requests and creation audits.',
    );
    const final = bookingRequestReviewSchema.parse(
      (await quote(qa, input)).body,
    );
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        submit(qa, { ...input, reviewToken: final.reviewToken }),
      ),
    );
    const winners = responses.filter((r) => r.status === 200);
    assert.equal(winners.length, 1);
    assert.equal(
      responses.filter(
        (r) => r.status === 409 && r.body.error === 'active_request_exists',
      ).length,
      7,
    );
    const requestId = winners[0].body.id;
    assert.equal(count(), '1');
    assert.equal(winners[0].body.servicePriceCents, final.priceCents);
    assert.equal(
      sql(
        `select cancellation_refund_pct from private.booking_request_snapshots where request_id=${q(requestId)}`,
      ),
      String(final.cancellation.refundPct),
    );
    assert.equal(
      clientBookingRequestSchema.parse((await state(qa, null, true)).body).id,
      requestId,
    );
    assert.equal(
      clientBookingRequestSchema.parse((await state(qa)).body).id,
      requestId,
    );
    for (const id of [requestId, randomUUID()])
      assert.deepEqual(await state(tokens.clientB, id), {
        status: 200,
        body: null,
      });
    for (const status of [
      'pending',
      'accepted',
      'declined',
      'expired',
      'cancelled',
    ]) {
      sql(
        `update public.booking_requests set status=${q(status)} where id=${q(requestId)}`,
      );
      const response = await state(qa, requestId);
      const parsed = clientBookingRequestSchema.parse(response.body);
      assert.deepEqual(Object.keys(response.body).sort(), [
        'bookingType',
        'expiresAt',
        'id',
        'serverNow',
        'status',
      ]);
      assert.equal(parsed.status, status);
    }
    const freshScheduled = bookingRequestReviewSchema.parse(
      (await quote(qa, scheduledInput)).body,
    );
    const sentScheduled = await submit(qa, {
      ...scheduledInput,
      reviewToken: freshScheduled.reviewToken,
    });
    assert.equal(sentScheduled.status, 200);
    assert.equal(
      sql(
        `select cancellation_refund_pct from private.booking_request_snapshots where request_id=${q(sentScheduled.body.id)}`,
      ),
      String(freshScheduled.cancellation.refundPct),
    );
    console.log(
      'PASS Eight parallel submits, one winner; active/latest/ID reads and five server statuses; Scheduled submit matches the reviewed terms.',
    );
  }
} finally {
  if (Object.keys(config).length) {
    sql(
      Object.entries(config)
        .map(
          ([key, value]) =>
            `update private.platform_config set value=${q(JSON.stringify(value))}::jsonb where key=${q(key)};`,
        )
        .join('\n'),
    );
  }
  sql(`update public.booking_requests set status='cancelled' where service_category_id=${q(category)} and client_id in (${q(users.clientA)},${q(simulatorClient ?? users.clientA)}) and status='pending';
    update public.available_now_sessions set status='manually_disabled' where barber_id=${q(barber)} and status='active';
    update public.barber_services set archived_at=now() where service_category_id=${q(category)} and archived_at is null;
    update public.service_categories set archived_at=now() where id=${q(category)} and archived_at is null;`);
  for (const id of Object.values(users)) {
    assert.equal(
      (
        await apiJson(
          stack,
          '/auth/v1/admin/users/' + id,
          stack.SERVICE_ROLE_KEY,
          {
            method: 'DELETE',
            body: JSON.stringify({ should_soft_delete: true }),
          },
        )
      ).status,
      200,
    );
  }
  console.log(
    'PASS Local config restored. Synthetic fixture logins soft-deleted and supply archived.',
  );
}
