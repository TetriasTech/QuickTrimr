import { BOOKING_STATUS, QUICKTRIMR_PRODUCT } from '@quicktrimr/shared';
import type { BookingStatus, WorkspaceIdentity } from '@quicktrimr/shared';

export const mobileWorkspaceIdentity: WorkspaceIdentity = {
  product: QUICKTRIMR_PRODUCT,
  surface: 'mobile',
};

export const mobileBookingStatuses: readonly BookingStatus[] = BOOKING_STATUS;
