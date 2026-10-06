import { DOMAIN_PACKAGE_NAME } from '@quicktrimr/domain';
import { BOOKING_STATUS, QUICKTRIMR_PRODUCT } from '@quicktrimr/shared';
import { UI_PACKAGE_NAME } from '@quicktrimr/ui/metadata';
import { nonEmptyStringSchema } from '@quicktrimr/validation';

import type { BookingStatus, WorkspaceIdentity } from '@quicktrimr/shared';

// Executed by the login server component: all four workspace imports pass through Next.
// Native UI components stay in Expo; P0-T17 owns the web component collection.
nonEmptyStringSchema.parse(DOMAIN_PACKAGE_NAME);
nonEmptyStringSchema.parse(UI_PACKAGE_NAME);

export const adminWorkspaceIdentity: WorkspaceIdentity = {
  product: QUICKTRIMR_PRODUCT,
  surface: 'admin',
};

export const adminBookingStatuses: readonly BookingStatus[] = BOOKING_STATUS;
