import { z } from 'zod';

import {
  integerCentsSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

export const upsertBarberServiceRequestSchema = requestObject({
  serviceCategoryId: postgresUuidSchema,
  priceCents: integerCentsSchema,
  enabled: z.boolean(),
});
export type UpsertBarberServiceRequest = z.infer<
  typeof upsertBarberServiceRequestSchema
>;

export const upsertBarberServiceResponseSchema = z.strictObject({
  id: postgresUuidSchema,
  serviceCategoryId: postgresUuidSchema,
  priceCents: integerCentsSchema,
  enabled: z.boolean(),
  archivedAt: timestampSchema.nullable(),
});
export type UpsertBarberServiceResponse = z.infer<
  typeof upsertBarberServiceResponseSchema
>;
