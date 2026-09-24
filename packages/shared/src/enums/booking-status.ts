export const BOOKING_STATUS = [
  'requested',
  'expired',
  'declined',
  'accepted_pending_payment',
  'paid_confirmed',
  'on_the_way',
  'arrived',
  'completed_by_barber',
  'completed_by_client',
  'completion_prompt_sent',
  'completed',
  'cancelled',
  'disputed',
  'refunded',
  'admin_resolved',
] as const;

export type BookingStatus = (typeof BOOKING_STATUS)[number];
