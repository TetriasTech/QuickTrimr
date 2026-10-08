import type {
  BookingStatus,
  DisputeStatus,
  EarningStatus,
  PaymentStatus,
  PayoutStatus,
} from '@quicktrimr/shared';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
// Retain the existing native BookingStatusPresentation public type shape.
export type StatusPresentation = { label: string; tone: BadgeTone };
export type BookingStatusPresentation = StatusPresentation;
// Shared native/web labels; presentation never decides permissions or transitions.
export const BOOKING_STATUS_PRESENTATION = {
  requested: { label: 'Requested', tone: 'info' },
  expired: { label: 'Expired', tone: 'neutral' },
  declined: { label: 'Declined', tone: 'danger' },
  accepted_pending_payment: { label: 'Payment pending', tone: 'warning' },
  paid_confirmed: { label: 'Confirmed', tone: 'success' },
  on_the_way: { label: 'On the way', tone: 'info' },
  arrived: { label: 'Arrived', tone: 'info' },
  completed_by_barber: { label: 'Completed by barber', tone: 'warning' },
  completed_by_client: { label: 'Completed by client', tone: 'warning' },
  completion_prompt_sent: { label: 'Completion pending', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  disputed: { label: 'Disputed', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  admin_resolved: { label: 'Resolved', tone: 'success' },
} as const satisfies Record<BookingStatus, StatusPresentation>;
const payment = {
  requires_authorisation: { label: 'Awaiting authorisation', tone: 'neutral' },
  authorised: { label: 'Authorised hold', tone: 'info' },
  authorisation_cancelled: { label: 'Hold cancelled', tone: 'neutral' },
  capture_pending: { label: 'Capture pending', tone: 'warning' },
  captured: { label: 'Captured', tone: 'success' },
  capture_failed: { label: 'Capture failed', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  partially_refunded: { label: 'Partially refunded', tone: 'warning' },
  disputed: { label: 'Disputed', tone: 'danger' },
} as const satisfies Record<PaymentStatus, StatusPresentation>;
const earning = {
  pending: { label: 'Pending', tone: 'warning' },
  available: { label: 'Available balance', tone: 'success' },
  queued_for_payout: { label: 'Queued for payout', tone: 'info' },
  paid_out: { label: 'Paid out', tone: 'success' },
  reversed: { label: 'Reversed', tone: 'neutral' },
} as const satisfies Record<EarningStatus, StatusPresentation>;
const payout = {
  draft: { label: 'Draft', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'info' },
  processing: { label: 'Processing', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
} as const satisfies Record<PayoutStatus, StatusPresentation>;
const dispute = {
  open: { label: 'Open', tone: 'danger' },
  under_review: { label: 'Under review', tone: 'warning' },
  resolved_client_refund: { label: 'Resolved: client refund', tone: 'neutral' },
  resolved_barber_paid: {
    label: 'Resolved: barber entitlement',
    tone: 'success',
  },
  resolved_partial_refund: {
    label: 'Resolved: partial refund',
    tone: 'neutral',
  },
  resolved_operational: { label: 'Resolved: operational', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
} as const satisfies Record<DisputeStatus, StatusPresentation>;
export const STATUS_PRESENTATION = {
  booking: BOOKING_STATUS_PRESENTATION,
  payment,
  earning,
  payout,
  dispute,
};
export type StatusKind = keyof typeof STATUS_PRESENTATION;
export const UNKNOWN_BOOKING_STATUS_PRESENTATION = {
  label: 'Unknown status',
  tone: 'neutral',
} as const satisfies StatusPresentation;
export function getStatusPresentation(
  kind: StatusKind,
  status: string,
): StatusPresentation {
  const map: Readonly<Record<string, StatusPresentation>> =
    STATUS_PRESENTATION[kind];
  return Object.hasOwn(map, status)
    ? map[status]!
    : UNKNOWN_BOOKING_STATUS_PRESENTATION;
}
export function getBookingStatusPresentation(
  status: string,
): BookingStatusPresentation {
  return getStatusPresentation('booking', status);
}
