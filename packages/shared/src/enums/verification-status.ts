export const VERIFICATION_STATUS = [
  'not_started',
  'pending',
  'verified',
  'failed',
  'requires_review',
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUS)[number];
