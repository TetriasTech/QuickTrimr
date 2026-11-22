import assert from 'node:assert/strict';
import test from 'node:test';

import {
  barberRequestInboxInputSchema,
  barberRequestInboxPageSchema,
} from '../src/index.ts';

const expiry = '2026-11-22T03:45:00.123456+00:00';
const id = '51af68bc-1d20-4a9d-9689-942b17300001';
const item = {
  id,
  bookingType: 'available_now',
  serviceName: 'Synthetic service',
  priceCents: 4503,
  clientDisplayName: 'QA C.',
  clientRating: null,
  distanceBand: null,
  suburb: 'Synthetic Suburb',
  scheduledFor: null,
  expiresAt: expiry,
  status: 'pending',
};
const page = { requests: [item], serverNow: expiry, nextCursor: null };

test('barber inbox supports legacy unknown distance and refuses extra or misleading fields', () => {
  assert.deepEqual(barberRequestInboxPageSchema.parse(page), page);
  for (const edit of [
    { clientRating: 4.9 },
    { priceCents: 45.03 },
    { distanceBand: 'about 1km' },
    { distanceKm: 3.2 },
    { phone: 'synthetic' },
    { accessNotes: 'synthetic' },
    { coordinates: [1, 2] },
    { bookingType: 'scheduled' },
    { status: 'accepted' },
  ]) {
    assert.equal(
      barberRequestInboxPageSchema.safeParse({
        ...page,
        requests: [{ ...item, ...edit }],
      }).success,
      false,
    );
  }
});

test('barber inbox RPC accepts a complete precise cursor without allowing ownership input', () => {
  const after = {
    p_after_expires_at: expiry,
    p_after_request_id: id,
    p_limit: 1,
  };
  assert.deepEqual(barberRequestInboxInputSchema.parse(after), after);
  assert.ok(
    barberRequestInboxInputSchema.safeParse({ p_request_id: id }).success,
  );
  for (const input of [
    { p_barber_id: id },
    { p_after_request_id: id },
    { ...after, p_request_id: id },
    { p_limit: 1.5 },
  ]) {
    assert.equal(barberRequestInboxInputSchema.safeParse(input).success, false);
  }
});
