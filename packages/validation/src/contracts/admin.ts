import { DISPUTE_STATUS_VALUE, EARNING_STATUS_VALUE } from '@quicktrimr/shared';
import { z } from 'zod';

import {
  bookingStatusSchema,
  bookingTypeSchema,
  disputeStatusSchema,
  earningStatusSchema,
  integerCentsSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  paymentStatusSchema,
  postgresUuidSchema,
  reliabilityLevelSchema,
  timestampSchema,
  userRoleSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

const reasonSchema = nonEmptyStringSchema.refine(
  (value) => value.trim().length > 0,
  'Reason is required',
);
export const updateReviewAdminVisibilityRequestSchema = requestObject({
  reviewId: postgresUuidSchema,
  visible: z.boolean(),
  reason: reasonSchema,
});
export type UpdateReviewAdminVisibilityRequest = z.infer<
  typeof updateReviewAdminVisibilityRequestSchema
>;
export const updateReviewAdminVisibilityResponseSchema = z.strictObject({
  reviewId: postgresUuidSchema,
  visible: z.boolean(),
  auditLogId: postgresUuidSchema,
});
export type UpdateReviewAdminVisibilityResponse = z.infer<
  typeof updateReviewAdminVisibilityResponseSchema
>;

const dateRangeFields = { from: timestampSchema, to: timestampSchema };
function orderedRange(
  value: { from?: string | undefined; to?: string | undefined },
  context: z.RefinementCtx,
) {
  if (
    value.from !== undefined &&
    value.to !== undefined &&
    Date.parse(value.from) > Date.parse(value.to)
  )
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'Must not precede from',
    });
}
export const adminListBookingsRequestSchema = requestObject({
  statusFilter: bookingStatusSchema.optional(),
  bookingType: bookingTypeSchema.optional(),
  clientId: postgresUuidSchema.optional(),
  barberId: postgresUuidSchema.optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  cursor: nonEmptyStringSchema.nullable().optional(),
  limit: z.number().int().positive(),
}).superRefine(orderedRange);
export type AdminListBookingsRequest = z.infer<
  typeof adminListBookingsRequestSchema
>;
const bookingSummarySchema = z.strictObject({
  bookingId: postgresUuidSchema,
  status: bookingStatusSchema,
  bookingType: bookingTypeSchema,
  clientId: postgresUuidSchema,
  barberId: postgresUuidSchema,
  scheduledFor: timestampSchema.nullable(),
  createdAt: timestampSchema,
  grossCents: integerCentsSchema,
});
export const adminListBookingsResponseSchema = z.strictObject({
  results: z.array(bookingSummarySchema),
  nextCursor: nonEmptyStringSchema.nullable(),
});
export type AdminListBookingsResponse = z.infer<
  typeof adminListBookingsResponseSchema
>;

export const adminGetBookingDetailRequestSchema = requestObject({
  bookingId: postgresUuidSchema,
});
export type AdminGetBookingDetailRequest = z.infer<
  typeof adminGetBookingDetailRequestSchema
>;
export const adminGetBookingDetailResponseSchema = z.strictObject({
  booking: bookingSummarySchema,
  request: z.strictObject({
    requestId: postgresUuidSchema,
    servicePriceCents: integerCentsSchema,
    commissionPctSnapshot: z.number().finite().nonnegative(),
    commissionCents: integerCentsSchema,
    barberNetCents: integerCentsSchema,
  }),
  statusHistory: z.array(
    z.strictObject({
      fromStatus: bookingStatusSchema.nullable(),
      toStatus: bookingStatusSchema,
      actorId: postgresUuidSchema.nullable(),
      actorRole: userRoleSchema.nullable(),
      reason: nonEmptyStringSchema,
      createdAt: timestampSchema,
    }),
  ),
  payment: z
    .strictObject({
      paymentId: postgresUuidSchema,
      status: paymentStatusSchema,
      capturedCents: integerCentsSchema,
      refundedCents: integerCentsSchema,
      stripePaymentIntentId: nonEmptyStringSchema,
    })
    .nullable(),
  earning: z
    .strictObject({
      earningId: postgresUuidSchema,
      status: earningStatusSchema,
      barberNetCents: integerCentsSchema,
    })
    .nullable(),
  dispute: z
    .strictObject({
      disputeId: postgresUuidSchema,
      status: disputeStatusSchema,
      reasonCategory: nonEmptyStringSchema,
      description: nonEmptyStringSchema,
    })
    .nullable(),
  refunds: z.array(
    z.strictObject({
      refundId: nonEmptyStringSchema,
      refundCents: integerCentsSchema,
    }),
  ),
  cancellation: z
    .strictObject({
      ruleApplied: nonEmptyStringSchema,
      refundCents: integerCentsSchema,
      barberInconvenienceCents: integerCentsSchema,
    })
    .nullable(),
});
export type AdminGetBookingDetailResponse = z.infer<
  typeof adminGetBookingDetailResponseSchema
>;

// P5-T07 permits a bounded admin-selected refund INTENT, not a trusted amount.
// Strict parsing rejects other server fields; the server independently checks
// admin, snapshots, cumulative refunds, remaining capture and deterministic keys.
export const adminResolveDisputeRequestSchema = z.discriminatedUnion(
  'outcome',
  [
    z.strictObject({
      disputeId: postgresUuidSchema,
      outcome: z.literal(DISPUTE_STATUS_VALUE.RESOLVED_PARTIAL_REFUND),
      refundCents: integerCentsSchema,
      reason: reasonSchema,
    }),
    z.strictObject({
      disputeId: postgresUuidSchema,
      outcome: z.union([
        z.literal(DISPUTE_STATUS_VALUE.RESOLVED_CLIENT_REFUND),
        z.literal(DISPUTE_STATUS_VALUE.RESOLVED_BARBER_PAID),
        z.literal(DISPUTE_STATUS_VALUE.RESOLVED_OPERATIONAL),
      ]),
      reason: reasonSchema,
    }),
  ],
);
export type AdminResolveDisputeRequest = z.infer<
  typeof adminResolveDisputeRequestSchema
>;
export const adminResolveDisputeResponseSchema = z
  .strictObject({
    disputeId: postgresUuidSchema,
    status: z.union([
      z.literal(DISPUTE_STATUS_VALUE.RESOLVED_PARTIAL_REFUND),
      z.literal(DISPUTE_STATUS_VALUE.RESOLVED_CLIENT_REFUND),
      z.literal(DISPUTE_STATUS_VALUE.RESOLVED_BARBER_PAID),
      z.literal(DISPUTE_STATUS_VALUE.RESOLVED_OPERATIONAL),
    ]),
    refundCents: integerCentsSchema,
    barberNetCents: integerCentsSchema,
    platformRetainedCents: integerCentsSchema,
    capturedCents: integerCentsSchema,
    earningStatus: earningStatusSchema,
    auditLogId: postgresUuidSchema,
  })
  .superRefine((value, context) => {
    if (
      value.status === DISPUTE_STATUS_VALUE.RESOLVED_CLIENT_REFUND &&
      value.earningStatus !== EARNING_STATUS_VALUE.REVERSED
    )
      context.addIssue({
        code: 'custom',
        path: ['earningStatus'],
        message: 'A full client refund reverses the earning',
      });
    if (
      value.status === DISPUTE_STATUS_VALUE.RESOLVED_BARBER_PAID &&
      value.earningStatus !== EARNING_STATUS_VALUE.AVAILABLE
    )
      context.addIssue({
        code: 'custom',
        path: ['earningStatus'],
        message: 'A barber-paid resolution releases the eligible earning',
      });
  });
export type AdminResolveDisputeResponse = z.infer<
  typeof adminResolveDisputeResponseSchema
>;

export const adminIssueRefundRequestSchema = z.strictObject({
  bookingId: postgresUuidSchema,
  refundCents: integerCentsSchema,
  reason: reasonSchema,
});
export type AdminIssueRefundRequest = z.infer<
  typeof adminIssueRefundRequestSchema
>;
export const adminIssueRefundResponseSchema = z.strictObject({
  bookingId: postgresUuidSchema,
  refundId: nonEmptyStringSchema,
  refundCents: integerCentsSchema,
  capturedCents: integerCentsSchema,
  remainingRefundableCents: integerCentsSchema,
  auditLogId: postgresUuidSchema,
});
export type AdminIssueRefundResponse = z.infer<
  typeof adminIssueRefundResponseSchema
>;

export const adminUpdateReliabilityStateRequestSchema = requestObject({
  barberId: postgresUuidSchema,
  toLevel: reliabilityLevelSchema,
  reason: reasonSchema,
  correctedEventId: postgresUuidSchema.optional(),
});
export type AdminUpdateReliabilityStateRequest = z.infer<
  typeof adminUpdateReliabilityStateRequestSchema
>;
export const adminUpdateReliabilityStateResponseSchema = z.strictObject({
  barberId: postgresUuidSchema,
  level: reliabilityLevelSchema,
  previousLevel: reliabilityLevelSchema,
  eventId: postgresUuidSchema,
  overriddenByAdmin: z.literal(true),
  auditLogId: postgresUuidSchema,
});
export type AdminUpdateReliabilityStateResponse = z.infer<
  typeof adminUpdateReliabilityStateResponseSchema
>;

// RULE-ADMIN-BARBER-STATUS-ALIAS: same schemas; future handler must delegate too.
export const adminUpdateBarberStatusRequestSchema =
  adminUpdateReliabilityStateRequestSchema;
export type AdminUpdateBarberStatusRequest = z.infer<
  typeof adminUpdateBarberStatusRequestSchema
>;
export const adminUpdateBarberStatusResponseSchema =
  adminUpdateReliabilityStateResponseSchema;
export type AdminUpdateBarberStatusResponse = z.infer<
  typeof adminUpdateBarberStatusResponseSchema
>;

export const adminViewPlatformAnalyticsRequestSchema =
  requestObject(dateRangeFields).superRefine(orderedRange);
export type AdminViewPlatformAnalyticsRequest = z.infer<
  typeof adminViewPlatformAnalyticsRequestSchema
>;
export const adminViewPlatformAnalyticsResponseSchema = z.strictObject({
  clientCount: nonNegativeIntegerSchema,
  barberCount: nonNegativeIntegerSchema,
  activeBookingCount: nonNegativeIntegerSchema,
  openDisputeCount: nonNegativeIntegerSchema,
  paymentCounts: z.array(
    z.strictObject({
      status: paymentStatusSchema,
      count: nonNegativeIntegerSchema,
    }),
  ),
  earningCounts: z.array(
    z.strictObject({
      status: earningStatusSchema,
      count: nonNegativeIntegerSchema,
    }),
  ),
  captureFailedCount: nonNegativeIntegerSchema,
  acceptedPendingPaymentCount: nonNegativeIntegerSchema,
  failedPayoutItemCount: nonNegativeIntegerSchema,
});
export type AdminViewPlatformAnalyticsResponse = z.infer<
  typeof adminViewPlatformAnalyticsResponseSchema
>;
