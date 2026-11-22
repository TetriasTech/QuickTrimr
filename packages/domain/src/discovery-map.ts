// RULE-DISCOVERY-05/07. Only licensed public area points reach the map.
type PublicArea = {
  id: string;
  label: string;
  mapPoint: { lat: number; lng: number };
};
export type DiscoveryMapArea = {
  areaId: string;
  label: string;
  mapPoint: PublicArea['mapPoint'];
  loadedCount: number;
};
export function discoveryMapAreas(
  results: readonly { barberId: string; approximateArea: PublicArea }[],
): DiscoveryMapArea[] {
  const unique = new Map(results.map((r) => [r.barberId, r]));
  const areas = new Map<string, DiscoveryMapArea>();
  for (const { approximateArea: area } of unique.values()) {
    const existing = areas.get(area.id);
    if (existing) {
      if (
        existing.mapPoint.lat !== area.mapPoint.lat ||
        existing.mapPoint.lng !== area.mapPoint.lng
      )
        throw new Error('Inconsistent public area point');
      existing.loadedCount++;
    } else
      areas.set(area.id, {
        areaId: area.id,
        label: area.label,
        mapPoint: { lat: area.mapPoint.lat, lng: area.mapPoint.lng },
        loadedCount: 1,
      });
  }
  return [...areas.values()];
}
