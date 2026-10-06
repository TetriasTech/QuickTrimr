import {
  AVAIL_STATUS_VALUE,
  BOOKING_STATUS_VALUE,
  BOOKING_TYPE_VALUE,
  DISPUTE_STATUS_VALUE,
  EARNING_STATUS_VALUE,
  LOCATION_SOURCE_VALUE,
  REQUEST_STATUS_VALUE,
  USER_ROLE_VALUE,
} from '@quicktrimr/shared';

const OMIT_FIELD = Symbol('omit-field');

type Mutation = readonly [field: string, value: unknown | typeof OMIT_FIELD];

function mutate(
  valid: Readonly<Record<string, unknown>>,
  [field, value]: Mutation,
): Record<string, unknown> {
  const changed = { ...valid };
  if (value === OMIT_FIELD) delete changed[field];
  else changed[field] = value;
  return changed;
}

function schemaExamples(
  valid: Readonly<Record<string, unknown>>,
  mutations: readonly Mutation[],
) {
  return {
    valid,
    invalid: mutations.map((mutation) => mutate(valid, mutation)),
  } as const;
}

function contractExamples(
  requestValid: Readonly<Record<string, unknown>>,
  requestMutations: readonly Mutation[],
  responseValid: Readonly<Record<string, unknown>>,
  responseMutations: readonly Mutation[],
) {
  return {
    request: schemaExamples(requestValid, requestMutations),
    response: schemaExamples(responseValid, responseMutations),
  } as const;
}

const availableNowBookingType = BOOKING_TYPE_VALUE.AVAILABLE_NOW;
const scheduledBookingType = BOOKING_TYPE_VALUE.SCHEDULED;
const requestPending = REQUEST_STATUS_VALUE.PENDING;
const requestAccepted = REQUEST_STATUS_VALUE.ACCEPTED;
const requestDeclined = REQUEST_STATUS_VALUE.DECLINED;
const requestCancelled = REQUEST_STATUS_VALUE.CANCELLED;
const bookingAcceptedPendingPayment =
  BOOKING_STATUS_VALUE.ACCEPTED_PENDING_PAYMENT;
const bookingOnTheWay = BOOKING_STATUS_VALUE.ON_THE_WAY;
const bookingCompletedByBarber = BOOKING_STATUS_VALUE.COMPLETED_BY_BARBER;
const bookingCompleted = BOOKING_STATUS_VALUE.COMPLETED;
const bookingCancelled = BOOKING_STATUS_VALUE.CANCELLED;
const bookingDisputed = BOOKING_STATUS_VALUE.DISPUTED;
const earningPending = EARNING_STATUS_VALUE.PENDING;
const earningAvailable = EARNING_STATUS_VALUE.AVAILABLE;
const availabilityActive = AVAIL_STATUS_VALUE.ACTIVE;
const availabilityManuallyDisabled = AVAIL_STATUS_VALUE.MANUALLY_DISABLED;
const disputeOpen = DISPUTE_STATUS_VALUE.OPEN;
const clientRole = USER_ROLE_VALUE.CLIENT;
const gpsLocationSource = LOCATION_SOURCE_VALUE.GPS;
const manualLocationSource = LOCATION_SOURCE_VALUE.MANUAL;

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const BOOKING_ID = '33333333-3333-4333-8333-333333333333';
const BARBER_ID = '44444444-4444-4444-8444-444444444444';
const SERVICE_CATEGORY_ID = '55555555-5555-4555-8555-555555555555';
const ADDRESS_ID = '66666666-6666-4666-8666-666666666666';
const DISPUTE_ID = '77777777-7777-4777-8777-777777777777';
const REVIEW_ID = '88888888-8888-4888-8888-888888888888';
const SERVICE_ID = '99999999-9999-4999-8999-999999999999';

const CREATED_AT = '2026-08-05T04:11:22Z';
const EXPIRES_AT = '2026-08-05T04:16:22Z';
const AVAILABLE_UNTIL = '2026-08-05T09:00:00Z';

const availableNowSessionResponse = {
  id: SESSION_ID,
  status: availabilityActive,
  radiusKm: 8,
  availableUntil: AVAILABLE_UNTIL,
  locationSource: gpsLocationSource,
  approximateArea: { id: 'sal:2021:example', label: 'Melbourne' },
};

export const CONTRACT_EXAMPLES = {
  'start-available-now-session': contractExamples(
    {
      lat: -37.8136,
      lng: 144.9631,
      locationSource: gpsLocationSource,
      radiusKm: 8,
      availableUntil: AVAILABLE_UNTIL,
    },
    [
      ['lat', 91],
      ['locationSource', 'satellite'],
      ['availableUntil', 'tomorrow'],
    ],
    availableNowSessionResponse,
    [
      ['id', 'not-a-uuid'],
      ['status', 'paused'],
      ['radiusKm', -1],
    ],
  ),
  'update-available-now-session': contractExamples(
    {
      sessionId: SESSION_ID,
      lat: -37.8136,
      lng: 144.9631,
      locationSource: manualLocationSource,
      radiusKm: 10,
      availableUntil: AVAILABLE_UNTIL,
    },
    [
      ['sessionId', 'not-a-uuid'],
      ['lng', 181],
      ['locationSource', 'satellite'],
    ],
    {
      ...availableNowSessionResponse,
      locationSource: manualLocationSource,
      radiusKm: 10,
    },
    [
      ['id', 'not-a-uuid'],
      ['status', 'paused'],
      ['availableUntil', 'tomorrow'],
    ],
  ),
  'stop-available-now-session': contractExamples(
    { sessionId: SESSION_ID },
    [
      ['sessionId', 'not-a-uuid'],
      ['sessionId', 1],
      ['sessionId', OMIT_FIELD],
    ],
    { id: SESSION_ID, status: availabilityManuallyDisabled },
    [
      ['id', 'not-a-uuid'],
      ['status', 'paused'],
      ['status', OMIT_FIELD],
    ],
  ),
  'upsert-barber-service': contractExamples(
    {
      serviceCategoryId: SERVICE_CATEGORY_ID,
      priceCents: 4_500,
      enabled: true,
    },
    [
      ['serviceCategoryId', 'not-a-uuid'],
      ['priceCents', 45.5],
      ['priceCents', -1],
      ['enabled', 'yes'],
    ],
    {
      id: SERVICE_ID,
      serviceCategoryId: SERVICE_CATEGORY_ID,
      priceCents: 4_500,
      enabled: true,
      archivedAt: null,
    },
    [
      ['id', 'not-a-uuid'],
      ['priceCents', 45.5],
      ['archivedAt', 'yesterday'],
    ],
  ),
  'create-booking-request': contractExamples(
    {
      bookingType: availableNowBookingType,
      barberId: BARBER_ID,
      serviceCategoryId: SERVICE_CATEGORY_ID,
      clientAddressId: ADDRESS_ID,
      notes: 'Buzzer 4B',
    },
    [
      ['bookingType', 'walk_in'],
      ['barberId', 'not-a-uuid'],
      ['bookingType', scheduledBookingType],
    ],
    {
      id: REQUEST_ID,
      status: requestPending,
      bookingType: availableNowBookingType,
      servicePriceCents: 4_500,
      commissionPct: 20,
      grossCents: 4_500,
      commissionCents: 900,
      barberNetCents: 3_600,
      expiresAt: EXPIRES_AT,
      createdAt: CREATED_AT,
    },
    [
      ['status', 'waiting'],
      ['servicePriceCents', 45.5],
      ['barberNetCents', -1],
    ],
  ),
  'accept-booking-request': contractExamples(
    { requestId: REQUEST_ID },
    [
      ['requestId', 'not-a-uuid'],
      ['requestId', 1],
      ['requestId', OMIT_FIELD],
    ],
    {
      requestId: REQUEST_ID,
      bookingId: BOOKING_ID,
      requestStatus: requestAccepted,
      bookingStatus: bookingAcceptedPendingPayment,
    },
    [
      ['requestStatus', 'waiting'],
      ['bookingStatus', 'not-a-booking-status'],
      ['bookingId', 'not-a-uuid'],
    ],
  ),
  'decline-booking-request': contractExamples(
    { requestId: REQUEST_ID, reason: 'too_far' },
    [
      ['requestId', 'not-a-uuid'],
      ['reason', ''],
      ['requestId', OMIT_FIELD],
    ],
    { requestId: REQUEST_ID, status: requestDeclined },
    [
      ['requestId', 'not-a-uuid'],
      ['status', 'waiting'],
      ['status', OMIT_FIELD],
    ],
  ),
  'cancel-booking-request': contractExamples(
    { requestId: REQUEST_ID, reason: 'plans_changed' },
    [
      ['requestId', 'not-a-uuid'],
      ['reason', ''],
      ['requestId', OMIT_FIELD],
    ],
    { requestId: REQUEST_ID, status: requestCancelled },
    [
      ['requestId', 'not-a-uuid'],
      ['status', 'waiting'],
      ['status', OMIT_FIELD],
    ],
  ),
  'cancel-booking': contractExamples(
    { bookingId: BOOKING_ID, reason: 'client_unavailable' },
    [
      ['bookingId', 'not-a-uuid'],
      ['reason', ''],
      ['bookingId', OMIT_FIELD],
    ],
    {
      bookingId: BOOKING_ID,
      status: bookingCancelled,
      refundCents: 2_250,
      // RULE-CANCEL-07: accepted Available Now cancellation; retained commission is pre-fee.
      barberInconvenienceCents: 2_250,
      platformRetainedCents: 0,
      capturedCents: 4_500,
      ruleApplied: 'RULE-CANCEL-03',
    },
    [
      ['status', 'voided'],
      ['refundCents', 22.5],
      ['capturedCents', -1],
    ],
  ),
  'mark-on-the-way': contractExamples(
    { bookingId: BOOKING_ID, lat: -37.8136, lng: 144.9631 },
    [
      ['bookingId', 'not-a-uuid'],
      ['lat', 91],
      ['lng', 181],
    ],
    {
      bookingId: BOOKING_ID,
      status: bookingOnTheWay,
      etaMinutes: 14,
      etaUpdatedAt: CREATED_AT,
    },
    [
      ['status', 'driving'],
      ['etaMinutes', 14.5],
      ['etaUpdatedAt', 'now'],
    ],
  ),
  'update-eta': contractExamples(
    { bookingId: BOOKING_ID, lat: -37.8136, lng: 144.9631 },
    [
      ['bookingId', 'not-a-uuid'],
      ['lat', -91],
      ['lng', -181],
    ],
    {
      bookingId: BOOKING_ID,
      etaMinutes: 12,
      etaUpdatedAt: CREATED_AT,
      cached: false,
    },
    [
      ['bookingId', 'not-a-uuid'],
      ['etaMinutes', 12.5],
      ['etaUpdatedAt', 'now'],
    ],
  ),
  'mark-job-complete-by-barber': contractExamples(
    { bookingId: BOOKING_ID },
    [
      ['bookingId', 'not-a-uuid'],
      ['bookingId', 1],
      ['bookingId', OMIT_FIELD],
    ],
    {
      bookingId: BOOKING_ID,
      status: bookingCompletedByBarber,
      clientRespondBy: '2026-08-05T05:11:22Z',
      earningStatus: earningPending,
    },
    [
      ['status', 'done'],
      ['clientRespondBy', 'later'],
      ['earningStatus', 'held'],
    ],
  ),
  'confirm-job-complete-by-client': contractExamples(
    { bookingId: BOOKING_ID },
    [
      ['bookingId', 'not-a-uuid'],
      ['bookingId', 1],
      ['bookingId', OMIT_FIELD],
    ],
    {
      bookingId: BOOKING_ID,
      status: bookingCompleted,
      earningStatus: earningAvailable,
      completedBy: clientRole,
    },
    [
      ['status', 'done'],
      ['earningStatus', 'released'],
      ['completedBy', 'system'],
    ],
  ),
  'open-dispute': contractExamples(
    {
      bookingId: BOOKING_ID,
      reasonCategory: 'service_not_provided',
      description: 'Barber did not arrive.',
    },
    [
      ['bookingId', 'not-a-uuid'],
      ['reasonCategory', ''],
      ['description', ''],
    ],
    {
      disputeId: DISPUTE_ID,
      status: disputeOpen,
      bookingStatus: bookingDisputed,
      earningStatus: earningPending,
    },
    [
      ['status', 'new'],
      ['bookingStatus', 'not-a-booking-status'],
      ['earningStatus', 'held'],
    ],
  ),
  'create-review': contractExamples(
    { bookingId: BOOKING_ID, rating: 5, text: 'On time, great fade.' },
    [
      ['bookingId', 'not-a-uuid'],
      ['rating', 0],
      ['rating', 6],
      ['text', ''],
    ],
    {
      reviewId: REVIEW_ID,
      rating: 5,
      barberRating: 4.83,
      barberRatingCount: 38,
    },
    [
      ['reviewId', 'not-a-uuid'],
      ['rating', 0],
      ['barberRating', 5.1],
      ['barberRatingCount', 1.5],
    ],
  ),
} as const;

export const ERROR_RESPONSE_EXAMPLES = schemaExamples(
  { error: 'validation_failed', fields: { bookingId: 'Must be a UUID' } },
  [
    ['error', ''],
    ['fields', { bookingId: '' }],
    ['error', OMIT_FIELD],
  ],
);
