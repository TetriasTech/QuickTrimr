import {
  AVAIL_STATUS_VALUE,
  BOOKING_STATUS_VALUE,
  BOOKING_TYPE_VALUE,
  DISPUTE_STATUS_VALUE,
  EARNING_STATUS_VALUE,
  REQUEST_STATUS_VALUE,
  USER_ROLE_VALUE,
} from '@quicktrimr/shared';

import {
  paymentStatusSchema,
  payoutStatusSchema,
  reliabilityLevelSchema,
  verificationStatusSchema,
} from './primitives.ts';

// Synthetic examples, not production data or operational configuration.
const ID = '11111111-1111-4111-8111-111111111111';
const BOOKING = '33333333-3333-4333-8333-333333333333';
const BARBER = '44444444-4444-4444-8444-444444444444';
const CATEGORY = '55555555-5555-4555-8555-555555555555';
const AT = '2026-11-02T00:00:00Z';
const LATER = '2026-11-02T01:00:00Z';
const area = {
  id: 'sal:2021:example',
  label: 'Richmond',
  mapPoint: { lat: -37.82, lng: 145 },
};
const category = {
  displayName: 'Skin Fade',
  displayOrder: 2,
  minPriceCents: 3_500,
  maxPriceCents: 17_500,
};
const booking = {
  bookingId: BOOKING,
  status: BOOKING_STATUS_VALUE.PAID_CONFIRMED,
  bookingType: BOOKING_TYPE_VALUE.AVAILABLE_NOW,
  clientId: ID,
  barberId: BARBER,
  scheduledFor: null,
  createdAt: AT,
  grossCents: 4_500,
};

function side(valid: Readonly<Record<string, unknown>>) {
  const first = Object.keys(valid)[0];
  if (first === undefined)
    return {
      valid,
      invalid: [
        { unexpected: true },
        { now: AT },
        { clientSecret: 'not-a-secret' },
      ],
    };
  const missing = { ...valid };
  delete missing[first];
  return {
    valid,
    invalid: [
      {
        ...valid,
        [first]: typeof valid[first] === 'string' ? 42 : 'invalid-value',
      },
      { ...valid, [first]: null },
      missing,
    ],
  };
}
function example(
  request: Readonly<Record<string, unknown>>,
  response: Readonly<Record<string, unknown>>,
) {
  return { request: side(request), response: side(response) };
}
const completion = {
  bookingId: BOOKING,
  applied: true,
  status: BOOKING_STATUS_VALUE.COMPLETED,
  earningStatus: EARNING_STATUS_VALUE.AVAILABLE,
};
const reliability = example(
  {
    barberId: BARBER,
    toLevel: reliabilityLevelSchema.enum.good_standing,
    reason: 'Corrected documented emergency.',
    correctedEventId: ID,
  },
  {
    barberId: BARBER,
    level: reliabilityLevelSchema.enum.good_standing,
    previousLevel: reliabilityLevelSchema.enum.limited,
    eventId: ID,
    overriddenByAdmin: true,
    auditLogId: ID,
  },
);

export const FOUNDATION_CONTRACT_EXAMPLES = {
  'create-or-sync-profile': example(
    { role: USER_ROLE_VALUE.BARBER },
    {
      id: BARBER,
      role: USER_ROLE_VALUE.BARBER,
      verificationStatus: verificationStatusSchema.enum.not_started,
      onboardingComplete: false,
      createdAt: AT,
    },
  ),
  'complete-client-profile': example(
    { displayName: 'Sam Example', mobile: '+61400000000' },
    {
      id: ID,
      displayName: 'Sam Example',
      mobile: '+61400000000',
      onboardingComplete: true,
      verificationStatus: verificationStatusSchema.enum.not_started,
    },
  ),
  'complete-barber-profile': example(
    {
      displayName: 'Marcus Example',
      bio: 'Mobile barber serving the local area.',
      yearsExperience: 10,
      serviceAreaLat: -37.8136,
      serviceAreaLng: 144.9631,
      serviceRadiusKm: 12,
    },
    {
      id: BARBER,
      displayName: 'Marcus Example',
      bio: 'Mobile barber serving the local area.',
      yearsExperience: 10,
      photoUrl: null,
      serviceRadiusKm: 12,
      approximateArea: area,
      onboardingComplete: false,
      publishable: false,
    },
  ),
  'create-stripe-connect-onboarding-link': example(
    {},
    {
      onboardingUrl: 'https://connect.stripe.com/setup/s/synthetic-example',
      expiresAt: LATER,
      accountStatus: verificationStatusSchema.enum.pending,
    },
  ),
  'refresh-stripe-connect-status': example(
    {},
    {
      accountStatus: verificationStatusSchema.enum.pending,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    },
  ),
  'create-service-category': example(
    { slug: 'skin_fade', ...category },
    { id: CATEGORY, slug: 'skin_fade', ...category, archivedAt: null },
  ),
  'update-service-category': example(
    { id: CATEGORY, ...category },
    { id: CATEGORY, slug: 'skin_fade', ...category, archivedAt: null },
  ),
  'archive-service-category': example(
    { id: CATEGORY },
    { id: CATEGORY, archivedAt: AT },
  ),
  'archive-barber-service': example(
    { serviceId: ID },
    { id: ID, archivedAt: AT },
  ),
  'search-available-now-barbers': example(
    {
      bookingType: BOOKING_TYPE_VALUE.AVAILABLE_NOW,
      serviceCategoryId: CATEGORY,
      lat: -37.8226,
      lng: 144.998,
      radiusKm: 10,
      limit: 20,
      cursor: null,
    },
    {
      results: [
        {
          barberId: BARBER,
          displayName: 'Marcus Example',
          photoUrl: null,
          priceCents: 4_500,
          approximateArea: area,
          distanceBand: '2-5km',
          rating: 4.8,
          ratingCount: 37,
          availableUntil: LATER,
        },
      ],
      nextCursor: null,
    },
  ),
  'create-payment-authorisation': example(
    { bookingRequestId: ID, paymentMethodId: 'pm_synthetic_example' },
    {
      paymentId: ID,
      status: paymentStatusSchema.enum.authorised,
      amountCents: 4_500,
      authorisationExpiresAt: '2026-11-09T00:00:00Z',
    },
  ),
  'capture-authorised-payment': example(
    { paymentId: ID },
    {
      paymentId: ID,
      status: paymentStatusSchema.enum.captured,
      capturedCents: 4_500,
      bookingStatus: BOOKING_STATUS_VALUE.PAID_CONFIRMED,
    },
  ),
  'cancel-payment-authorisation': example(
    { paymentId: ID },
    { paymentId: ID, status: paymentStatusSchema.enum.authorisation_cancelled },
  ),
  'create-refund': example(
    { paymentId: ID, operationId: ID },
    {
      paymentId: ID,
      refundId: 're_synthetic_example',
      refundCents: 2_000,
      status: paymentStatusSchema.enum.partially_refunded,
    },
  ),
  'stripe-webhook': example(
    {
      id: 'evt_synthetic_example',
      type: 'account.updated',
      data: { object: { id: 'acct_synthetic_example', object: 'account' } },
    },
    { received: true },
  ),
  'mark-arrived': example(
    { bookingId: BOOKING },
    { bookingId: BOOKING, status: BOOKING_STATUS_VALUE.ARRIVED },
  ),
  'auto-disable-unresponsive-barber': example(
    { sessionId: ID },
    { sessionId: ID, applied: true, status: AVAIL_STATUS_VALUE.AUTO_DISABLED },
  ),
  'expire-booking-request': example(
    { requestId: ID },
    { requestId: ID, applied: true, status: REQUEST_STATUS_VALUE.EXPIRED },
  ),
  'auto-complete-after-barber-complete-timeout': example(
    { bookingId: BOOKING },
    completion,
  ),
  'send-final-completion-prompt': example(
    { bookingId: BOOKING },
    {
      bookingId: BOOKING,
      applied: true,
      status: BOOKING_STATUS_VALUE.COMPLETION_PROMPT_SENT,
      clientRespondBy: LATER,
    },
  ),
  'auto-complete-after-final-prompt': example(
    { bookingId: BOOKING },
    completion,
  ),
  'create-barber-earning': example(
    { bookingId: BOOKING },
    {
      earningId: ID,
      bookingId: BOOKING,
      status: EARNING_STATUS_VALUE.PENDING,
      grossCents: 4_500,
      commissionCents: 900,
      barberNetCents: 3_600,
      commissionPctSnapshot: 20,
    },
  ),
  'release-barber-earning': example(
    { earningId: ID },
    {
      earningId: ID,
      applied: true,
      status: EARNING_STATUS_VALUE.AVAILABLE,
      barberNetCents: 3_600,
    },
  ),
  'queue-payout-batch': example(
    {},
    {
      batchId: ID,
      status: payoutStatusSchema.enum.queued,
      scheduledCutoff: AT,
      itemCount: 1,
      totalCents: 3_600,
    },
  ),
  'process-payout-batch': example(
    { batchId: ID },
    {
      batchId: ID,
      status: payoutStatusSchema.enum.processing,
      paidItemCount: 0,
      failedItemCount: 0,
      queuedItemCount: 1,
    },
  ),
  'mark-payout-batch-paid': example(
    { batchId: ID },
    { batchId: ID, status: payoutStatusSchema.enum.paid, paidItemCount: 1 },
  ),
  'update-review-admin-visibility': example(
    {
      reviewId: ID,
      visible: false,
      reason: 'Review contains personal contact information.',
    },
    { reviewId: ID, visible: false, auditLogId: ID },
  ),
  'admin-list-bookings': example(
    {
      limit: 20,
      statusFilter: BOOKING_STATUS_VALUE.PAID_CONFIRMED,
      cursor: null,
    },
    { results: [booking], nextCursor: null },
  ),
  'admin-get-booking-detail': example(
    { bookingId: BOOKING },
    {
      booking,
      request: {
        requestId: ID,
        servicePriceCents: 4_500,
        commissionPctSnapshot: 20,
        commissionCents: 900,
        barberNetCents: 3_600,
      },
      statusHistory: [
        {
          fromStatus: BOOKING_STATUS_VALUE.ACCEPTED_PENDING_PAYMENT,
          toStatus: BOOKING_STATUS_VALUE.PAID_CONFIRMED,
          actorId: BARBER,
          actorRole: USER_ROLE_VALUE.BARBER,
          reason: 'Capture confirmed by server.',
          createdAt: AT,
        },
      ],
      payment: {
        paymentId: ID,
        status: paymentStatusSchema.enum.captured,
        capturedCents: 4_500,
        refundedCents: 0,
        stripePaymentIntentId: 'pi_synthetic_example',
      },
      earning: null,
      dispute: null,
      refunds: [],
      cancellation: null,
    },
  ),
  'admin-resolve-dispute': example(
    {
      disputeId: ID,
      outcome: DISPUTE_STATUS_VALUE.RESOLVED_PARTIAL_REFUND,
      refundCents: 2_000,
      reason: 'Service partially delivered; agreed by both parties.',
    },
    {
      disputeId: ID,
      status: DISPUTE_STATUS_VALUE.RESOLVED_PARTIAL_REFUND,
      refundCents: 2_000,
      barberNetCents: 2_000,
      platformRetainedCents: 500,
      capturedCents: 4_500,
      earningStatus: EARNING_STATUS_VALUE.AVAILABLE,
      auditLogId: ID,
    },
  ),
  'admin-issue-refund': example(
    {
      bookingId: BOOKING,
      refundCents: 2_000,
      reason: 'Agreed service refund.',
    },
    {
      bookingId: BOOKING,
      refundId: 're_synthetic_example',
      refundCents: 2_000,
      capturedCents: 4_500,
      remainingRefundableCents: 2_500,
      auditLogId: ID,
    },
  ),
  'admin-update-reliability-state': reliability,
  'admin-update-barber-status': reliability,
  'admin-view-platform-analytics': example(
    { from: AT, to: LATER },
    {
      clientCount: 12,
      barberCount: 4,
      activeBookingCount: 1,
      openDisputeCount: 0,
      paymentCounts: [{ status: paymentStatusSchema.enum.captured, count: 1 }],
      earningCounts: [{ status: EARNING_STATUS_VALUE.PENDING, count: 1 }],
      captureFailedCount: 0,
      acceptedPendingPaymentCount: 0,
      failedPayoutItemCount: 0,
    },
  ),
} as const;
