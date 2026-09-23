export const PAYOUT_STATUS = [
  'draft',
  'queued',
  'processing',
  'paid',
  'failed',
  'cancelled',
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUS)[number];
