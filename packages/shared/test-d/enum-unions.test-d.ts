import {
  AVAIL_STATUS,
  BOOKING_STATUS,
  BOOKING_TYPE,
  DISPUTE_STATUS,
  EARNING_STATUS,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
  RELIABILITY_LEVEL,
  REQUEST_STATUS,
  USER_ROLE,
  VERIFICATION_STATUS,
} from '../src/index.ts';
import type {
  AvailStatus,
  BookingStatus,
  BookingType,
  DisputeStatus,
  EarningStatus,
  PaymentStatus,
  PayoutStatus,
  ReliabilityLevel,
  RequestStatus,
  UserRole,
  VerificationStatus,
} from '../src/index.ts';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

type Expect<Condition extends true> = Condition;

type UserRoleIsTupleUnion = Expect<Equal<UserRole, (typeof USER_ROLE)[number]>>;
type VerificationStatusIsTupleUnion = Expect<
  Equal<VerificationStatus, (typeof VERIFICATION_STATUS)[number]>
>;
type BookingTypeIsTupleUnion = Expect<Equal<BookingType, (typeof BOOKING_TYPE)[number]>>;
type BookingStatusIsTupleUnion = Expect<Equal<BookingStatus, (typeof BOOKING_STATUS)[number]>>;
type RequestStatusIsTupleUnion = Expect<Equal<RequestStatus, (typeof REQUEST_STATUS)[number]>>;
type PaymentStatusIsTupleUnion = Expect<Equal<PaymentStatus, (typeof PAYMENT_STATUS)[number]>>;
type EarningStatusIsTupleUnion = Expect<Equal<EarningStatus, (typeof EARNING_STATUS)[number]>>;
type PayoutStatusIsTupleUnion = Expect<Equal<PayoutStatus, (typeof PAYOUT_STATUS)[number]>>;
type AvailStatusIsTupleUnion = Expect<Equal<AvailStatus, (typeof AVAIL_STATUS)[number]>>;
type DisputeStatusIsTupleUnion = Expect<Equal<DisputeStatus, (typeof DISPUTE_STATUS)[number]>>;
type ReliabilityLevelIsTupleUnion = Expect<
  Equal<ReliabilityLevel, (typeof RELIABILITY_LEVEL)[number]>
>;
