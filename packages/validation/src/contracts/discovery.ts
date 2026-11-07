import { BOOKING_TYPE_VALUE } from '@quicktrimr/shared';
import { z } from 'zod';

import {
  bookingTypeSchema,
  geographicPointSchema,
  integerCentsSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  positiveNumberSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

import { httpsUrlSchema, publicAreaSchema } from './profiles.ts';

// RULE-DISCOVERY-05's public bands, never exact distance or barber coordinates.
export const distanceBandSchema = z.union([
  z.literal('under-2km'),
  z.literal('2-5km'),
  z.literal('5-10km'),
  z.literal('10km+'),
]);
export const searchAvailableNowBarbersRequestSchema = requestObject({
  bookingType: bookingTypeSchema,
  serviceCategoryId: postgresUuidSchema,
  ...geographicPointSchema.shape,
  radiusKm: positiveNumberSchema,
  scheduledFor: timestampSchema.optional(),
  cursor: nonEmptyStringSchema.nullable().optional(),
  limit: z.number().int().positive(),
}).superRefine((value, context) => {
  if (
    (value.bookingType === BOOKING_TYPE_VALUE.SCHEDULED) !==
    (value.scheduledFor !== undefined)
  )
    context.addIssue({
      code: 'custom',
      path: ['scheduledFor'],
      message: 'A requested time is required only for Scheduled search',
    });
});
export type SearchAvailableNowBarbersRequest = z.infer<
  typeof searchAvailableNowBarbersRequestSchema
>;
export const searchAvailableNowBarbersResponseSchema = z.strictObject({
  results: z.array(
    z.strictObject({
      barberId: postgresUuidSchema,
      displayName: nonEmptyStringSchema,
      photoUrl: httpsUrlSchema.nullable(),
      priceCents: integerCentsSchema,
      approximateArea: publicAreaSchema,
      distanceBand: distanceBandSchema,
      rating: z.number().finite().min(1).max(5).nullable(),
      ratingCount: nonNegativeIntegerSchema,
      availableUntil: timestampSchema.nullable(),
    }),
  ),
  nextCursor: nonEmptyStringSchema.nullable(),
});
export type SearchAvailableNowBarbersResponse = z.infer<
  typeof searchAvailableNowBarbersResponseSchema
>;
