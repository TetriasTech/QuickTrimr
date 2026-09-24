import {
  BOOKING_STATUS_VALUE,
  BOOKING_TYPE_VALUE,
  REQUEST_STATUS_VALUE,
} from '@quicktrimr/shared';
import { z } from 'zod';

import {
  bookingTypeSchema,
  integerCentsSchema,
  nonEmptyStringSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

export const createBookingRequestRequestSchema = requestObject({
    bookingType: bookingTypeSchema,
    barberId: postgresUuidSchema,
    serviceCategoryId: postgresUuidSchema,
    clientAddressId: postgresUuidSchema,
    notes: z.string().optional(),
    scheduledFor: timestampSchema.optional(),
  })
  .superRefine((value, context) => {
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
  commissionPct: z.number().finite().nonnegative(),
  grossCents: integerCentsSchema,
  commissionCents: integerCentsSchema,
  barberNetCents: integerCentsSchema,
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
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
  bookingStatus: z.literal(BOOKING_STATUS_VALUE.ACCEPTED_PENDING_PAYMENT),
});
export type AcceptBookingRequestResponse = z.infer<
  typeof acceptBookingRequestResponseSchema
>;

export const declineBookingRequestRequestSchema = requestObject({
  requestId: postgresUuidSchema,
  reason: nonEmptyStringSchema.optional(),
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
