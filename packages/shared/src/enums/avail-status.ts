export const AVAIL_STATUS_VALUE = {
  ACTIVE: 'active',
  BUSY: 'busy',
  EXPIRED: 'expired',
  MANUALLY_DISABLED: 'manually_disabled',
  AUTO_DISABLED: 'auto_disabled',
  CANCELLED: 'cancelled',
} as const;

export const AVAIL_STATUS = [
  AVAIL_STATUS_VALUE.ACTIVE,
  AVAIL_STATUS_VALUE.BUSY,
  AVAIL_STATUS_VALUE.EXPIRED,
  AVAIL_STATUS_VALUE.MANUALLY_DISABLED,
  AVAIL_STATUS_VALUE.AUTO_DISABLED,
  AVAIL_STATUS_VALUE.CANCELLED,
] as const;

export type AvailStatus = (typeof AVAIL_STATUS)[number];
