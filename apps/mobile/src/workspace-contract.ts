import { DOMAIN_PACKAGE_NAME } from '@quicktrimr/domain';
import { BOOKING_STATUS, QUICKTRIMR_PRODUCT } from '@quicktrimr/shared';
import type { BookingStatus, WorkspaceIdentity } from '@quicktrimr/shared';
import { UI_PACKAGE_NAME } from '@quicktrimr/ui';
import { CONTRACTS } from '@quicktrimr/validation';

export const mobileWorkspaceIdentity: WorkspaceIdentity = {
  product: QUICKTRIMR_PRODUCT,
  surface: 'mobile',
};

export const mobileBookingStatuses: readonly BookingStatus[] = BOOKING_STATUS;

export const mobileWorkspacePackages = [
  '@quicktrimr/shared',
  DOMAIN_PACKAGE_NAME,
  '@quicktrimr/validation',
  UI_PACKAGE_NAME,
] as const;

export const mobileWorkspaceContractCount = Object.keys(CONTRACTS).length;
