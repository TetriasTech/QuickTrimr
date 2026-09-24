export const REQUEST_STATUS_VALUE = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

export const REQUEST_STATUS = [
  REQUEST_STATUS_VALUE.PENDING,
  REQUEST_STATUS_VALUE.ACCEPTED,
  REQUEST_STATUS_VALUE.DECLINED,
  REQUEST_STATUS_VALUE.EXPIRED,
  REQUEST_STATUS_VALUE.CANCELLED,
] as const;

export type RequestStatus = (typeof REQUEST_STATUS)[number];
