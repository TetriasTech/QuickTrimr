import { AVAIL_STATUS } from './avail-status.ts';
import { BOOKING_STATUS } from './booking-status.ts';
import { BOOKING_TYPE } from './booking-type.ts';
import { DISPUTE_STATUS } from './dispute-status.ts';
import { EARNING_STATUS } from './earning-status.ts';
import { PAYMENT_STATUS } from './payment-status.ts';
import { PAYOUT_STATUS } from './payout-status.ts';
import { RELIABILITY_LEVEL } from './reliability-level.ts';
import { REQUEST_STATUS } from './request-status.ts';
import { USER_ROLE } from './user-role.ts';
import { VERIFICATION_STATUS } from './verification-status.ts';

export const SHARED_ENUMS = {
  'ENUM-USER-ROLE': USER_ROLE,
  'ENUM-VERIFICATION-STATUS': VERIFICATION_STATUS,
  'ENUM-BOOKING-TYPE': BOOKING_TYPE,
  'ENUM-BOOKING-STATUS': BOOKING_STATUS,
  'ENUM-REQUEST-STATUS': REQUEST_STATUS,
  'ENUM-PAYMENT-STATUS': PAYMENT_STATUS,
  'ENUM-EARNING-STATUS': EARNING_STATUS,
  'ENUM-PAYOUT-STATUS': PAYOUT_STATUS,
  'ENUM-AVAIL-STATUS': AVAIL_STATUS,
  'ENUM-DISPUTE-STATUS': DISPUTE_STATUS,
  'ENUM-RELIABILITY-LEVEL': RELIABILITY_LEVEL,
} as const;

export type SharedEnumId = keyof typeof SHARED_ENUMS;
