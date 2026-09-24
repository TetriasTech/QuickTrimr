export const PAYMENT_STATUS = [
  'requires_authorisation',
  'authorised',
  'authorisation_cancelled',
  'capture_pending',
  'captured',
  'capture_failed',
  'refunded',
  'partially_refunded',
  'disputed',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[number];
