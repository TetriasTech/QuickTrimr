export const BOOKING_TYPE = ['available_now', 'scheduled'] as const;

export type BookingType = (typeof BOOKING_TYPE)[number];
