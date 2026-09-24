import {
  BOOKING_STATUS_VALUE,
  DISPUTE_STATUS_VALUE,
  EARNING_STATUS_VALUE,
  USER_ROLE_VALUE,
} from '@quicktrimr/shared';
import { z } from 'zod';

import {
  geographicPointSchema,
  integerCentsSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

const cancellationRuleSchema = z.string().regex(/^RULE-CANCEL-\d+$/);

export const cancelBookingRequestSchema = requestObject({
  bookingId: postgresUuidSchema,
  reason: nonEmptyStringSchema.optional(),
});
export type CancelBookingRequest = z.infer<typeof cancelBookingRequestSchema>;

const capturedCancellationResponseSchema = z.strictObject({
  bookingId: postgresUuidSchema,
  status: z.literal(BOOKING_STATUS_VALUE.CANCELLED),
  refundCents: integerCentsSchema,
  barberInconvenienceCents: integerCentsSchema,
  platformRetainedCents: integerCentsSchema,
  capturedCents: integerCentsSchema,
  ruleApplied: cancellationRuleSchema,
});

const authorisationCancellationResponseSchema = z.strictObject({
  bookingId: postgresUuidSchema,
  status: z.literal(BOOKING_STATUS_VALUE.CANCELLED),
  refundCents: integerCentsSchema,
  authorisationCancelled: z.boolean(),
  ruleApplied: cancellationRuleSchema,
});

export const cancelBookingResponseSchema = z.union([
  capturedCancellationResponseSchema,
  authorisationCancellationResponseSchema,
]);
export type CancelBookingResponse = z.infer<typeof cancelBookingResponseSchema>;

export const markOnTheWayRequestSchema = requestObject({
  bookingId: postgresUuidSchema,
  ...geographicPointSchema.shape,
});
export type MarkOnTheWayRequest = z.infer<typeof markOnTheWayRequestSchema>;

const markOnTheWayWithEtaResponseSchema = z.strictObject({
  bookingId: postgresUuidSchema,
  status: z.literal(BOOKING_STATUS_VALUE.ON_THE_WAY),
  etaMinutes: nonNegativeIntegerSchema,
  etaUpdatedAt: timestampSchema,
});

const markOnTheWayWithoutEtaResponseSchema = z.strictObject({
  bookingId: postgresUuidSchema,
  status: z.literal(BOOKING_STATUS_VALUE.ON_THE_WAY),
  etaMinutes: z.null(),
  etaUnavailable: z.literal(true),
});

export const markOnTheWayResponseSchema = z.union([
  markOnTheWayWithEtaResponseSchema,
  markOnTheWayWithoutEtaResponseSchema,
]);
export type MarkOnTheWayResponse = z.infer<typeof markOnTheWayResponseSchema>;

export const updateEtaRequestSchema = requestObject({
  bookingId: postgresUuidSchema,
  ...geographicPointSchema.shape,
});
export type UpdateEtaRequest = z.infer<typeof updateEtaRequestSchema>;

const updateEtaResponseFields = {
  bookingId: postgresUuidSchema,
  cached: z.boolean().optional(),
};

export const updateEtaResponseSchema = z.union([
  z.strictObject({
    ...updateEtaResponseFields,
    etaMinutes: nonNegativeIntegerSchema,
    etaUpdatedAt: timestampSchema,
  }),
  z.strictObject({
    ...updateEtaResponseFields,
    etaMinutes: z.null(),
    etaUpdatedAt: z.null(),
  }),
]);
export type UpdateEtaResponse = z.infer<typeof updateEtaResponseSchema>;

export const markJobCompleteByBarberRequestSchema = requestObject({
  bookingId: postgresUuidSchema,
});
export type MarkJobCompleteByBarberRequest = z.infer<
  typeof markJobCompleteByBarberRequestSchema
>;

export const markJobCompleteByBarberResponseSchema = z.strictObject({
  bookingId: postgresUuidSchema,
  status: z.literal(BOOKING_STATUS_VALUE.COMPLETED_BY_BARBER),
  clientRespondBy: timestampSchema,
  earningStatus: z.literal(EARNING_STATUS_VALUE.PENDING),
});
export type MarkJobCompleteByBarberResponse = z.infer<
  typeof markJobCompleteByBarberResponseSchema
>;

export const confirmJobCompleteByClientRequestSchema = requestObject({
  bookingId: postgresUuidSchema,
});
export type ConfirmJobCompleteByClientRequest = z.infer<
  typeof confirmJobCompleteByClientRequestSchema
>;

export const confirmJobCompleteByClientResponseSchema = z.strictObject({
  bookingId: postgresUuidSchema,
  status: z.literal(BOOKING_STATUS_VALUE.COMPLETED),
  earningStatus: z.literal(EARNING_STATUS_VALUE.AVAILABLE),
  completedBy: z.literal(USER_ROLE_VALUE.CLIENT).optional(),
});
export type ConfirmJobCompleteByClientResponse = z.infer<
  typeof confirmJobCompleteByClientResponseSchema
>;

export const openDisputeRequestSchema = requestObject({
  bookingId: postgresUuidSchema,
  reasonCategory: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
});
export type OpenDisputeRequest = z.infer<typeof openDisputeRequestSchema>;

export const openDisputeResponseSchema = z.strictObject({
  disputeId: postgresUuidSchema,
  status: z.literal(DISPUTE_STATUS_VALUE.OPEN),
  bookingStatus: z.literal(BOOKING_STATUS_VALUE.DISPUTED),
  earningStatus: z.literal(EARNING_STATUS_VALUE.PENDING),
});
export type OpenDisputeResponse = z.infer<typeof openDisputeResponseSchema>;
