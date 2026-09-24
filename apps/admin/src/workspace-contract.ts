import { BOOKING_STATUS, QUICKTRIMR_PRODUCT } from '@quicktrimr/shared';
import type { BookingStatus, WorkspaceIdentity } from '@quicktrimr/shared';

export const adminWorkspaceIdentity: WorkspaceIdentity = {
  product: QUICKTRIMR_PRODUCT,
  surface: 'admin',
};

export const adminBookingStatuses: readonly BookingStatus[] = BOOKING_STATUS;
