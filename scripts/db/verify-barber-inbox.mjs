import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  barberRequestInboxInputSchema,
  barberRequestInboxPageSchema,
  createBookingRequestResponseSchema,
} from '../../packages/validation/src/index.ts';

import { apiJson, assertRawBody, makeUsers } from './api-test-helpers.mjs';
import { sqlValue as q } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal as sql } from './verify.mjs';

assert.equal(process.argv.length, 2);
const stack = localStatus();
const { users, tokens } = await makeUsers(stack, {
  additional: ['admin', 'noProfile'],
  adversarialMetadata: true,
});
const category = randomUUID();
const address = randomUUID();
const addressB = randomUUID();
const sessionA = randomUUID();
const sessionB = randomUUID();
const point = "'SRID=4326;POINT(145.2 -38.2)'::extensions.geography";
const project = (meters) => `extensions.st_project(${point},${meters},0)`;
const postal = {
  line1: '99 Synthetic Private Road',
  unit: 'Test Unit 42',
  suburb: 'Synthetic Suburb',
  postcode: '3012',
  accessNotes: 'Synthetic key at private door',
};
const clientName = 'QA Sam R.';
const mobile = '+61400000000';
const initialPrice = 4503;
const requestPath = '/rest/v1/rpc/list_barber_booking_requests';
const post = (path, token, input) =>
  apiJson(stack, path, token, { method: 'POST', body: JSON.stringify(input) });
const rawInbox = (token, input = {}) => post(requestPath, token, input);
async function inbox(token, input = {}) {
  const result = await rawInbox(
    token,
    barberRequestInboxInputSchema.parse(input),
  );
  assert.equal(result.status, 200, 'Inbox RPC did not return 200.');
  return barberRequestInboxPageSchema.parse(result.body);
}
async function submit(client, barber, addressId, scheduledFor) {
  const result = await post(
    '/functions/v1/create-booking-request',
    tokens[client],
    {
      bookingType: scheduledFor ? 'scheduled' : 'available_now',
      barberId: users[barber],
      serviceCategoryId: category,
      clientAddressId: addressId,
      notes: 'Synthetic request notes with private contact details',
      ...(scheduledFor ? { scheduledFor } : {}),
    },
  );
  assert.equal(
    result.status,
    200,
    'Fixture create-booking-request did not return 200.',
  );
  return createBookingRequestResponseSchema.parse(result.body);
}
const pointAddress = (id, clientId) =>
  `(${q(id)},${q(clientId)},${point},'synthetic-inbox-qa','QA Private Address',${q(postal.line1)},${q(postal.suburb)},'VIC',${q(postal.postcode)},${q(postal.unit)},${q(postal.accessNotes)})`;
const account = (id) =>
  `(${q(id)},'acct_LocalFixturePlatform',${q('acct_LocalFixture' + randomUUID().replaceAll('-', ''))},'verified',true,true)`;

try {
  const userIds = Object.values(users).map(q).join(',');
  for (const [name, role] of [
    ['clientA', 'client'],
    ['clientB', 'client'],
    ['barberA', 'barber'],
    ['barberB', 'barber'],
  ]) {
    assert.equal(
      (
        await post('/functions/v1/create-or-sync-profile', tokens[name], {
          role,
        })
      ).status,
      200,
      'Fixture profile setup failed.',
    );
  }
  sql(`begin;
    insert into public.profiles(id,role,verification_status)
      values (${q(users.admin)},'admin','not_started');
    update public.client_profiles set display_name=${q(clientName)},mobile=${q(mobile)}
      where id in (${q(users.clientA)},${q(users.clientB)});
    update public.profiles set verification_status='verified' where id in (${userIds}) and role='barber';
    update public.barber_profiles set display_name='QA Barber',service_area=${project(7400)},service_radius_km=12
      where id in (${q(users.barberA)},${q(users.barberB)});
    insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled)
      values ${account(users.barberA)}, ${account(users.barberB)};
    insert into public.available_now_sessions(id,barber_id,location,status,location_source,radius_km,available_until)
      values (${q(sessionA)},${q(users.barberA)},${project(3200)},'active','gps',12,statement_timestamp()+interval '1 hour'),
             (${q(sessionB)},${q(users.barberB)},${project(1100)},'active','gps',12,statement_timestamp()+interval '1 hour');
    insert into public.service_categories(id,slug,display_name,description,display_order,min_price_cents,max_price_cents)
      values (${q(category)},${q('qa-inbox-' + category)},'QA Skin Fade','Synthetic inbox evidence',0,2000,15000);
    insert into public.barber_services(barber_id,service_category_id,price_cents)
      values (${q(users.barberA)},${q(category)},${initialPrice}),(${q(users.barberB)},${q(category)},${initialPrice});
    insert into public.client_addresses(id,client_id,location,directory_id,label,line1,suburb,state,postcode,unit,access_notes)
      values ${pointAddress(address, users.clientA)}, ${pointAddress(addressB, users.clientB)};
    commit;`);

  const caller = tokens.barberA;
  const empty = await inbox(caller);
  assertRawBody(empty.requests, [], 'Empty inbox');
  assert.equal(empty.nextCursor, null);
  const pendingA = await submit('clientA', 'barberA', address);
  const scheduledFor = new Date(Date.now() + 86_400_000).toISOString();
  const scheduledA = await submit('clientA', 'barberA', address, scheduledFor);
  const pendingB = await submit('clientB', 'barberB', addressB);

  const first = await rawInbox(caller);
  assert.equal(first.status, 200);
  const parsed = barberRequestInboxPageSchema.parse(first.body);
  const expected = [
    {
      id: pendingA.id,
      bookingType: 'available_now',
      serviceName: 'QA Skin Fade',
      priceCents: initialPrice,
      clientDisplayName: clientName,
      clientRating: null,
      distanceBand: '2-5km',
      suburb: postal.suburb,
      scheduledFor: null,
      expiresAt: pendingA.expiresAt,
      status: 'pending',
    },
    {
      id: scheduledA.id,
      bookingType: 'scheduled',
      serviceName: 'QA Skin Fade',
      priceCents: initialPrice,
      clientDisplayName: clientName,
      clientRating: null,
      distanceBand: '5-10km',
      suburb: postal.suburb,
      scheduledFor: new Date(scheduledFor).toISOString(),
      expiresAt: scheduledA.expiresAt,
      status: 'pending',
    },
  ];
  // Normalize timestamps only after strict parsing of the exact raw keys.
  for (const item of expected) {
    item.expiresAt = new Date(item.expiresAt).toISOString();
  }
  assertRawBody(
    first.body.requests.map((item) => ({
      ...item,
      expiresAt: new Date(item.expiresAt).toISOString(),
      scheduledFor: item.scheduledFor
        ? new Date(item.scheduledFor).toISOString()
        : null,
    })),
    expected,
    'Field-by-field inbox payload for both booking types',
  );
  assert.equal(parsed.nextCursor, null);
  const wire = JSON.stringify(first.body);
  for (const privateValue of [
    postal.line1,
    postal.unit,
    postal.postcode,
    postal.accessNotes,
    mobile,
    'Synthetic request notes with private contact details',
    address,
    sessionA,
    users.clientA,
  ])
    assert.ok(
      !wire.includes(JSON.stringify(privateValue)),
      'Private fixture value escaped the raw inbox.',
    );
  console.log(
    'PASS Both live request types, snapshotted origins, exact safe payload keys and values, null rating and empty inbox.',
  );

  for (const token of [
    null,
    tokens.admin,
    tokens.clientA,
    tokens.noProfile,
    stack.SERVICE_ROLE_KEY,
  ]) {
    const denied = await rawInbox(token);
    assert.ok(
      [401, 403, 404].includes(denied.status),
      'Non-barber inbox read was not denied.',
    );
  }
  assert.equal((await inbox(tokens.barberB)).requests[0]?.id, pendingB.id);
  const another = await inbox(caller, { p_request_id: pendingB.id });
  const missing = await inbox(caller, { p_request_id: randomUUID() });
  assertRawBody(another.requests, [], 'Foreign request lookup');
  assertRawBody(
    missing.requests,
    another.requests,
    'Missing and foreign IDs look identical',
  );
  assert.equal(another.nextCursor, null);
  assert.equal(missing.nextCursor, null);
  assert.equal(
    (await inbox(caller, { p_request_id: pendingA.id })).requests[0]?.id,
    pendingA.id,
  );
  assert.equal(
    (await rawInbox(caller, { p_barber_id: users.barberB })).status,
    404,
  );
  const ownPath =
    '/rest/v1/booking_requests?select=id,barber_id&id=eq.' + pendingB.id;
  assertRawBody(
    (await apiJson(stack, ownPath, caller)).body,
    [],
    'Existing table RLS',
  );
  const snapshotRead = await apiJson(
    stack,
    '/rest/v1/booking_request_snapshots?select=*',
    caller,
    {
      headers: { 'accept-profile': 'private' },
    },
  );
  assert.equal(snapshotRead.status, 406);
  console.log(
    'PASS Role and owner guards, direct foreign ID and RLS denial, unexposed snapshots, and verified role over JWT metadata.',
  );

  sql(`begin;
    update public.available_now_sessions set location=${point} where id=${q(sessionA)};
    update public.barber_profiles set service_area=${point} where id=${q(users.barberA)};
    update public.client_addresses set suburb='Changed Suburb',location=${project(100)} where id=${q(address)};
    update public.client_profiles set display_name='Changed QA name' where id=${q(users.clientA)};
    update public.barber_services set price_cents=4800 where barber_id=${q(users.barberA)} and service_category_id=${q(category)};
    commit;`);
  const afterEdits = await inbox(caller);
  assertRawBody(
    afterEdits.requests,
    parsed.requests,
    'Existing snapshots remain unchanged',
  );
  console.log(
    'PASS Live changes to source points, address, name and price leave the original inbox projection unchanged.',
  );

  // Fixture-only terminal rows and tied deadlines. These inserts create no
  // booking or payment and do not invoke any future lifecycle handler.
  const statements = sql(`with fixture as (
      select booking_type,client_id,barber_id,service_category_id,barber_service_id,scheduled_for
      from public.booking_requests where id=${q(scheduledA.id)}
    ), inserted as (
      insert into public.booking_requests(client_id,barber_id,booking_type,status,service_category_id,barber_service_id,scheduled_for,expires_at)
      select f.client_id,f.barber_id,f.booking_type,v.status::public.request_status,f.service_category_id,f.barber_service_id,
        f.scheduled_for + make_interval(secs=>v.n),
        case when v.n=0 then statement_timestamp()-interval '1 second' else statement_timestamp()+interval '1 minute' end
      from fixture f cross join (
        select 'pending' as status,n from generate_series(0,52) n
        union all select status, 1 from unnest(array['accepted','declined','expired','cancelled']) status
      ) v
      returning id
    ), snapshotted as (
      insert into private.booking_request_snapshots(
        request_id, service_price_cents, commission_pct_snapshot, gross_cents, commission_cents,
        barber_net_cents, cancellation_refund_pct, cancellation_inconvenience_pct, late_cancel_window_hours,
        client_address_id, address_snapshot, address_location, client_snapshot, barber_snapshot, service_snapshot, created_at
      )
      select i.id,s.service_price_cents,s.commission_pct_snapshot,s.gross_cents,s.commission_cents,s.barber_net_cents,
        s.cancellation_refund_pct,s.cancellation_inconvenience_pct,s.late_cancel_window_hours,s.client_address_id,
        s.address_snapshot,s.address_location,s.client_snapshot,s.barber_snapshot,s.service_snapshot,statement_timestamp()
      from inserted i cross join private.booking_request_snapshots s where s.request_id=${q(scheduledA.id)}
      returning request_id
    ) select count(*) from snapshotted;`);
  assert.equal(statements, '57');

  const normal = await inbox(caller);
  const full = await inbox(caller, { p_limit: 50 });
  assert.equal(normal.requests.length, 20);
  assert.equal(full.requests.length, 50);
  assert.ok(full.nextCursor);
  assertRawBody(
    normal.requests,
    full.requests.slice(0, 20),
    'Default page is the prefix of the max page',
  );
  assert.equal(full.nextCursor.requestId, full.requests.at(-1).id);
  const rest = await inbox(caller, {
    p_after_request_id: full.nextCursor.requestId,
    p_after_expires_at: full.nextCursor.expiresAt,
  });
  assert.equal(rest.requests.length, 4);
  assert.equal(rest.nextCursor, null);
  const combined = [...full.requests, ...rest.requests];
  assert.equal(new Set(combined.map((item) => item.id)).size, 54);
  assert.ok(
    combined.every((item, i) => {
      if (i === 0) return true;
      const prev = combined[i - 1];
      const delta = Date.parse(item.expiresAt) - Date.parse(prev.expiresAt);
      return delta > 0 || (delta === 0 && prev.id < item.id);
    }),
  );
  for (const bad of [
    { p_limit: 0 },
    { p_limit: 51 },
    { p_after_request_id: pendingA.id },
    { p_after_expires_at: 'infinity', p_after_request_id: pendingA.id },
    {
      p_request_id: pendingA.id,
      p_after_expires_at: pendingA.expiresAt,
      p_after_request_id: pendingA.id,
    },
  ]) {
    const result = await rawInbox(caller, bad);
    assert.equal(result.status, 422);
    assert.equal(result.body.message, 'validation_failed');
    assert.ok(
      Object.keys(JSON.parse(result.body.details)).some((field) =>
        ['cursor', 'limit'].includes(field),
      ),
    );
  }
  const expiredFixtures = JSON.parse(
    sql(`select jsonb_agg(id)
    from public.booking_requests where barber_id=${q(users.barberA)} and service_category_id=${q(category)}
      and (status<>'pending' or expires_at<statement_timestamp())`),
  );
  assert.equal(expiredFixtures.length, 5);
  for (const id of expiredFixtures) {
    assertRawBody(
      (await inbox(caller, { p_request_id: id })).requests,
      [],
      'Terminal or elapsed request lookup',
    );
  }
  assert.equal(
    sql(`select string_agg(seen::text,',' order by delta) from (
    select delta, exists(select 1 from private.barber_inbox_page(
       ${q(users.barberA)},${q(pendingA.expiresAt)}::timestamptz + delta*interval '1 millisecond',
       ${q(pendingA.id)},null,null,1
    )) as seen from generate_series(-1,1) delta
  ) check_boundary`),
    'true,false,false',
  );
  console.log(
    'PASS Configured default and maximum page sizes, request ID tie-breaks, no duplicate rows, validated cursors and exact expiry boundary.',
  );

  // Verify the same bounded query used by the RPC, with the optimizer's
  // normal settings. Historical noise and statistics are rolled back.
  const planText = sql(`begin;
    insert into public.booking_requests(client_id,barber_id,booking_type,status,expires_at)
      select ${q(users.clientB)},${q(users.barberB)},'scheduled','cancelled',statement_timestamp()-make_interval(secs=>n)
      from generate_series(1,4000) n;
    analyze public.booking_requests;
    explain (analyze, buffers, format json)
    select * from private.barber_inbox_page(
      ${q(users.barberA)},statement_timestamp(),null,null,null,21
    );
    rollback;`);
  const start = planText.indexOf('[');
  const finish = planText.lastIndexOf(']');
  const root = JSON.parse(planText.slice(start, finish + 1))[0].Plan;
  const nodes = [root];
  for (let i = 0; i < nodes.length; i++) nodes.push(...(nodes[i].Plans ?? []));
  const scan = nodes.find(
    (node) => node['Index Name'] === 'booking_requests_barber_inbox_idx',
  );
  assert.equal(scan?.['Node Type'], 'Index Scan');
  assert.match(scan['Index Cond'], /barber_id.*status.*expires_at/);
  assert.equal(root['Actual Rows'], 21);
  assert.ok(!nodes.some((node) => node['Node Type'] === 'Sort'));
  console.log(
    'PASS EXPLAIN ANALYZE: Limit → Nested Loop → booking_requests_barber_inbox_idx Index Scan; conditions barber_id, status, expires_at; no sort; 21 probed rows.',
  );
} finally {
  sql(`begin;
    update public.booking_requests set status='cancelled'
      where service_category_id=${q(category)} and status='pending';
    update public.available_now_sessions set status='manually_disabled'
      where id in (${q(sessionA)},${q(sessionB)}) and status='active';
    update public.barber_services set archived_at=now() where service_category_id=${q(category)} and archived_at is null;
    update public.service_categories set archived_at=now() where id=${q(category)} and archived_at is null;
    commit;`);
  for (const id of Object.values(users)) {
    const result = await apiJson(
      stack,
      '/auth/v1/admin/users/' + id,
      stack.SERVICE_ROLE_KEY,
      {
        method: 'DELETE',
        body: JSON.stringify({ should_soft_delete: true }),
      },
    );
    assert.equal(result.status, 200, 'Synthetic test login cleanup failed.');
  }
  console.log(
    'PASS Synthetic requests cancelled where pending, supply archived, sessions disabled and fixture logins soft-deleted.',
  );
}
