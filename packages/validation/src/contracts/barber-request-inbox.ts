import { BOOKING_TYPE_VALUE, REQUEST_STATUS_VALUE } from '@quicktrimr/shared';
import { z } from 'zod';

import {
  bookingStatusSchema,
  bookingTypeSchema,
  integerCentsSchema,
  nonEmptyStringSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';

import { distanceBandSchema } from './discovery.ts';
import { paymentCaptureNoticeSchema } from './payments.ts';

export const barberBookingStatusSchema = z.strictObject({
  id: postgresUuidSchema,
  status: bookingStatusSchema,
  captureNotice: paymentCaptureNoticeSchema.optional(),
});

export const barberRequestInboxInputSchema = z
  .strictObject({
    p_request_id: postgresUuidSchema.optional(),
    p_after_expires_at: timestampSchema.optional(),
    p_after_request_id: postgresUuidSchema.optional(),
    p_limit: z.number().int().positive().optional(),
  })
  .refine(
    (input) =>
      (input.p_after_expires_at === undefined) ===
        (input.p_after_request_id === undefined) &&
      !(input.p_request_id && input.p_after_request_id),
    {
      message: 'Use both cursor fields or omit both.',
      path: ['p_after_request_id'],
    },
  );

const barberInboxCursorSchema = z.strictObject({
  expiresAt: timestampSchema,
  requestId: postgresUuidSchema,
});

const barberInboxItemSchema = z
  .strictObject({
    id: postgresUuidSchema,
    bookingType: bookingTypeSchema,
    serviceName: nonEmptyStringSchema,
    priceCents: integerCentsSchema,
    clientDisplayName: nonEmptyStringSchema,
    clientRating: z.null(),
    distanceBand: distanceBandSchema.nullable(),
    suburb: nonEmptyStringSchema,
    scheduledFor: timestampSchema.nullable(),
    expiresAt: timestampSchema,
    status: z.literal(REQUEST_STATUS_VALUE.PENDING),
  })
  .refine(
    ({ bookingType, scheduledFor }) =>
      (bookingType === BOOKING_TYPE_VALUE.SCHEDULED) ===
      (scheduledFor !== null),
    {
      message: 'Only Scheduled requests have a requested time.',
      path: ['scheduledFor'],
    },
  );

export const barberRequestInboxPageSchema = z.strictObject({
  requests: z.array(barberInboxItemSchema),
  serverNow: timestampSchema,
  nextCursor: barberInboxCursorSchema.nullable(),
});

export const barberRequestInboxWithJobSlotSchema =
  barberRequestInboxPageSchema.extend({
    hasActiveAvailableNowJob: z.boolean(),
  });

export type BarberRequestInboxWithJobSlot = z.infer<
  typeof barberRequestInboxWithJobSlotSchema
>;

export type BarberRequestInboxInput = z.infer<
  typeof barberRequestInboxInputSchema
>;
export type BarberRequestInboxPage = z.infer<
  typeof barberRequestInboxPageSchema
>;
