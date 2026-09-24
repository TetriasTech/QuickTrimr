export const AVAIL_STATUS = [
  'active',
  'busy',
  'expired',
  'manually_disabled',
  'auto_disabled',
  'cancelled',
] as const;

export type AvailStatus = (typeof AVAIL_STATUS)[number];
