import {
  BOOKING_STATUS_VALUE,
  BOOKING_TYPE_VALUE,
  REQUEST_DECLINE_REASONS,
  REQUEST_STATUS_VALUE,
} from '@quicktrimr/shared';
import { z } from 'zod';

import {
  bookingTypeSchema,
  integerCentsSchema,
  nonEmptyStringSchema,
  postgresUuidSchema,
  requestStatusSchema,
  timestampSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

import { savedAddressSchema } from './client-addresses.ts';
import { paymentCaptureNoticeSchema } from './payments.ts';

const reviewTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const createBookingRequestRequestSchema = requestObject({
  bookingType: bookingTypeSchema,
  barberId: postgresUuidSchema,
  serviceCategoryId: postgresUuidSchema,
  clientAddressId: postgresUuidSchema,
  notes: z.string().optional(),
  scheduledFor: timestampSchema.optional(),
  reviewToken: reviewTokenSchema.optional(),
}).superRefine((value, context) => {
  if (
    value.bookingType === BOOKING_TYPE_VALUE.SCHEDULED &&
    value.scheduledFor === undefined
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Scheduled bookings require a requested time',
      path: ['scheduledFor'],
    });
  }

  if (
    value.bookingType === BOOKING_TYPE_VALUE.AVAILABLE_NOW &&
    value.scheduledFor !== undefined
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Available Now bookings cannot include a scheduled time',
      path: ['scheduledFor'],
    });
  }
});
export type CreateBookingRequestRequest = z.infer<
  typeof createBookingRequestRequestSchema
>;

export const createBookingRequestResponseSchema = z.strictObject({
  id: postgresUuidSchema,
  status: z.literal(REQUEST_STATUS_VALUE.PENDING),
  bookingType: bookingTypeSchema,
  servicePriceCents: integerCentsSchema,
  commissionPct: z.number().int().min(0).max(100),
  grossCents: integerCentsSchema,
  commissionCents: integerCentsSchema,
  barberNetCents: integerCentsSchema,
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
  paymentRequired: z.literal(true).optional(),
});
export type CreateBookingRequestResponse = z.infer<
  typeof createBookingRequestResponseSchema
>;

export const acceptBookingRequestRequestSchema = requestObject({
  requestId: postgresUuidSchema,
});
export type AcceptBookingRequestRequest = z.infer<
  typeof acceptBookingRequestRequestSchema
>;

export const acceptBookingRequestResponseSchema = z.strictObject({
  requestId: postgresUuidSchema,
  bookingId: postgresUuidSchema,
  requestStatus: z.literal(REQUEST_STATUS_VALUE.ACCEPTED),
  bookingStatus: z.union([
    z.literal(BOOKING_STATUS_VALUE.ACCEPTED_PENDING_PAYMENT),
    z.literal(BOOKING_STATUS_VALUE.PAID_CONFIRMED),
  ]),
});
export type AcceptBookingRequestResponse = z.infer<
  typeof acceptBookingRequestResponseSchema
>;

export const declineBookingRequestRequestSchema = requestObject({
  requestId: postgresUuidSchema,
  reason: z.enum(REQUEST_DECLINE_REASONS).optional(),
});
export type DeclineBookingRequestRequest = z.infer<
  typeof declineBookingRequestRequestSchema
>;

export const declineBookingRequestResponseSchema = z.strictObject({
  requestId: postgresUuidSchema,
  status: z.literal(REQUEST_STATUS_VALUE.DECLINED),
});
export type DeclineBookingRequestResponse = z.infer<
  typeof declineBookingRequestResponseSchema
>;

export const cancelBookingRequestRequestSchema = requestObject({
  requestId: postgresUuidSchema,
  reason: nonEmptyStringSchema.optional(),
});
export type CancelBookingRequestRequest = z.infer<
  typeof cancelBookingRequestRequestSchema
>;

export const cancelBookingRequestResponseSchema = z.strictObject({
  requestId: postgresUuidSchema,
  status: z.literal(REQUEST_STATUS_VALUE.CANCELLED),
});
export type CancelBookingRequestResponse = z.infer<
  typeof cancelBookingRequestResponseSchema
>;

// Authenticated, owner-scoped read RPCs for the submission flow.
export const bookingRequestReviewSchema = z.strictObject({
  barberName: nonEmptyStringSchema,
  serviceName: nonEmptyStringSchema,
  priceCents: integerCentsSchema,
  address: savedAddressSchema,
  cancellation: z.strictObject({
    refundPct: z.number().int().min(0).max(100),
    lateWindowHours: z.number().int().positive().nullable(),
  }),
  scheduledIssue: nonEmptyStringSchema.nullable(),
  reviewToken: reviewTokenSchema,
});
export type BookingRequestReview = z.infer<typeof bookingRequestReviewSchema>;

export const clientBookingRequestSchema = z.strictObject({
  id: postgresUuidSchema,
  bookingType: bookingTypeSchema,
  status: requestStatusSchema,
  expiresAt: timestampSchema,
  serverNow: timestampSchema,
  captureNotice: paymentCaptureNoticeSchema.optional(),
  paymentRequired: z.literal(true).optional(),
  paymentRecoveryDeadline: timestampSchema.optional(),
});
export type ClientBookingRequestStatus = z.infer<
  typeof clientBookingRequestSchema
>;
