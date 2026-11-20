// RULE-DISCOVERY-05/06. Pure policies; runtime bounds/bands come from config.
export type DiscoveryConfig = {
  radiusKm: { min: number; max: number };
  pageSize: { min: number; max: number; default: number };
  distanceBands: { upperMeters: number[]; labels: string[] };
};
export function discoveryBounds(
  radius: number,
  requestedLimit: number | undefined,
  config: DiscoveryConfig,
) {
  const limit = requestedLimit ?? config.pageSize.default;
  const fields: Record<string, string> = {};
  if (
    !Number.isFinite(radius) ||
    radius < config.radiusKm.min ||
    radius > config.radiusKm.max
  )
    fields.radiusKm = `Enter a radius between ${config.radiusKm.min} and ${config.radiusKm.max} km.`;
  if (
    !Number.isSafeInteger(limit) ||
    limit < config.pageSize.min ||
    limit > config.pageSize.max
  )
    fields.limit = `Enter a whole-number limit between ${config.pageSize.min} and ${config.pageSize.max}.`;
  return { fields, limit };
}
export function discoveryDistanceBand(
  distance: number,
  config: DiscoveryConfig['distanceBands'],
) {
  if (!Number.isFinite(distance) || distance < 0)
    throw new Error('Invalid distance');
  const index = config.upperMeters.findIndex((upper) => distance < upper);
  return config.labels[index < 0 ? config.upperMeters.length : index];
}
export type DiscoverySortKey = {
  demoted: boolean;
  distanceMeters: number;
  priceCents: number;
  rating: number | null;
  ratingCount: number;
  barberId: string;
};
export function compareDiscoveryKeys(a: DiscoverySortKey, b: DiscoverySortKey) {
  const numeric =
    Number(a.demoted) - Number(b.demoted) ||
    a.distanceMeters - b.distanceMeters ||
    a.priceCents - b.priceCents ||
    (b.rating ?? 0) - (a.rating ?? 0) ||
    b.ratingCount - a.ratingCount;
  return (
    numeric ||
    (a.barberId === b.barberId ? 0 : a.barberId < b.barberId ? -1 : 1)
  );
}
