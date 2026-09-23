export const REQUEST_STATUS = [
  'pending',
  'accepted',
  'declined',
  'expired',
  'cancelled',
] as const;

export type RequestStatus = (typeof REQUEST_STATUS)[number];
