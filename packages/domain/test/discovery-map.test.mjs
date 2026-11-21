import assert from 'node:assert/strict';
import test from 'node:test';

import { discoveryMapAreas } from '../src/index.ts';
const area = {
  id: 'sal:2021:qa',
  label: 'Synthetic area',
  mapPoint: { lat: -38, lng: 145 },
};
const row = (barberId, approximateArea = area) => ({
  barberId,
  approximateArea,
});
test('two barbers in one SAL produce one public cluster, with no barber IDs, coordinates or jitter', () => {
  assert.deepEqual(discoveryMapAreas([row('a'), row('b')]), [
    {
      areaId: area.id,
      label: area.label,
      mapPoint: area.mapPoint,
      loadedCount: 2,
    },
  ]);
  assert.deepEqual(discoveryMapAreas([]), []);
});
test('live cursor pages deduplicate IDs before grouping; a moved duplicate counts in its latest area only', () => {
  const other = {
    ...area,
    id: 'sal:2021:other',
    label: 'Other',
    mapPoint: { lat: -39, lng: 146 },
  };
  assert.deepEqual(
    discoveryMapAreas([row('a'), row('b'), row('a', other)]).map(
      ({ areaId, loadedCount }) => ({ areaId, loadedCount }),
    ),
    [
      { areaId: other.id, loadedCount: 1 },
      { areaId: area.id, loadedCount: 1 },
    ],
  );
});
test('a SAL with inconsistent points fails closed instead of averaging, jittering or choosing a barber-shaped point', () => {
  assert.throws(
    () =>
      discoveryMapAreas([
        row('a'),
        row('b', { ...area, mapPoint: { ...area.mapPoint, lat: -38.1 } }),
      ]),
    /Inconsistent public area point/,
  );
});
