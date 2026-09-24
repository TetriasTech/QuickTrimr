export const DISPUTE_STATUS = [
  'open',
  'under_review',
  'resolved_client_refund',
  'resolved_barber_paid',
  'resolved_partial_refund',
  'resolved_operational',
  'cancelled',
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUS)[number];
