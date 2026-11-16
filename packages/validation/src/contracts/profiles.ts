import { USER_ROLE_VALUE } from '@quicktrimr/shared';
import { z } from 'zod';

import {
  geographicPointSchema,
  latitudeSchema,
  longitudeSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  positiveNumberSchema,
  postgresUuidSchema,
  timestampSchema,
  userRoleSchema,
  verificationStatusSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

export const httpsUrlSchema = z
  .url()
  .refine((value) => value.startsWith('https://'), 'Must use HTTPS');
export const publicAreaSchema = z.strictObject({
  id: nonEmptyStringSchema,
  label: nonEmptyStringSchema,
  mapPoint: geographicPointSchema,
});

// Role selects a signup journey, never grants admin or changes an existing role.
// Identity always comes from the verified JWT. Server checks remain mandatory.
export const createOrSyncProfileRequestSchema = requestObject({
  role: z.union([
    z.literal(USER_ROLE_VALUE.CLIENT),
    z.literal(USER_ROLE_VALUE.BARBER),
  ]),
});
export type CreateOrSyncProfileRequest = z.infer<
  typeof createOrSyncProfileRequestSchema
>;
export const createOrSyncProfileResponseSchema = z.strictObject({
  id: postgresUuidSchema,
  role: userRoleSchema,
  verificationStatus: verificationStatusSchema,
  onboardingComplete: z.boolean(),
  createdAt: timestampSchema,
});
export type CreateOrSyncProfileResponse = z.infer<
  typeof createOrSyncProfileResponseSchema
>;

export const INVALID_AU_MOBILE_MESSAGE =
  'Enter a valid Australian mobile number';
export const australianMobileSchema = z
  .string()
  .trim()
  .regex(/^[+0-9\s().-]+$/, INVALID_AU_MOBILE_MESSAGE)
  .transform((input) => input.replace(/[\s().-]/g, ''))
  .transform((input) =>
    input.startsWith('04') ? `+61${input.slice(1)}` : input,
  )
  .pipe(z.string().regex(/^\+614[0-9]{8}$/, INVALID_AU_MOBILE_MESSAGE));

export const completeClientProfileRequestSchema = requestObject({
  displayName: z.string().trim().min(1, 'Enter your display name'),
  mobile: australianMobileSchema,
  attachAvatar: z.literal(true).optional(),
});
export type CompleteClientProfileRequest = z.infer<
  typeof completeClientProfileRequestSchema
>;
export const completeClientProfileResponseSchema = z.strictObject({
  id: postgresUuidSchema,
  displayName: nonEmptyStringSchema,
  mobile: z.string().regex(/^\+614[0-9]{8}$/, INVALID_AU_MOBILE_MESSAGE),
  onboardingComplete: z.boolean(),
  verificationStatus: verificationStatusSchema,
});
export type CompleteClientProfileResponse = z.infer<
  typeof completeClientProfileResponseSchema
>;

// Structural validation only: phone normalization, configured service-radius
// bounds, storage ownership and address/Connect completeness require server data.
export const completeBarberProfileRequestSchema = requestObject({
  displayName: nonEmptyStringSchema,
  bio: z.string(),
  yearsExperience: nonNegativeIntegerSchema,
  serviceAreaLat: latitudeSchema,
  serviceAreaLng: longitudeSchema,
  serviceRadiusKm: positiveNumberSchema,
});
export type CompleteBarberProfileRequest = z.infer<
  typeof completeBarberProfileRequestSchema
>;
export const completeBarberProfileResponseSchema = z.strictObject({
  id: postgresUuidSchema,
  displayName: nonEmptyStringSchema,
  bio: z.string(),
  yearsExperience: nonNegativeIntegerSchema,
  photoUrl: httpsUrlSchema.nullable(),
  serviceRadiusKm: positiveNumberSchema,
  approximateArea: publicAreaSchema,
  onboardingComplete: z.boolean(),
  publishable: z.boolean(),
});
export type CompleteBarberProfileResponse = z.infer<
  typeof completeBarberProfileResponseSchema
>;

export const createStripeConnectOnboardingLinkRequestSchema = requestObject({});
export type CreateStripeConnectOnboardingLinkRequest = z.infer<
  typeof createStripeConnectOnboardingLinkRequestSchema
>;
export const createStripeConnectOnboardingLinkResponseSchema = z.strictObject({
  onboardingUrl: httpsUrlSchema,
  expiresAt: timestampSchema,
  accountStatus: verificationStatusSchema,
});
export type CreateStripeConnectOnboardingLinkResponse = z.infer<
  typeof createStripeConnectOnboardingLinkResponseSchema
>;

export const refreshStripeConnectStatusRequestSchema = requestObject({});
export type RefreshStripeConnectStatusRequest = z.infer<
  typeof refreshStripeConnectStatusRequestSchema
>;
export const refreshStripeConnectStatusResponseSchema = z.strictObject({
  accountStatus: verificationStatusSchema,
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
});
export type RefreshStripeConnectStatusResponse = z.infer<
  typeof refreshStripeConnectStatusResponseSchema
>;
