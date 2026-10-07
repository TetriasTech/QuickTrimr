import { randomUUID } from 'node:crypto';

import {
  AVAIL_STATUS_VALUE,
  BOOKING_STATUS_VALUE,
  BOOKING_TYPE_VALUE,
  DISPUTE_STATUS,
  EARNING_STATUS_VALUE,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
  RELIABILITY_LEVEL,
  REQUEST_STATUS_VALUE,
  USER_ROLE_VALUE,
  VERIFICATION_STATUS,
} from '../../packages/shared/src/index.ts';

// Synthetic, disposable fixtures only. The amounts are the KB's worked example,
// not defaults or a second financial policy implementation.
export function coreFixtures(users) {
  const ids = Object.fromEntries(
    [
      'address',
      'category',
      'service',
      'session',
      'request',
      'booking',
      'batch',
    ].map((name) => [name, randomUUID()]),
  );
  const amounts = {
    service_price_cents: 4500,
    commission_pct_snapshot: 20,
    gross_cents: 4500,
    commission_cents: 900,
    barber_net_cents: 3600,
  };
  const location = 'SRID=4326;POINT(151.2 -33.8)';
  const profile = (id, role) => ({
    id,
    role,
    verification_status: VERIFICATION_STATUS[0],
  });
  const request = (id) => ({
    id,
    client_id: users.clientB,
    barber_id: users.barberB,
    booking_type: BOOKING_TYPE_VALUE.AVAILABLE_NOW,
    status: REQUEST_STATUS_VALUE.PENDING,
  });
  const booking = (id, requestId) => ({
    id,
    request_id: requestId,
    client_id: users.clientB,
    barber_id: users.barberB,
    booking_type: BOOKING_TYPE_VALUE.AVAILABLE_NOW,
    status: BOOKING_STATUS_VALUE.REQUESTED,
    ...amounts,
  });
  const rows = {
    profiles: profile(users.clientB, USER_ROLE_VALUE.CLIENT),
    client_profiles: { id: users.clientB },
    barber_profiles: { id: users.barberB, service_area: location },
    client_addresses: { id: ids.address, client_id: users.clientB, location },
    service_categories: { id: ids.category },
    barber_services: {
      id: ids.service,
      barber_id: users.barberB,
      service_category_id: ids.category,
      price_cents: amounts.service_price_cents,
    },
    available_now_sessions: {
      id: ids.session,
      barber_id: users.barberB,
      location,
      status: AVAIL_STATUS_VALUE.ACTIVE,
    },
    booking_requests: request(ids.request),
    bookings: booking(ids.booking, ids.request),
    booking_services: {
      id: randomUUID(),
      booking_id: ids.booking,
      barber_service_id: ids.service,
      service_price_cents: amounts.service_price_cents,
    },
    booking_status_history: {
      id: randomUUID(),
      booking_id: ids.booking,
      from_status: null,
      to_status: BOOKING_STATUS_VALUE.REQUESTED,
      actor_id: users.clientB,
      actor_role: USER_ROLE_VALUE.CLIENT,
      reason: 'Disposable schema fixture',
    },
    payments: {
      id: randomUUID(),
      booking_id: ids.booking,
      status: PAYMENT_STATUS[0],
      gross_cents: amounts.gross_cents,
      refunded_cents: 0,
    },
    barber_earnings: {
      id: randomUUID(),
      booking_id: ids.booking,
      barber_id: users.barberB,
      status: EARNING_STATUS_VALUE.PENDING,
      gross_cents: amounts.gross_cents,
      commission_cents: amounts.commission_cents,
      barber_net_cents: amounts.barber_net_cents,
    },
    payout_batches: { id: ids.batch, status: PAYOUT_STATUS[0] },
    payout_batch_items: {
      id: randomUUID(),
      batch_id: ids.batch,
      barber_id: users.barberB,
      status: PAYOUT_STATUS[0],
      barber_net_cents: amounts.barber_net_cents,
    },
    disputes: {
      id: randomUUID(),
      booking_id: ids.booking,
      status: DISPUTE_STATUS[0],
    },
    reviews: { id: randomUUID(), booking_id: ids.booking },
    notifications: { id: randomUUID(), user_id: users.clientB },
    audit_logs: {
      id: randomUUID(),
      actor_id: users.clientB,
      actor_role: USER_ROLE_VALUE.CLIENT,
      action: 'schema_fixture',
      entity_type: 'bookings',
      entity_id: ids.booking,
      previous_value: null,
      new_value: { status: BOOKING_STATUS_VALUE.REQUESTED },
      reason: 'Disposable schema fixture',
      metadata: { synthetic: true },
    },
    barber_reliability_events: {
      id: randomUUID(),
      barber_id: users.barberB,
      booking_id: ids.booking,
    },
    barber_reliability_state: {
      id: users.barberB,
      level: RELIABILITY_LEVEL[0],
    },
  };
  const secondRequest = request(randomUUID());
  const secondBooking = booking(randomUUID(), secondRequest.id);
  const extra = [
    ['profiles', profile(users.clientA, USER_ROLE_VALUE.CLIENT)],
    ['profiles', profile(users.barberA, USER_ROLE_VALUE.BARBER)],
    ['profiles', profile(users.barberB, USER_ROLE_VALUE.BARBER)],
    ['profiles', profile(users.candidateClient, USER_ROLE_VALUE.CLIENT)],
    ['profiles', profile(users.candidateBarber, USER_ROLE_VALUE.BARBER)],
  ];
  const after = [
    ['client_profiles', { id: users.clientA }],
    ['barber_profiles', { id: users.barberA }],
    ['booking_requests', secondRequest],
    ['bookings', secondBooking],
  ];
  const candidates = Object.fromEntries(
    Object.entries(rows).map(([table, row]) => [
      table,
      { ...row, id: randomUUID() },
    ]),
  );
  candidates.profiles = profile(users.candidateProfile, USER_ROLE_VALUE.CLIENT);
  candidates.client_profiles.id = users.candidateClient;
  candidates.barber_profiles.id = users.candidateBarber;
  candidates.available_now_sessions.barber_id = users.barberA;
  candidates.barber_earnings.booking_id = secondBooking.id;
  candidates.reviews.booking_id = secondBooking.id;
  candidates.barber_reliability_state.id = users.barberA;
  return { rows, candidates, extra, after };
}

export function sqlValue(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new Error('Fixture SQL requires integer values.');
    return String(value);
  }
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  return "'" + text.replaceAll("'", "''") + "'";
}

export function insertSql(table, row) {
  if (
    !/^[a-z_]+$/.test(table) ||
    Object.keys(row).some((key) => !/^[a-z_]+$/.test(key))
  )
    throw new Error('Invalid fixture SQL identifier.');
  return `insert into public.${table} (${Object.keys(row).join(', ')}) values (${Object.values(row).map(sqlValue).join(', ')});`;
}
