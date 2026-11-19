import { AVAIL_STATUS_VALUE } from '@quicktrimr/shared';
import { z } from 'zod';

import {
  geographicPointSchema,
  availStatusSchema,
  reliabilityLevelSchema,
  locationSourceSchema,
  positiveNumberSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';
import {
  requestObject,
  ignoreServerControlledFields,
} from '../request-object.ts';

import { addressDirectoryIdSchema } from './client-addresses.ts';

const approximateAreaSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
});

const availableNowSessionResponseSchema = z.strictObject({
  id: postgresUuidSchema,
  status: z.literal(AVAIL_STATUS_VALUE.ACTIVE),
  radiusKm: positiveNumberSchema,
  availableUntil: timestampSchema,
  locationSource: locationSourceSchema,
  approximateArea: approximateAreaSchema,
});

const boundsInput = {
  radiusKm: positiveNumberSchema,
  availableUntil: timestampSchema,
};
const locationInput = {
  lat: geographicPointSchema.shape.lat.optional(),
  lng: geographicPointSchema.shape.lng.optional(),
  locationSource: locationSourceSchema.optional(),
  directoryId: addressDirectoryIdSchema.optional(),
};
const validateLocation = (
  input: z.infer<z.ZodObject<typeof locationInput>> & {
    keepLocation?: boolean | undefined;
  },
  ctx: z.RefinementCtx,
) => {
  if (input.keepLocation) {
    if (
      input.lat !== undefined ||
      input.lng !== undefined ||
      input.locationSource !== undefined ||
      input.directoryId !== undefined
    )
      ctx.addIssue({
        code: 'custom',
        path: ['keepLocation'],
        message: 'Choose one location source.',
      });
  } else if (input.directoryId !== undefined) {
    if (
      input.locationSource !== 'manual' ||
      input.lat !== undefined ||
      input.lng !== undefined
    )
      ctx.addIssue({
        code: 'custom',
        path: ['directoryId'],
        message: 'Choose one manual address.',
      });
  } else if (
    input.lat === undefined ||
    input.lng === undefined ||
    input.locationSource === undefined
  )
    ctx.addIssue({
      code: 'custom',
      path: ['lat'],
      message: 'Choose a location.',
    });
};
export const startAvailableNowSessionRequestSchema =
  ignoreServerControlledFields(
    z
      .strictObject({ ...boundsInput, ...locationInput })
      .superRefine(validateLocation),
  );
export type StartAvailableNowSessionRequest = z.infer<
  typeof startAvailableNowSessionRequestSchema
>;

export const startAvailableNowSessionResponseSchema =
  availableNowSessionResponseSchema;
export type StartAvailableNowSessionResponse = z.infer<
  typeof startAvailableNowSessionResponseSchema
>;

export const updateAvailableNowSessionRequestSchema =
  ignoreServerControlledFields(
    z
      .strictObject({
        ...boundsInput,
        ...locationInput,
        sessionId: postgresUuidSchema,
        keepLocation: z.literal(true).optional(),
      })
      .superRefine(validateLocation),
  );
export type UpdateAvailableNowSessionRequest = z.infer<
  typeof updateAvailableNowSessionRequestSchema
>;

export const updateAvailableNowSessionResponseSchema =
  availableNowSessionResponseSchema;
export type UpdateAvailableNowSessionResponse = z.infer<
  typeof updateAvailableNowSessionResponseSchema
>;

export const stopAvailableNowSessionRequestSchema = requestObject({
  sessionId: postgresUuidSchema,
});
export type StopAvailableNowSessionRequest = z.infer<
  typeof stopAvailableNowSessionRequestSchema
>;

export const stopAvailableNowSessionResponseSchema = z.strictObject({
  id: postgresUuidSchema,
  status: z.literal(AVAIL_STATUS_VALUE.MANUALLY_DISABLED),
});
export type StopAvailableNowSessionResponse = z.infer<
  typeof stopAvailableNowSessionResponseSchema
>;

export const ownAvailableNowStateSchema = z.strictObject({
  serverNow: timestampSchema,
  config: z
    .strictObject({
      minRadiusKm: positiveNumberSchema,
      maxRadiusKm: positiveNumberSchema,
      maxHours: positiveNumberSchema,
    })
    .refine((c) => c.maxRadiusKm >= c.minRadiusKm),
  onboardingEligible: z.boolean(),
  reliability: z.strictObject({
    level: reliabilityLevelSchema,
    cooldownUntil: timestampSchema.nullable(),
    recoveryEligibleAt: timestampSchema.nullable(),
    reviewRequired: z.boolean(),
    requiresHumanReinstatement: z.boolean(),
    availableNowAllowed: z.boolean(),
  }),
  session: z
    .strictObject({
      id: postgresUuidSchema,
      status: availStatusSchema,
      isActive: z.boolean(),
      radiusKm: positiveNumberSchema.nullable(),
      availableUntil: timestampSchema.nullable(),
      locationSource: locationSourceSchema.nullable(),
      approximateArea: approximateAreaSchema.nullable(),
    })
    .nullable(),
});
export type OwnAvailableNowState = z.infer<typeof ownAvailableNowStateSchema>;
