import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SHARED_ENUMS } from '../../packages/shared/src/index.ts';

import { bookingSnapshotExample } from './core-fixtures.mjs';
import { coreTables } from './core-schema.mjs';
import { commandArgs } from './local.mjs';
import {
  buildSeed,
  launchCategories,
  renderSeed,
  seedId,
  seedPath,
  seedTimestamp,
} from './seed-data.mjs';
import { applySeed } from './seed.mjs';

const fixture = buildSeed();
const coverage = {
  'ENUM-USER-ROLE': ['profiles', 'role'],
  'ENUM-VERIFICATION-STATUS': ['profiles', 'verification_status'],
  'ENUM-BOOKING-TYPE': ['bookings', 'booking_type'],
  'ENUM-BOOKING-STATUS': ['bookings', 'status'],
  'ENUM-REQUEST-STATUS': ['booking_requests', 'status'],
  'ENUM-PAYMENT-STATUS': ['payments', 'status'],
  'ENUM-EARNING-STATUS': ['barber_earnings', 'status'],
  'ENUM-PAYOUT-STATUS': ['payout_batches', 'status'],
  'ENUM-AVAIL-STATUS': ['available_now_sessions', 'status'],
  'ENUM-DISPUTE-STATUS': ['disputes', 'status'],
  'ENUM-RELIABILITY-LEVEL': ['barber_reliability_state', 'level'],
};

test('committed insert-only seed matches deterministic generation, with fixed timestamps and no credentials/schema mutations', () => {
  const sql = renderSeed();
  assert.equal(readFileSync(seedPath, 'utf8'), sql);
  assert.equal(renderSeed(), sql);
  assert.match(sql, /\nbegin;\n/);
  assert.match(sql, /\ncommit;\n$/);
  const statements = sql
    .split('\n')
    .filter((line) => line.startsWith('insert '));
  assert.ok(statements.length > 0);
  assert.ok(
    statements.every((line) => / on conflict \(id\) do nothing;$/.test(line)),
  );
  assert.doesNotMatch(
    sql,
    /\b(?:update|delete|truncate|alter|create|drop|password|token|stripe_account_id)\b/i,
  );
  for (const row of [...fixture.auth, ...Object.values(fixture.rows).flat()]) {
    assert.equal(row.created_at, seedTimestamp);
    assert.equal(row.updated_at, seedTimestamp);
    assert.match(
      row.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  }
});

test('every delivered table is populated with unique IDs, synthetic Auth emails and no login credentials', () => {
  assert.deepEqual(Object.keys(fixture.rows), coreTables);
  for (const table of coreTables) {
    assert.ok(fixture.rows[table].length > 0, table);
    assert.equal(
      new Set(fixture.rows[table].map((row) => row.id)).size,
      fixture.rows[table].length,
    );
  }
  for (const row of fixture.auth) {
    assert.match(row.email, /^quicktrimr-seed-[a-z_-]+@example\.com$/);
    assert.equal(Object.hasOwn(row, 'encrypted_password'), false);
    assert.equal(Object.hasOwn(row, 'raw_user_meta_data'), false);
    assert.ok(fixture.rows.profiles.some((profile) => profile.id === row.id));
  }
});

for (const [id, [table, column]] of Object.entries(coverage)) {
  test(`${id}: seed covers every shared enum value and no invented values`, () => {
    assert.deepEqual(
      [...new Set(fixture.rows[table].map((row) => row[column]))].sort(),
      [...SHARED_ENUMS[id]].sort(),
    );
  });
}

test('category identity map matches the actual KB launch table; example prices are in approved bounds', () => {
  const kb = readFileSync(
    new URL('../../QUICKTRIMR_KNOWLEDGE_BASE.md', import.meta.url),
    'utf8',
  );
  const actual = [
    ...kb.matchAll(
      /^\| (\d+) \| `([a-z_]+)` \| ([^|]+) \| ([\d,]+) \| ([\d,]+) \|$/gm,
    ),
  ].map(([, order, slug, name, min, max]) => ({
    slug,
    name: name.trim(),
    order: Number(order),
    min: Number(min.replaceAll(',', '')),
    max: Number(max.replaceAll(',', '')),
  }));
  assert.deepEqual(launchCategories, actual);
  assert.equal(fixture.rows.service_categories.length, launchCategories.length);
  for (const service of fixture.rows.barber_services) {
    const category = launchCategories.find(
      (c) => seedId(`category/${c.slug}`) === service.service_category_id,
    );
    assert.ok(category);
    assert.ok(
      Number.isInteger(service.price_cents) &&
        service.price_cents >= category.min &&
        service.price_cents <= category.max,
    );
  }
});

test('all FK references resolve, bookings retain integer-cent worked-example snapshots and each has truthful initial history', () => {
  const rows = fixture.rows;
  const references = {
    profiles: { id: fixture.auth },
    client_profiles: { id: rows.profiles },
    barber_profiles: { id: rows.profiles },
    client_addresses: { client_id: rows.client_profiles },
    barber_services: {
      barber_id: rows.barber_profiles,
      service_category_id: rows.service_categories,
    },
    available_now_sessions: { barber_id: rows.barber_profiles },
    booking_requests: {
      client_id: rows.client_profiles,
      barber_id: rows.barber_profiles,
    },
    bookings: {
      request_id: rows.booking_requests,
      client_id: rows.client_profiles,
      barber_id: rows.barber_profiles,
    },
    booking_services: {
      booking_id: rows.bookings,
      barber_service_id: rows.barber_services,
    },
    booking_status_history: {
      booking_id: rows.bookings,
      actor_id: rows.profiles,
    },
    payments: { booking_id: rows.bookings },
    barber_earnings: {
      booking_id: rows.bookings,
      barber_id: rows.barber_profiles,
    },
    payout_batch_items: {
      batch_id: rows.payout_batches,
      barber_id: rows.barber_profiles,
    },
    disputes: { booking_id: rows.bookings },
    reviews: { booking_id: rows.bookings },
    notifications: { user_id: rows.profiles },
    audit_logs: { actor_id: rows.profiles },
    barber_reliability_events: {
      barber_id: rows.barber_profiles,
      booking_id: rows.bookings,
    },
    barber_reliability_state: { id: rows.barber_profiles },
  };
  for (const [table, columns] of Object.entries(references))
    for (const row of rows[table])
      for (const [column, target] of Object.entries(columns))
        if (row[column] !== null)
          assert.ok(
            target.some((r) => r.id === row[column]),
            `${table}.${column}`,
          );
  for (const booking of rows.bookings) {
    for (const [column, value] of Object.entries(bookingSnapshotExample))
      assert.equal(booking[column], value);
    const request = rows.booking_requests.find(
      (r) => r.id === booking.request_id,
    );
    assert.equal(booking.client_id, request.client_id);
    assert.equal(booking.barber_id, request.barber_id);
    const history = rows.booking_status_history.filter(
      (r) => r.booking_id === booking.id,
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].from_status, null);
    assert.equal(history[0].to_status, booking.status);
    assert.equal(history[0].actor_id, null);
    assert.equal(history[0].actor_role, null);
    assert.match(history[0].reason, /Synthetic initial snapshot/);
  }
  for (const row of Object.values(rows).flat())
    for (const [key, value] of Object.entries(row))
      if (key.endsWith('_cents'))
        assert.ok(Number.isSafeInteger(value) && value >= 0);
  for (const earning of rows.barber_earnings) {
    const paid = rows.payments.find((r) => r.booking_id === earning.booking_id);
    assert.equal(
      earning.gross_cents - paid.refunded_cents,
      earning.commission_cents + earning.barber_net_cents,
    );
  }
  assert.equal(
    rows.barber_earnings.some(
      (r) => r.booking_id === seedId('booking/capture_failed'),
    ),
    false,
  );
  assert.equal(
    rows.bookings.find((r) => r.id === seedId('booking/capture_failed')).status,
    SHARED_ENUMS['ENUM-BOOKING-STATUS'].find(
      (s) => s === 'accepted_pending_payment',
    ),
  );
});

test('case IDs are stable name-derived values, independent of input order; invalid names rejected', () => {
  const names = ['booking/requested', 'booking/refunded', 'category/haircut'];
  const first = Object.fromEntries(names.map((name) => [name, seedId(name)]));
  assert.deepEqual(first, {
    'booking/requested': 'df238525-7bfc-5aae-b093-e5d512209fbf',
    'booking/refunded': '79193a0a-b6f7-52c0-9abe-2f454029491e',
    'category/haircut': '582742ef-60da-5c81-a9a8-5c0d45491718',
  });
  const reversed = Object.fromEntries(
    [...names].reverse().map((name) => [name, seedId(name)]),
  );
  assert.deepEqual(first, reversed);
  assert.equal(new Set(Object.values(first)).size, names.length);
  for (const invalid of ['../outside', '--linked', '', 'a;select', 'UPPER'])
    assert.throws(() => seedId(invalid));
});

test('seed apply rejects arguments and non-local targets before querying; empty reset cannot load seeds', () => {
  assert.deepEqual(commandArgs('reset-empty'), [
    'db',
    'reset',
    '--local',
    '--no-seed',
  ]);
  for (const args of [
    ['--linked'],
    ['--db-url', 'postgres://remote'],
    ['--file', '../outside'],
    ['--debug'],
  ]) {
    let called = false;
    assert.throws(() =>
      applySeed(args, {
        status: () => {
          called = true;
        },
        query: () => {
          called = true;
        },
      }),
    );
    assert.equal(called, false);
    assert.throws(() => commandArgs('reset-empty', args));
  }
  let queries = 0;
  assert.throws(() =>
    applySeed([], {
      status: () => ({ API_URL: 'https://remote.supabase.co' }),
      query: () => queries++,
    }),
  );
  assert.equal(queries, 0);
  applySeed([], {
    status: () => ({ API_URL: 'http://127.0.0.1:55321' }),
    query: (sql) => {
      assert.equal(sql, renderSeed());
      queries++;
    },
  });
  assert.equal(queries, 1);
  assert.throws(
    () =>
      applySeed([], {
        status: () => ({ API_URL: 'http://127.0.0.1:55321' }),
        query: () => {
          throw new Error('synthetic failure');
        },
      }),
    /synthetic failure/,
  );
});
