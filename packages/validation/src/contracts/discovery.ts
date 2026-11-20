import { BOOKING_TYPE_VALUE } from '@quicktrimr/shared';
import { z } from 'zod';

import {
  bookingTypeSchema,
  geographicPointSchema,
  integerCentsSchema,
  nonEmptyStringSchema,
  positiveNumberSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

import { publicBarberIdentityShape } from './public-barber-profile.ts';

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
  limit: z.number().int().positive().optional(),
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
export const discoveryResultSchema = z.strictObject({
  ...publicBarberIdentityShape,
  priceCents: integerCentsSchema,
  distanceBand: distanceBandSchema,
  availableUntil: timestampSchema.nullable(),
});
export const searchAvailableNowBarbersResponseSchema = z.strictObject({
  results: z.array(discoveryResultSchema),
  nextCursor: nonEmptyStringSchema.nullable(),
});
const rangeSchema = z.strictObject({
  min: z.number().positive().finite(),
  max: z.number().positive().finite(),
});
export const discoveryConfigSchema = z.strictObject({
  radiusKm: rangeSchema.refine((v) => v.min <= v.max),
  pageSize: z
    .strictObject({
      min: z.number().int().positive(),
      max: z.number().int().positive(),
      default: z.number().int().positive(),
    })
    .refine((v) => v.min <= v.default && v.default <= v.max),
  distanceBands: z.strictObject({
    upperMeters: z
      .array(z.number().positive().finite())
      .length(3)
      .refine((v) => v.every((n, i) => i === 0 || n > v[i - 1]!)),
    labels: z.tuple([
      z.literal('under-2km'),
      z.literal('2-5km'),
      z.literal('5-10km'),
      z.literal('10km+'),
    ]),
  }),
});
// Private cursor keys are authenticated/encrypted; this is never a public result.
export const discoverySortKeySchema = z.strictObject({
  demoted: z.boolean(),
  distanceMeters: z.number().finite().nonnegative(),
  priceCents: integerCentsSchema,
  rating: publicBarberIdentityShape.rating,
  ratingCount: publicBarberIdentityShape.ratingCount,
  barberId: postgresUuidSchema,
});
export type SearchAvailableNowBarbersResponse = z.infer<
  typeof searchAvailableNowBarbersResponseSchema
>;

export const getDiscoveryFiltersRequestSchema = requestObject({
  addressId: postgresUuidSchema.optional(),
});
export const schedulingConfigSchema = z
  .strictObject({
    minimumLeadMinutes: z.number().int().positive().safe(),
    maximumHorizonDays: z.number().int().positive().safe(),
  })
  .refine((v) => v.minimumLeadMinutes <= v.maximumHorizonDays * 24 * 60);
export const getDiscoveryFiltersResponseSchema = z.strictObject({
  serverNow: timestampSchema,
  scheduling: schedulingConfigSchema,
  radiusKm: rangeSchema.refine((v) => v.min <= v.max),
  address: z
    .strictObject({
      id: postgresUuidSchema,
      label: nonEmptyStringSchema,
      point: geographicPointSchema,
    })
    .nullable(),
});
export type GetDiscoveryFiltersResponse = z.infer<
  typeof getDiscoveryFiltersResponseSchema
>;

export const discoveryRadiusFormSchema = z.strictObject({
  radius: z
    .string()
    .refine(
      (v) => v.trim().length > 0 && Number.isFinite(Number(v)),
      'Enter a search radius.',
    ),
});

export type GetDiscoveryFiltersRequest = z.infer<
  typeof getDiscoveryFiltersRequestSchema
>;
export type DiscoveryFilters = GetDiscoveryFiltersResponse;
