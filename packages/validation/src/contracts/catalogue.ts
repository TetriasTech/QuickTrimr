import { z } from 'zod';

import {
  integerCentsSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

const categoryFields = {
  displayName: nonEmptyStringSchema,
  description: z.string().optional(),
  displayOrder: nonNegativeIntegerSchema,
  minPriceCents: integerCentsSchema,
  maxPriceCents: integerCentsSchema,
};
function priceRange(
  value: { minPriceCents: number; maxPriceCents: number },
  context: z.RefinementCtx,
) {
  if (value.maxPriceCents <= value.minPriceCents)
    context.addIssue({
      code: 'custom',
      path: ['maxPriceCents'],
      message: 'Must exceed minimum price',
    });
}
export const createServiceCategoryRequestSchema = requestObject({
  slug: nonEmptyStringSchema,
  ...categoryFields,
}).superRefine(priceRange);
export type CreateServiceCategoryRequest = z.infer<
  typeof createServiceCategoryRequestSchema
>;
export const createServiceCategoryResponseSchema = z
  .strictObject({
    id: postgresUuidSchema,
    slug: nonEmptyStringSchema,
    ...categoryFields,
    archivedAt: timestampSchema.nullable(),
  })
  .superRefine(priceRange);
export type CreateServiceCategoryResponse = z.infer<
  typeof createServiceCategoryResponseSchema
>;

export const updateServiceCategoryRequestSchema = requestObject({
  id: postgresUuidSchema,
  ...categoryFields,
}).superRefine(priceRange);
export type UpdateServiceCategoryRequest = z.infer<
  typeof updateServiceCategoryRequestSchema
>;
export const updateServiceCategoryResponseSchema =
  createServiceCategoryResponseSchema;
export type UpdateServiceCategoryResponse = z.infer<
  typeof updateServiceCategoryResponseSchema
>;

export const archiveServiceCategoryRequestSchema = requestObject({
  id: postgresUuidSchema,
});
export type ArchiveServiceCategoryRequest = z.infer<
  typeof archiveServiceCategoryRequestSchema
>;
export const archiveServiceCategoryResponseSchema = z.strictObject({
  id: postgresUuidSchema,
  archivedAt: timestampSchema,
});
export type ArchiveServiceCategoryResponse = z.infer<
  typeof archiveServiceCategoryResponseSchema
>;

export const archiveBarberServiceRequestSchema = requestObject({
  serviceId: postgresUuidSchema,
});
export type ArchiveBarberServiceRequest = z.infer<
  typeof archiveBarberServiceRequestSchema
>;
export const archiveBarberServiceResponseSchema =
  archiveServiceCategoryResponseSchema;
export type ArchiveBarberServiceResponse = z.infer<
  typeof archiveBarberServiceResponseSchema
>;
