import { z } from 'zod';

export const SERVER_CONTROLLED_REQUEST_FIELDS = [
  'userId',
  'status',
  'requestStatus',
  'bookingStatus',
  'paymentStatus',
  'earningStatus',
  'payoutStatus',
  'disputeStatus',
  'amount',
  'amountCents',
  'servicePriceCents',
  'commissionPct',
  'commissionAmount',
  'commissionCents',
  'grossCents',
  'barberNetCents',
  'refundCents',
  'payoutCents',
  'totalCents',
  'capturedCents',
  'platformRetainedCents',
  'barberInconvenienceCents',
  'idempotencyKey',
  'createdAt',
  'updatedAt',
  'expiresAt',
  'clientRespondBy',
  'authorisationCancelled',
  'ruleApplied',
] as const;

export function ignoreServerControlledFields<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess((input) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;

    const sanitized = { ...(input as Record<string, unknown>) };
    for (const field of SERVER_CONTROLLED_REQUEST_FIELDS) delete sanitized[field];
    return sanitized;
  }, schema);
}

export function requestObject<const Shape extends z.ZodRawShape>(shape: Shape) {
  return ignoreServerControlledFields(z.strictObject(shape));
}
