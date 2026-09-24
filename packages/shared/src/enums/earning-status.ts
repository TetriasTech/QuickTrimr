export const EARNING_STATUS_VALUE = {
  PENDING: 'pending',
  AVAILABLE: 'available',
  QUEUED_FOR_PAYOUT: 'queued_for_payout',
  PAID_OUT: 'paid_out',
  REVERSED: 'reversed',
} as const;

export const EARNING_STATUS = [
  EARNING_STATUS_VALUE.PENDING,
  EARNING_STATUS_VALUE.AVAILABLE,
  EARNING_STATUS_VALUE.QUEUED_FOR_PAYOUT,
  EARNING_STATUS_VALUE.PAID_OUT,
  EARNING_STATUS_VALUE.REVERSED,
] as const;

export type EarningStatus = (typeof EARNING_STATUS)[number];
