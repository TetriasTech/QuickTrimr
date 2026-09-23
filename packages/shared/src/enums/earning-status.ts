export const EARNING_STATUS = [
  'pending',
  'available',
  'queued_for_payout',
  'paid_out',
  'reversed',
] as const;

export type EarningStatus = (typeof EARNING_STATUS)[number];
