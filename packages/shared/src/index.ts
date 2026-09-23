export const QUICKTRIMR_PRODUCT = 'QuickTrimr' as const;

export type WorkspaceIdentity = {
  readonly product: typeof QUICKTRIMR_PRODUCT;
  readonly surface: 'mobile' | 'admin' | 'function';
};

export { AVAIL_STATUS } from './enums/avail-status.ts';
export type { AvailStatus } from './enums/avail-status.ts';
export { BOOKING_STATUS } from './enums/booking-status.ts';
export type { BookingStatus } from './enums/booking-status.ts';
export { BOOKING_TYPE } from './enums/booking-type.ts';
export type { BookingType } from './enums/booking-type.ts';
export { DISPUTE_STATUS } from './enums/dispute-status.ts';
export type { DisputeStatus } from './enums/dispute-status.ts';
export { EARNING_STATUS } from './enums/earning-status.ts';
export type { EarningStatus } from './enums/earning-status.ts';
export { PAYMENT_STATUS } from './enums/payment-status.ts';
export type { PaymentStatus } from './enums/payment-status.ts';
export { PAYOUT_STATUS } from './enums/payout-status.ts';
export type { PayoutStatus } from './enums/payout-status.ts';
export { RELIABILITY_LEVEL } from './enums/reliability-level.ts';
export type { ReliabilityLevel } from './enums/reliability-level.ts';
export { REQUEST_STATUS } from './enums/request-status.ts';
export type { RequestStatus } from './enums/request-status.ts';
export { SHARED_ENUMS } from './enums/registry.ts';
export type { SharedEnumId } from './enums/registry.ts';
export { USER_ROLE } from './enums/user-role.ts';
export type { UserRole } from './enums/user-role.ts';
export { VERIFICATION_STATUS } from './enums/verification-status.ts';
export type { VerificationStatus } from './enums/verification-status.ts';
export { toIntegerCents } from './integer-cents.ts';
export type { IntegerCents } from './integer-cents.ts';
export { assertPostgresEnumValuesMatch } from './postgres-enum-parity.ts';
