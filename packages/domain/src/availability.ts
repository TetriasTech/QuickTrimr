import type { ReliabilityLevel } from '@quicktrimr/shared';

// RULE-RELY-06. Epoch milliseconds are supplied by the server; never device time.
// The transactional SQL read policy is parity-tested against this pure policy.
export function bookingEligibility(
  level: ReliabilityLevel,
  cooldownUntil: number | null,
  serverNow: number,
) {
  if (
    !Number.isFinite(serverNow) ||
    (cooldownUntil !== null && !Number.isFinite(cooldownUntil))
  )
    throw new Error('Invalid server deadline');
  const suspended = level === 'suspended';
  return {
    availableNowAllowed:
      !suspended && (cooldownUntil === null || serverNow >= cooldownUntil),
    scheduledAllowed: !suspended,
    searchDemoted: level === 'restricted',
  };
}

// RULE-AVAIL-08. Bounds are read from CFG-AVAIL-SESSION-* by the caller.
export function availableNowBoundsFit(
  radiusKm: number,
  availableUntil: number,
  serverNow: number,
  config: { minRadiusKm: number; maxRadiusKm: number; maxHours: number },
) {
  return {
    radiusKm:
      Number.isFinite(radiusKm) &&
      radiusKm >= config.minRadiusKm &&
      radiusKm <= config.maxRadiusKm,
    availableUntil:
      Number.isFinite(availableUntil) &&
      availableUntil > serverNow &&
      availableUntil <= serverNow + config.maxHours * 60 * 60 * 1000,
  };
}
