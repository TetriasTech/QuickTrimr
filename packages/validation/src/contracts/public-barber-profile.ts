import { z } from 'zod';

import {
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  postgresIntegerCentsSchema,
  postgresUuidSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

import { httpsUrlSchema, publicAreaSchema } from './profiles.ts';

// Shared by the profile and future discovery cards. No private profile columns.
export const publicBarberIdentityShape = {
  barberId: postgresUuidSchema,
  displayName: nonEmptyStringSchema,
  photoUrl: z
    .union([
      httpsUrlSchema,
      z
        .string()
        .regex(
          /^\/storage\/v1\/object\/sign\/barber-avatars\/[^?]+\?token=[^\s]+$/,
        ),
    ])
    .nullable(),
  approximateArea: publicAreaSchema,
  rating: z.number().finite().min(1).max(5).nullable(),
  ratingCount: nonNegativeIntegerSchema,
};
export const publicBarberServiceSchema = z.strictObject({
  id: postgresUuidSchema,
  serviceCategoryId: postgresUuidSchema,
  displayName: nonEmptyStringSchema,
  description: z.string(),
  priceCents: postgresIntegerCentsSchema,
});
export const publicServicesCursorSchema = z.strictObject({
  // Physical Postgres integer bound, not a product setting.
  displayOrder: nonNegativeIntegerSchema.max(2_147_483_647),
  slug: nonEmptyStringSchema,
  id: postgresUuidSchema,
});
export const getPublicBarberProfileRequestSchema = requestObject({
  barberId: postgresUuidSchema.transform((id) => id.toLowerCase()),
  servicesAfter: publicServicesCursorSchema.optional(),
  serviceCategoryId: postgresUuidSchema
    .transform((id) => id.toLowerCase())
    .optional(),
});
export const publicBarberProfileSchema = z.strictObject({
  ...publicBarberIdentityShape,
  bio: z.string(),
  yearsExperience: nonNegativeIntegerSchema,
  services: z.array(publicBarberServiceSchema),
  selectedService: publicBarberServiceSchema.nullable().optional(),
  nextServicesCursor: publicServicesCursorSchema.nullable(),
});
export const getPublicBarberProfileResponseSchema = z.strictObject({
  profile: publicBarberProfileSchema.nullable(),
});
export type GetPublicBarberProfileRequest = z.infer<
  typeof getPublicBarberProfileRequestSchema
>;
export type GetPublicBarberProfileResponse = z.infer<
  typeof getPublicBarberProfileResponseSchema
>;
export type PublicBarberProfile = z.infer<typeof publicBarberProfileSchema>;
export type PublicServicesCursor = z.infer<typeof publicServicesCursorSchema>;
