export const BOOKING_TYPE_VALUE = {
  AVAILABLE_NOW: 'available_now',
  SCHEDULED: 'scheduled',
} as const;

export const BOOKING_TYPE = [
  BOOKING_TYPE_VALUE.AVAILABLE_NOW,
  BOOKING_TYPE_VALUE.SCHEDULED,
] as const;

export type BookingType = (typeof BOOKING_TYPE)[number];
