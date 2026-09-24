import {
  AVAIL_STATUS,
  BOOKING_STATUS,
  BOOKING_TYPE,
  DISPUTE_STATUS,
  EARNING_STATUS,
  LOCATION_SOURCE,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
  RELIABILITY_LEVEL,
  REQUEST_STATUS,
  USER_ROLE,
  VERIFICATION_STATUS,
  toIntegerCents,
} from '@quicktrimr/shared';
import { z } from 'zod';

export const postgresUuidSchema = z.uuid();
export type PostgresUuid = z.infer<typeof postgresUuidSchema>;

export const timestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof timestampSchema>;

export const latitudeSchema = z.number().finite().min(-90).max(90);
export const longitudeSchema = z.number().finite().min(-180).max(180);

export const geographicPointSchema = z.strictObject({
  lat: latitudeSchema,
  lng: longitudeSchema,
});
export type GeographicPoint = z.infer<typeof geographicPointSchema>;

export const integerCentsSchema = z
  .number()
  .int()
  .nonnegative()
  .transform(toIntegerCents);
export type IntegerCentsValue = z.infer<typeof integerCentsSchema>;

export const nonEmptyStringSchema = z.string().min(1);
export const nonNegativeIntegerSchema = z.number().int().nonnegative();
export const positiveNumberSchema = z.number().finite().positive();

export const userRoleSchema = z.enum(USER_ROLE);
export const verificationStatusSchema = z.enum(VERIFICATION_STATUS);
export const bookingTypeSchema = z.enum(BOOKING_TYPE);
export const bookingStatusSchema = z.enum(BOOKING_STATUS);
export const requestStatusSchema = z.enum(REQUEST_STATUS);
export const paymentStatusSchema = z.enum(PAYMENT_STATUS);
export const earningStatusSchema = z.enum(EARNING_STATUS);
export const payoutStatusSchema = z.enum(PAYOUT_STATUS);
export const availStatusSchema = z.enum(AVAIL_STATUS);
export const disputeStatusSchema = z.enum(DISPUTE_STATUS);
export const reliabilityLevelSchema = z.enum(RELIABILITY_LEVEL);
export const locationSourceSchema = z.enum(LOCATION_SOURCE);

export const SHARED_ENUM_SCHEMAS = {
  'ENUM-USER-ROLE': userRoleSchema,
  'ENUM-VERIFICATION-STATUS': verificationStatusSchema,
  'ENUM-BOOKING-TYPE': bookingTypeSchema,
  'ENUM-BOOKING-STATUS': bookingStatusSchema,
  'ENUM-REQUEST-STATUS': requestStatusSchema,
  'ENUM-PAYMENT-STATUS': paymentStatusSchema,
  'ENUM-EARNING-STATUS': earningStatusSchema,
  'ENUM-PAYOUT-STATUS': payoutStatusSchema,
  'ENUM-AVAIL-STATUS': availStatusSchema,
  'ENUM-DISPUTE-STATUS': disputeStatusSchema,
  'ENUM-RELIABILITY-LEVEL': reliabilityLevelSchema,
} as const;
