export const LOCATION_SOURCE_VALUE = {
  GPS: 'gps',
  MANUAL: 'manual',
} as const;

export const LOCATION_SOURCE = [
  LOCATION_SOURCE_VALUE.GPS,
  LOCATION_SOURCE_VALUE.MANUAL,
] as const;

export type LocationSource = (typeof LOCATION_SOURCE)[number];
