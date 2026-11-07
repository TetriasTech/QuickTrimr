import {
  AVAIL_STATUS_VALUE,
  BOOKING_STATUS_VALUE,
  EARNING_STATUS_VALUE,
  REQUEST_STATUS_VALUE,
} from '@quicktrimr/shared';
import { z } from 'zod';

import {
  availStatusSchema,
  bookingStatusSchema,
  earningStatusSchema,
  integerCentsSchema,
  nonNegativeIntegerSchema,
  payoutStatusSchema,
  postgresUuidSchema,
  requestStatusSchema,
  timestampSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

// All worker inputs are references only: never a clock, amount, actor or status.
// Applied=false reports current state after a stale/early/duplicate invocation.
export const autoDisableUnresponsiveBarberRequestSchema = requestObject({
  sessionId: postgresUuidSchema,
});
export type AutoDisableUnresponsiveBarberRequest = z.infer<
  typeof autoDisableUnresponsiveBarberRequestSchema
>;
export const autoDisableUnresponsiveBarberResponseSchema = z.discriminatedUnion(
  'applied',
  [
    z.strictObject({
      sessionId: postgresUuidSchema,
      applied: z.literal(true),
      status: z.literal(AVAIL_STATUS_VALUE.AUTO_DISABLED),
    }),
    z.strictObject({
      sessionId: postgresUuidSchema,
      applied: z.literal(false),
      status: availStatusSchema,
    }),
  ],
);
export type AutoDisableUnresponsiveBarberResponse = z.infer<
  typeof autoDisableUnresponsiveBarberResponseSchema
>;

export const expireBookingRequestRequestSchema = requestObject({
  requestId: postgresUuidSchema,
});
export type ExpireBookingRequestRequest = z.infer<
  typeof expireBookingRequestRequestSchema
>;
export const expireBookingRequestResponseSchema = z.discriminatedUnion(
  'applied',
  [
    z.strictObject({
      requestId: postgresUuidSchema,
      applied: z.literal(true),
      status: z.literal(REQUEST_STATUS_VALUE.EXPIRED),
    }),
    z.strictObject({
      requestId: postgresUuidSchema,
      applied: z.literal(false),
      status: requestStatusSchema,
    }),
  ],
);
export type ExpireBookingRequestResponse = z.infer<
  typeof expireBookingRequestResponseSchema
>;

const completionResultSchema = z.discriminatedUnion('applied', [
  z.strictObject({
    bookingId: postgresUuidSchema,
    applied: z.literal(true),
    status: z.literal(BOOKING_STATUS_VALUE.COMPLETED),
    earningStatus: z.literal(EARNING_STATUS_VALUE.AVAILABLE),
  }),
  z.strictObject({
    bookingId: postgresUuidSchema,
    applied: z.literal(false),
    status: bookingStatusSchema,
    earningStatus: earningStatusSchema,
  }),
]);
export const autoCompleteAfterBarberCompleteTimeoutRequestSchema =
  requestObject({ bookingId: postgresUuidSchema });
export type AutoCompleteAfterBarberCompleteTimeoutRequest = z.infer<
  typeof autoCompleteAfterBarberCompleteTimeoutRequestSchema
>;
export const autoCompleteAfterBarberCompleteTimeoutResponseSchema =
  completionResultSchema;
export type AutoCompleteAfterBarberCompleteTimeoutResponse = z.infer<
  typeof autoCompleteAfterBarberCompleteTimeoutResponseSchema
>;

export const sendFinalCompletionPromptRequestSchema = requestObject({
  bookingId: postgresUuidSchema,
});
export type SendFinalCompletionPromptRequest = z.infer<
  typeof sendFinalCompletionPromptRequestSchema
>;
export const sendFinalCompletionPromptResponseSchema = z.discriminatedUnion(
  'applied',
  [
    z.strictObject({
      bookingId: postgresUuidSchema,
      applied: z.literal(true),
      status: z.literal(BOOKING_STATUS_VALUE.COMPLETION_PROMPT_SENT),
      clientRespondBy: timestampSchema,
    }),
    z.strictObject({
      bookingId: postgresUuidSchema,
      applied: z.literal(false),
      status: bookingStatusSchema,
      clientRespondBy: timestampSchema.nullable(),
    }),
  ],
);
export type SendFinalCompletionPromptResponse = z.infer<
  typeof sendFinalCompletionPromptResponseSchema
>;

export const autoCompleteAfterFinalPromptRequestSchema = requestObject({
  bookingId: postgresUuidSchema,
});
export type AutoCompleteAfterFinalPromptRequest = z.infer<
  typeof autoCompleteAfterFinalPromptRequestSchema
>;
export const autoCompleteAfterFinalPromptResponseSchema =
  completionResultSchema;
export type AutoCompleteAfterFinalPromptResponse = z.infer<
  typeof autoCompleteAfterFinalPromptResponseSchema
>;

export const createBarberEarningRequestSchema = requestObject({
  bookingId: postgresUuidSchema,
});
export type CreateBarberEarningRequest = z.infer<
  typeof createBarberEarningRequestSchema
>;
export const createBarberEarningResponseSchema = z.strictObject({
  earningId: postgresUuidSchema,
  bookingId: postgresUuidSchema,
  status: earningStatusSchema,
  grossCents: integerCentsSchema,
  commissionCents: integerCentsSchema,
  barberNetCents: integerCentsSchema,
  commissionPctSnapshot: z.number().finite().nonnegative(),
  idempotent: z.boolean().optional(),
});
export type CreateBarberEarningResponse = z.infer<
  typeof createBarberEarningResponseSchema
>;

export const releaseBarberEarningRequestSchema = requestObject({
  earningId: postgresUuidSchema,
});
export type ReleaseBarberEarningRequest = z.infer<
  typeof releaseBarberEarningRequestSchema
>;
export const releaseBarberEarningResponseSchema = z.discriminatedUnion(
  'applied',
  [
    z.strictObject({
      earningId: postgresUuidSchema,
      applied: z.literal(true),
      status: z.literal(EARNING_STATUS_VALUE.AVAILABLE),
      barberNetCents: integerCentsSchema,
    }),
    z.strictObject({
      earningId: postgresUuidSchema,
      applied: z.literal(false),
      status: earningStatusSchema,
      barberNetCents: integerCentsSchema,
    }),
  ],
);
export type ReleaseBarberEarningResponse = z.infer<
  typeof releaseBarberEarningResponseSchema
>;

export const queuePayoutBatchRequestSchema = requestObject({});
export type QueuePayoutBatchRequest = z.infer<
  typeof queuePayoutBatchRequestSchema
>;
export const queuePayoutBatchResponseSchema = z.union([
  z.strictObject({
    batchId: postgresUuidSchema,
    status: z.literal(payoutStatusSchema.enum.queued),
    scheduledCutoff: timestampSchema,
    itemCount: z.number().int().positive(),
    totalCents: integerCentsSchema.refine((value) => value > 0),
    idempotent: z.boolean().optional(),
  }),
  z.strictObject({
    batchId: z.null(),
    itemCount: z.literal(0),
    totalCents: integerCentsSchema.refine((value) => value === 0),
  }),
]);
export type QueuePayoutBatchResponse = z.infer<
  typeof queuePayoutBatchResponseSchema
>;

export const processPayoutBatchRequestSchema = requestObject({
  batchId: postgresUuidSchema,
});
export type ProcessPayoutBatchRequest = z.infer<
  typeof processPayoutBatchRequestSchema
>;
export const processPayoutBatchResponseSchema = z.strictObject({
  batchId: postgresUuidSchema,
  status: payoutStatusSchema,
  paidItemCount: nonNegativeIntegerSchema,
  failedItemCount: nonNegativeIntegerSchema,
  queuedItemCount: nonNegativeIntegerSchema,
});
export type ProcessPayoutBatchResponse = z.infer<
  typeof processPayoutBatchResponseSchema
>;

export const markPayoutBatchPaidRequestSchema = requestObject({
  batchId: postgresUuidSchema,
});
export type MarkPayoutBatchPaidRequest = z.infer<
  typeof markPayoutBatchPaidRequestSchema
>;
export const markPayoutBatchPaidResponseSchema = z.strictObject({
  batchId: postgresUuidSchema,
  status: z.literal(payoutStatusSchema.enum.paid),
  paidItemCount: z.number().int().positive(),
});
export type MarkPayoutBatchPaidResponse = z.infer<
  typeof markPayoutBatchPaidResponseSchema
>;
