import { AVAIL_STATUS_VALUE } from '@quicktrimr/shared';
import { z } from 'zod';

import {
  geographicPointSchema,
  locationSourceSchema,
  positiveNumberSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

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

export const startAvailableNowSessionRequestSchema = requestObject({
  ...geographicPointSchema.shape,
  locationSource: locationSourceSchema,
  radiusKm: positiveNumberSchema,
  availableUntil: timestampSchema,
});
export type StartAvailableNowSessionRequest = z.infer<
  typeof startAvailableNowSessionRequestSchema
>;

export const startAvailableNowSessionResponseSchema = availableNowSessionResponseSchema;
export type StartAvailableNowSessionResponse = z.infer<
  typeof startAvailableNowSessionResponseSchema
>;

export const updateAvailableNowSessionRequestSchema = requestObject({
  sessionId: postgresUuidSchema,
  ...geographicPointSchema.shape,
  locationSource: locationSourceSchema,
  radiusKm: positiveNumberSchema,
  availableUntil: timestampSchema,
});
export type UpdateAvailableNowSessionRequest = z.infer<
  typeof updateAvailableNowSessionRequestSchema
>;

export const updateAvailableNowSessionResponseSchema = availableNowSessionResponseSchema;
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
