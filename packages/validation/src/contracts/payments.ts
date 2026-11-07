import { BOOKING_STATUS_VALUE } from '@quicktrimr/shared';
import { z } from 'zod';

import {
  integerCentsSchema,
  nonEmptyStringSchema,
  paymentStatusSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

export const createPaymentAuthorisationRequestSchema = requestObject({
  bookingRequestId: postgresUuidSchema,
  paymentMethodId: nonEmptyStringSchema,
});
export type CreatePaymentAuthorisationRequest = z.infer<
  typeof createPaymentAuthorisationRequestSchema
>;
export const createPaymentAuthorisationResponseSchema = z.strictObject({
  paymentId: postgresUuidSchema,
  status: z.literal(paymentStatusSchema.enum.authorised),
  amountCents: integerCentsSchema,
  authorisationExpiresAt: timestampSchema,
});
export type CreatePaymentAuthorisationResponse = z.infer<
  typeof createPaymentAuthorisationResponseSchema
>;

export const captureAuthorisedPaymentRequestSchema = requestObject({
  paymentId: postgresUuidSchema,
});
export type CaptureAuthorisedPaymentRequest = z.infer<
  typeof captureAuthorisedPaymentRequestSchema
>;
export const captureAuthorisedPaymentResponseSchema = z.strictObject({
  paymentId: postgresUuidSchema,
  status: z.literal(paymentStatusSchema.enum.captured),
  capturedCents: integerCentsSchema,
  bookingStatus: z.literal(BOOKING_STATUS_VALUE.PAID_CONFIRMED),
  idempotent: z.boolean().optional(),
});
export type CaptureAuthorisedPaymentResponse = z.infer<
  typeof captureAuthorisedPaymentResponseSchema
>;

export const cancelPaymentAuthorisationRequestSchema = requestObject({
  paymentId: postgresUuidSchema,
});
export type CancelPaymentAuthorisationRequest = z.infer<
  typeof cancelPaymentAuthorisationRequestSchema
>;
export const cancelPaymentAuthorisationResponseSchema = z.strictObject({
  paymentId: postgresUuidSchema,
  status: z.literal(paymentStatusSchema.enum.authorisation_cancelled),
  idempotent: z.boolean().optional(),
});
export type CancelPaymentAuthorisationResponse = z.infer<
  typeof cancelPaymentAuthorisationResponseSchema
>;

// Internal persisted operation reference, not an amount or a public refund API.
export const createRefundRequestSchema = requestObject({
  paymentId: postgresUuidSchema,
  operationId: postgresUuidSchema,
});
export type CreateRefundRequest = z.infer<typeof createRefundRequestSchema>;
export const createRefundResponseSchema = z.strictObject({
  paymentId: postgresUuidSchema,
  refundId: nonEmptyStringSchema,
  refundCents: integerCentsSchema,
  status: z.union([
    z.literal(paymentStatusSchema.enum.refunded),
    z.literal(paymentStatusSchema.enum.partially_refunded),
  ]),
  idempotent: z.boolean().optional(),
});
export type CreateRefundResponse = z.infer<typeof createRefundResponseSchema>;

// Only AFTER verification of the original raw bytes by Stripe's signature API.
// This version-independent envelope is not validation of a provider's full object;
// future handlers use the pinned SDK, project fields, and never log/return it.
export const stripeWebhookRequestSchema = z.object({
  id: nonEmptyStringSchema,
  type: nonEmptyStringSchema,
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});
export type StripeWebhookRequest = z.infer<typeof stripeWebhookRequestSchema>;
export const stripeWebhookResponseSchema = z.strictObject({
  received: z.literal(true),
  duplicate: z.boolean().optional(),
});
export type StripeWebhookResponse = z.infer<typeof stripeWebhookResponseSchema>;
