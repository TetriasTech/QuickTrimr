import { BOOKING_STATUS, QUICKTRIMR_PRODUCT } from '@quicktrimr/shared';
import type { BookingStatus, WorkspaceIdentity } from '@quicktrimr/shared';

export const functionWorkspaceIdentity: WorkspaceIdentity = {
  product: QUICKTRIMR_PRODUCT,
  surface: 'function',
};

export const functionBookingStatuses: readonly BookingStatus[] = BOOKING_STATUS;
