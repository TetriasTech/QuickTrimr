import { z } from 'zod';

import {
  integerCentsSchema,
  postgresIntegerCentsSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

import { createServiceCategoryResponseSchema } from './catalogue.ts';

export const upsertBarberServiceRequestSchema = requestObject({
  serviceCategoryId: postgresUuidSchema,
  priceCents: postgresIntegerCentsSchema,
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

export const barberServiceCatalogueEntrySchema =
  createServiceCategoryResponseSchema.safeExtend({
    services: z
      .array(
        z.strictObject({
          id: postgresUuidSchema,
          serviceCategoryId: postgresUuidSchema,
          priceCents: integerCentsSchema,
          archivedAt: timestampSchema.nullable(),
        }),
      )
      .max(1),
  });
export const barberServiceCataloguePageSchema = z.array(
  barberServiceCatalogueEntrySchema,
);
export type BarberServiceCatalogueEntry = z.infer<
  typeof barberServiceCatalogueEntrySchema
>;
