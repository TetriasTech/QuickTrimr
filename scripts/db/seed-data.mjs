import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AVAIL_STATUS,
  BOOKING_STATUS_VALUE as B,
  BOOKING_TYPE_VALUE as T,
  DISPUTE_STATUS_VALUE as D,
  EARNING_STATUS_VALUE as E,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
  RELIABILITY_LEVEL,
  REQUEST_STATUS_VALUE as R,
  USER_ROLE_VALUE as U,
  VERIFICATION_STATUS,
} from '../../packages/shared/src/index.ts';

import {
  bookingSnapshotExample,
  insertSql,
  sqlValue,
} from './core-fixtures.mjs';
import { coreTables } from './core-schema.mjs';
import { root } from './local.mjs';

export const seedPath = resolve(root, 'supabase/seed/foundation.sql');
export const seedTimestamp = '2026-10-08T00:00:00.000Z';
// Test-only synthetic offsets around a city origin, not residential GPS samples.
export const geoOrigin = [151.2093, -33.8688];
export const geoRadiusMetres = 5000; // Fixture probe, never a discovery configuration.
const geoOffsets = [
  [0.002, 0.001],
  [0.012, 0.005],
  [0.065, 0.01],
  [0.14, 0.02],
  [0.21, 0.03],
];

// RULE-SERVICE-05. Catalogue attributes aren't columns until P1-T10. This map
// preserves the category identities and validates illustrative service prices.
export const launchCategories = [
  { slug: 'haircut', name: 'Haircut', order: 1, min: 2000, max: 15000 },
  { slug: 'skin_fade', name: 'Skin Fade', order: 2, min: 2500, max: 17500 },
  { slug: 'beard_trim', name: 'Beard Trim', order: 3, min: 1000, max: 10000 },
  {
    slug: 'haircut_beard',
    name: 'Haircut + Beard',
    order: 4,
    min: 3000,
    max: 20000,
  },
  {
    slug: 'skin_fade_beard',
    name: 'Skin Fade + Beard',
    order: 5,
    min: 3500,
    max: 22500,
  },
];

export function seedId(name) {
  assert.match(name, /^[a-z][a-z0-9_/-]*$/);
  // UUIDv5: fixed namespace + stable case name. Never depend on enum position.
  const bytes = createHash('sha1')
    .update(Buffer.from('7b20f674cf8b4d78bc210dc9af4316a1', 'hex'))
    .update(name)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const payment = Object.fromEntries(
  PAYMENT_STATUS.map((v) => [v.toUpperCase(), v]),
);
// These are UI/relationship scenarios, not a production state machine or money
// engine. Refund amounts below are the explicit RULE-PAY-11 worked examples.
const scenarios = [
  ['requested', B.REQUESTED, R.PENDING, payment.REQUIRES_AUTHORISATION],
  ['expired', B.EXPIRED, R.EXPIRED, payment.AUTHORISATION_CANCELLED],
  ['declined', B.DECLINED, R.DECLINED, payment.AUTHORISATION_CANCELLED],
  [
    'capture_failed',
    B.ACCEPTED_PENDING_PAYMENT,
    R.ACCEPTED,
    payment.CAPTURE_FAILED,
  ],
  ['paid_confirmed', B.PAID_CONFIRMED, R.ACCEPTED, payment.CAPTURED, E.PENDING],
  ['on_the_way', B.ON_THE_WAY, R.ACCEPTED, payment.CAPTURED, E.PENDING],
  ['arrived', B.ARRIVED, R.ACCEPTED, payment.CAPTURED, E.PENDING],
  [
    'completed_by_barber',
    B.COMPLETED_BY_BARBER,
    R.ACCEPTED,
    payment.CAPTURED,
    E.PENDING,
  ],
  [
    'completed_by_client',
    B.COMPLETED_BY_CLIENT,
    R.ACCEPTED,
    payment.CAPTURED,
    E.AVAILABLE,
  ],
  [
    'completion_prompt_sent',
    B.COMPLETION_PROMPT_SENT,
    R.ACCEPTED,
    payment.CAPTURED,
    E.PENDING,
  ],
  ['completed', B.COMPLETED, R.ACCEPTED, payment.CAPTURED, E.AVAILABLE],
  [
    'cancelled_before_capture',
    B.CANCELLED,
    R.CANCELLED,
    payment.AUTHORISATION_CANCELLED,
  ],
  ['disputed', B.DISPUTED, R.ACCEPTED, payment.DISPUTED, E.PENDING, 0, D.OPEN],
  ['refunded', B.REFUNDED, R.ACCEPTED, payment.REFUNDED, E.REVERSED, 4500],
  [
    'admin_resolved',
    B.ADMIN_RESOLVED,
    R.ACCEPTED,
    payment.CAPTURED,
    E.AVAILABLE,
    0,
    D.RESOLVED_BARBER_PAID,
  ],
  ['authorised', B.REQUESTED, R.PENDING, payment.AUTHORISED],
  [
    'capture_pending',
    B.ACCEPTED_PENDING_PAYMENT,
    R.ACCEPTED,
    payment.CAPTURE_PENDING,
  ],
  [
    'queued_for_payout',
    B.COMPLETED,
    R.ACCEPTED,
    payment.CAPTURED,
    E.QUEUED_FOR_PAYOUT,
  ],
  ['paid_out', B.COMPLETED, R.ACCEPTED, payment.CAPTURED, E.PAID_OUT],
  [
    'dispute_under_review',
    B.DISPUTED,
    R.ACCEPTED,
    payment.DISPUTED,
    E.PENDING,
    0,
    D.UNDER_REVIEW,
  ],
  [
    'dispute_client_refund',
    B.ADMIN_RESOLVED,
    R.ACCEPTED,
    payment.REFUNDED,
    E.REVERSED,
    4500,
    D.RESOLVED_CLIENT_REFUND,
  ],
  [
    'dispute_partial_refund',
    B.ADMIN_RESOLVED,
    R.ACCEPTED,
    payment.PARTIALLY_REFUNDED,
    E.AVAILABLE,
    2250,
    D.RESOLVED_PARTIAL_REFUND,
  ],
  [
    'dispute_operational',
    B.ADMIN_RESOLVED,
    R.ACCEPTED,
    payment.CAPTURED,
    E.PENDING,
    0,
    D.RESOLVED_OPERATIONAL,
  ],
  [
    'dispute_cancelled',
    B.PAID_CONFIRMED,
    R.ACCEPTED,
    payment.CAPTURED,
    E.PENDING,
    0,
    D.CANCELLED,
  ],
];

export function buildSeed() {
  const rows = Object.fromEntries(coreTables.map((table) => [table, []]));
  const auth = [];
  const add = (table, row) =>
    rows[table].push({
      ...row,
      created_at: seedTimestamp,
      updated_at: seedTimestamp,
    });
  const profile = (name, role, verification_status) => {
    const id = seedId(`user/${name}`);
    auth.push({
      id,
      email: `quicktrimr-seed-${name.replaceAll('/', '-')}@example.com`,
      aud: 'authenticated',
      role: 'authenticated',
      created_at: seedTimestamp,
      updated_at: seedTimestamp,
    });
    add('profiles', { id, role, verification_status });
    if (role === U.CLIENT) add('client_profiles', { id });
    return id;
  };
  const admin = profile('admin', U.ADMIN, VERIFICATION_STATUS[0]);
  const clients = ['client_a', 'client_b'].map((name) =>
    profile(name, U.CLIENT, VERIFICATION_STATUS[0]),
  );
  const barbers = VERIFICATION_STATUS.map((value, index) => {
    const id = profile(`barber/${value}`, U.BARBER, value);
    const [dx, dy] = geoOffsets[index];
    const location = `SRID=4326;POINT(${geoOrigin[0] + dx} ${geoOrigin[1] + dy})`;
    add('barber_profiles', { id, service_area: location });
    add('barber_reliability_state', { id, level: RELIABILITY_LEVEL[index] });
    return { id, location };
  });
  clients.forEach((id, i) => {
    add('client_addresses', {
      id: seedId(`address/client_${i === 0 ? 'a' : 'b'}`),
      client_id: id,
      location: `SRID=4326;POINT(${geoOrigin[0]} ${geoOrigin[1] + 0.001})`,
    });
    add('notifications', {
      id: seedId(`notification/client_${i === 0 ? 'a' : 'b'}`),
      user_id: id,
    });
  });
  for (const category of launchCategories) {
    add('service_categories', { id: seedId(`category/${category.slug}`) });
    for (const barber of barbers)
      add('barber_services', {
        id: seedId(`service/${barber.id.replaceAll('-', '')}/${category.slug}`),
        barber_id: barber.id,
        service_category_id: seedId(`category/${category.slug}`),
        price_cents: bookingSnapshotExample.service_price_cents,
      });
  }
  AVAIL_STATUS.forEach((status, i) => {
    const barber = barbers[i % barbers.length];
    add('available_now_sessions', {
      id: seedId(`session/${status}`),
      barber_id: barber.id,
      location: barber.location,
      status,
    });
  });
  // Main booking cases share the verified barber; a second client creates a real
  // cross-user ownership boundary. Both booking types occur without inventing deadlines.
  const barber = barbers.find((b) => b.id === seedId('user/barber/verified'));
  assert.ok(barber, 'A verified fixture barber is required.');
  scenarios.forEach(
    (
      [
        name,
        status,
        requestStatus,
        paymentStatus,
        earningStatus,
        refunded = 0,
        dispute,
      ],
      i,
    ) => {
      const client = clients[i % clients.length];
      const id = seedId(`booking/${name}`);
      const requestId = seedId(`request/${name}`);
      const bookingType = i % 2 === 0 ? T.AVAILABLE_NOW : T.SCHEDULED;
      add('booking_requests', {
        id: requestId,
        client_id: client,
        barber_id: barber.id,
        booking_type: bookingType,
        status: requestStatus,
      });
      add('bookings', {
        id,
        request_id: requestId,
        client_id: client,
        barber_id: barber.id,
        booking_type: bookingType,
        status,
        ...bookingSnapshotExample,
      });
      add('booking_services', {
        id: seedId(`booking_service/${name}`),
        booking_id: id,
        barber_service_id: seedId(
          `service/${barber.id.replaceAll('-', '')}/haircut`,
        ),
        service_price_cents: bookingSnapshotExample.service_price_cents,
      });
      add('booking_status_history', {
        id: seedId(`history/${name}`),
        booking_id: id,
        from_status: null,
        to_status: status,
        actor_id: null,
        actor_role: null,
        reason: `Synthetic initial snapshot: ${name}; not a real transition.`,
      });
      add('payments', {
        id: seedId(`payment/${name}`),
        booking_id: id,
        status: paymentStatus,
        gross_cents: bookingSnapshotExample.gross_cents,
        refunded_cents: refunded,
      });
      if (earningStatus) {
        // Original booking snapshot never changes. Retained entitlement uses the
        // full/half-refund worked examples, not locally reimplemented refund maths.
        const retained =
          refunded === 4500
            ? [0, 0]
            : refunded === 2250
              ? [450, 1800]
              : [900, 3600];
        add('barber_earnings', {
          id: seedId(`earning/${name}`),
          booking_id: id,
          barber_id: barber.id,
          status: earningStatus,
          gross_cents: 4500,
          commission_cents: retained[0],
          barber_net_cents: retained[1],
        });
      }
      if (dispute)
        add('disputes', {
          id: seedId(`dispute/${name}`),
          booking_id: id,
          status: dispute,
        });
      add('audit_logs', {
        id: seedId(`audit/${name}`),
        actor_id: null,
        actor_role: null,
        action: 'local_seed_snapshot',
        entity_type: 'bookings',
        entity_id: id,
        previous_value: null,
        new_value: { status },
        reason: 'Synthetic initial snapshot, not a performed action.',
        metadata: { synthetic: true, case: name, ticket: 'P0-T12' },
      });
    },
  );
  for (const status of PAYOUT_STATUS) {
    const batch = seedId(`batch/${status}`);
    add('payout_batches', { id: batch, status });
    add('payout_batch_items', {
      id: seedId(`batch_item/${status}`),
      batch_id: batch,
      barber_id: barber.id,
      status,
      barber_net_cents: bookingSnapshotExample.barber_net_cents,
    });
  }
  add('reviews', {
    id: seedId('review/completed'),
    booking_id: seedId('booking/completed'),
  });
  for (const { id } of barbers)
    add('barber_reliability_events', {
      id: seedId(`reliability_event/${id.replaceAll('-', '')}`),
      barber_id: id,
      booking_id: null,
    });
  return { auth, rows, admin, clients, barbers };
}

export function renderSeed() {
  const { auth, rows } = buildSeed();
  const authSql = auth.map(
    (row) =>
      `insert into auth.users (${Object.keys(row).join(', ')}) values (${Object.values(row).map(sqlValue).join(', ')}) on conflict (id) do nothing;`,
  );
  const publicSql = coreTables.flatMap((table) => [
    `-- ${table}`,
    ...rows[table].map((row) =>
      insertSql(table, row).replace(/;$/, ' on conflict (id) do nothing;'),
    ),
  ]);
  return [
    '-- P0-T12 / TRIMR-21. Generated by scripts/db/seed-data.mjs; local synthetic data only.',
    '-- No schema changes, passwords, provider calls, updates, deletes or fictional transitions.',
    ...launchCategories.map(
      (c) =>
        `-- Category ${c.slug}: ${seedId(`category/${c.slug}`)} (attributes deferred to P1-T10).`,
    ),
    'begin;',
    ...authSql,
    ...publicSql,
    'commit;',
    '',
  ].join('\n');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assert.ok(
      ['--check', '--write'].includes(process.argv[2]) &&
        process.argv.length === 3,
      'Use seed-data.mjs --check or --write; no target flags accepted.',
    );
    const sql = renderSeed();
    if (process.argv[2] === '--write') writeFileSync(seedPath, sql);
    else
      assert.ok(
        readFileSync(seedPath, 'utf8') === sql,
        'Committed seed drifted; regenerate with --write.',
      );
    console.log('Deterministic seed SQL: PASS.');
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Seed generation failed.',
    );
    process.exitCode = 1;
  }
}
