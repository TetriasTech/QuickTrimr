import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  AVAIL_STATUS_VALUE,
  BOOKING_STATUS_VALUE,
  BOOKING_TYPE_VALUE,
  DISPUTE_STATUS_VALUE,
  EARNING_STATUS_VALUE,
  REQUEST_STATUS_VALUE,
} from '@quicktrimr/shared';
import {
  CONTRACTS,
  CONTRACT_EXAMPLES,
  ERROR_RESPONSE_EXAMPLES,
  SERVER_CONTROLLED_REQUEST_FIELDS,
  createBookingRequestRequestSchema,
  errorResponseSchema,
  updateEtaResponseSchema,
} from '../src/index.ts';

function hasFieldLevelIssue(issues) {
  return issues.some((issue) => {
    if (issue.path.length > 0) return true;
    if (!('errors' in issue)) return false;
    return issue.errors.some((nestedIssues) => hasFieldLevelIssue(nestedIssues));
  });
}

test('every contract has matching valid and invalid examples', () => {
  assert.deepEqual(Object.keys(CONTRACT_EXAMPLES).sort(), Object.keys(CONTRACTS).sort());

  for (const [name, contract] of Object.entries(CONTRACTS)) {
    const examples = CONTRACT_EXAMPLES[name];
    assert.equal(contract.requestSchema.safeParse(examples.request.valid).success, true, name);
    assert.equal(contract.responseSchema.safeParse(examples.response.valid).success, true, name);

    for (const side of ['request', 'response']) {
      assert.ok(examples[side].invalid.length >= 3, `${name} ${side} needs three invalid examples`);
      for (const invalid of examples[side].invalid) {
        const result = contract[`${side}Schema`].safeParse(invalid);
        assert.equal(result.success, false, `${name} ${side} accepted ${JSON.stringify(invalid)}`);
        assert.equal(
          hasFieldLevelIssue(result.error.issues),
          true,
          `${name} ${side} must return a field-level issue`,
        );
      }
    }
  }
});

test('every contract uses the shared error response schema', () => {
  for (const [name, contract] of Object.entries(CONTRACTS)) {
    assert.equal(contract.errorSchema, errorResponseSchema, name);
  }

  assert.equal(errorResponseSchema.safeParse(ERROR_RESPONSE_EXAMPLES.valid).success, true);
  for (const invalid of ERROR_RESPONSE_EXAMPLES.invalid) {
    const result = errorResponseSchema.safeParse(invalid);
    assert.equal(result.success, false);
    assert.equal(hasFieldLevelIssue(result.error.issues), true);
  }
});

test('cancellation fixture matches the approved Available Now backlog example', async () => {
  const backlog = await readFile(new URL('../../../QUICKTRIMR_BACKLOG_README.md', import.meta.url), 'utf8');
  const ticket = backlog.split('#### P3-T07 —')[1]?.split('#### P3-T08 —')[0];
  assert.ok(ticket);
  const response = ticket.match(/\/\/ 200 — client cancels accepted Available Now booking\s*(\{[\s\S]*?\})/);
  assert.ok(response, 'Approved cancellation example must exist');
  const expected = JSON.parse(response[1]);
  const actual = CONTRACT_EXAMPLES['cancel-booking'].response.valid;
  for (const field of ['refundCents', 'barberInconvenienceCents', 'platformRetainedCents', 'capturedCents', 'ruleApplied']) {
    assert.equal(actual[field], expected[field], field);
  }
  assert.equal(CONTRACTS['cancel-booking'].responseSchema.safeParse(actual).success, true);
  // This checks contract-example parity, not production refund calculation or Stripe behavior.
});

test('request schemas ignore client-supplied identity, status and server-derived money fields', () => {
  for (const [name, contract] of Object.entries(CONTRACTS)) {
    const valid = CONTRACT_EXAMPLES[name].request.valid;
    for (const field of SERVER_CONTROLLED_REQUEST_FIELDS) {
      const result = contract.requestSchema.safeParse({ ...valid, [field]: 1 });
      assert.equal(
        result.success,
        true,
        `${name} did not ignore forbidden field ${field}`,
      );
      assert.equal(field in result.data, false, `${name} returned forbidden field ${field}`);
    }
  }
});

test('request schemas still reject unknown non-server fields', () => {
  for (const [name, contract] of Object.entries(CONTRACTS)) {
    const valid = CONTRACT_EXAMPLES[name].request.valid;
    assert.equal(
      contract.requestSchema.safeParse({ ...valid, misspelledField: true }).success,
      false,
      name,
    );
  }
});

test('booking type controls whether a requested scheduled time is present', () => {
  const availableNow = CONTRACT_EXAMPLES['create-booking-request'].request.valid;
  assert.equal(
    createBookingRequestRequestSchema.safeParse({
      ...availableNow,
      scheduledFor: '2026-08-06T04:11:22Z',
    }).success,
    false,
  );
  assert.equal(
    createBookingRequestRequestSchema.safeParse({
      ...availableNow,
      bookingType: BOOKING_TYPE_VALUE.SCHEDULED,
      scheduledFor: '2026-08-06T04:11:22Z',
    }).success,
    true,
  );
});

test('ETA responses reject private routing data', () => {
  const valid = CONTRACT_EXAMPLES['update-eta'].response.valid;
  for (const field of ['lat', 'lng', 'origin', 'polyline']) {
    assert.equal(
      updateEtaResponseSchema.safeParse({ ...valid, [field]: 'private' }).success,
      false,
      field,
    );
  }
});

test('ETA and its timestamp are returned together', () => {
  const valid = CONTRACT_EXAMPLES['update-eta'].response.valid;
  assert.equal(updateEtaResponseSchema.safeParse(valid).success, true);
  assert.equal(updateEtaResponseSchema.safeParse({ ...valid, etaMinutes: null }).success, false);
  assert.equal(updateEtaResponseSchema.safeParse({ ...valid, etaUpdatedAt: null }).success, false);
  assert.equal(
    updateEtaResponseSchema.safeParse({ ...valid, etaMinutes: null, etaUpdatedAt: null }).success,
    true,
  );
});

test('success responses reject other valid statuses from the same shared enum', () => {
  const wrongStatuses = [
    ['start-available-now-session', { status: AVAIL_STATUS_VALUE.BUSY }],
    ['stop-available-now-session', { status: AVAIL_STATUS_VALUE.ACTIVE }],
    ['create-booking-request', { status: REQUEST_STATUS_VALUE.ACCEPTED }],
    ['accept-booking-request', { requestStatus: REQUEST_STATUS_VALUE.DECLINED }],
    ['accept-booking-request', { bookingStatus: BOOKING_STATUS_VALUE.PAID_CONFIRMED }],
    ['decline-booking-request', { status: REQUEST_STATUS_VALUE.ACCEPTED }],
    ['cancel-booking-request', { status: REQUEST_STATUS_VALUE.DECLINED }],
    ['cancel-booking', { status: BOOKING_STATUS_VALUE.COMPLETED }],
    ['mark-on-the-way', { status: BOOKING_STATUS_VALUE.ARRIVED }],
    ['mark-job-complete-by-barber', { status: BOOKING_STATUS_VALUE.COMPLETED }],
    ['mark-job-complete-by-barber', { earningStatus: EARNING_STATUS_VALUE.AVAILABLE }],
    ['confirm-job-complete-by-client', { status: BOOKING_STATUS_VALUE.COMPLETED_BY_BARBER }],
    ['confirm-job-complete-by-client', { earningStatus: EARNING_STATUS_VALUE.PENDING }],
    ['open-dispute', { status: DISPUTE_STATUS_VALUE.UNDER_REVIEW }],
    ['open-dispute', { bookingStatus: BOOKING_STATUS_VALUE.COMPLETED }],
    ['open-dispute', { earningStatus: EARNING_STATUS_VALUE.AVAILABLE }],
  ];

  for (const [name, override] of wrongStatuses) {
    const valid = CONTRACT_EXAMPLES[name].response.valid;
    assert.equal(
      CONTRACTS[name].responseSchema.safeParse({ ...valid, ...override }).success,
      false,
      `${name}: ${JSON.stringify(override)}`,
    );
  }
});
