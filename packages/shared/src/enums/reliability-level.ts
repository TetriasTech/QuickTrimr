export const RELIABILITY_LEVEL = [
  'good_standing',
  'watch',
  'limited',
  'restricted',
  'suspended',
] as const;

export type ReliabilityLevel = (typeof RELIABILITY_LEVEL)[number];
