import { z } from 'zod';

import {
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  postgresUuidSchema,
} from '../primitives.ts';
import { requestObject } from '../request-object.ts';

export const createReviewRequestSchema = requestObject({
  bookingId: postgresUuidSchema,
  rating: z.number().int().min(1).max(5),
  text: nonEmptyStringSchema.optional(),
});
export type CreateReviewRequest = z.infer<typeof createReviewRequestSchema>;

export const createReviewResponseSchema = z.strictObject({
  reviewId: postgresUuidSchema,
  rating: z.number().int().min(1).max(5),
  barberRating: z.number().finite().min(0).max(5),
  barberRatingCount: nonNegativeIntegerSchema,
});
export type CreateReviewResponse = z.infer<typeof createReviewResponseSchema>;
