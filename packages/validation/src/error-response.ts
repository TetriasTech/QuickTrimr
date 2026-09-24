import { z } from 'zod';

import { nonEmptyStringSchema } from './primitives.ts';

export const errorResponseSchema = z.strictObject({
  error: nonEmptyStringSchema,
  fields: z.record(z.string(), nonEmptyStringSchema).optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
