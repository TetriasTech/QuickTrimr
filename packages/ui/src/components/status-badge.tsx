import type { BookingStatus } from '@quicktrimr/shared';

import { Badge, type BadgeTone } from './badge';

export type BookingStatusPresentation = {
  label: string;
  tone: BadgeTone;
};

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
} as const satisfies Record<BookingStatus, BookingStatusPresentation>;

export const UNKNOWN_BOOKING_STATUS_PRESENTATION = {
  label: 'Unknown status',
  tone: 'neutral',
} as const satisfies BookingStatusPresentation;

export function getBookingStatusPresentation(status: string): BookingStatusPresentation {
  return (
    BOOKING_STATUS_PRESENTATION[status as BookingStatus] ??
    UNKNOWN_BOOKING_STATUS_PRESENTATION
  );
}

export interface StatusBadgeProps {
  status: string;
  testID?: string;
}

export function StatusBadge({ status, testID }: StatusBadgeProps) {
  const presentation = getBookingStatusPresentation(status);
  return <Badge label={presentation.label} tone={presentation.tone} testID={testID} />;
}
