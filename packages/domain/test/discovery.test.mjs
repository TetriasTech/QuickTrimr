import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareDiscoveryKeys,
  discoveryBounds,
  discoveryDistanceBand,
} from '../src/index.ts';
const config = {
  radiusKm: { min: 1, max: 50 },
  pageSize: { min: 1, max: 50, default: 20 },
  distanceBands: {
    upperMeters: [2000, 5000, 10000],
    labels: ['under-2km', '2-5km', '5-10km', '10km+'],
  },
};
test('approved search bounds include fractional/end boundaries and runtime config changes', () => {
  for (const radius of [1, 1.25, 50])
    assert.deepEqual(discoveryBounds(radius, undefined, config), {
      fields: {},
      limit: 20,
    });
  for (const radius of [0.999, 50.001, NaN, Infinity])
    assert.ok(discoveryBounds(radius, 1, config).fields.radiusKm);
  for (const limit of [0, 51, 1.5, NaN, Infinity])
    assert.ok(discoveryBounds(2, limit, config).fields.limit);
  for (const limit of [1, 20, 50])
    assert.deepEqual(discoveryBounds(2, limit, config).fields, {});
  assert.ok(
    discoveryBounds(4, 1, { ...config, radiusKm: { min: 1, max: 3 } }).fields
      .radiusKm,
  );
});
test('four distance bands have exact half-open boundaries', () => {
  for (const [distance, band] of [
    [0, 0],
    [1999.999, 0],
    [2000, 1],
    [2000.001, 1],
    [4999.999, 1],
    [5000, 2],
    [5000.001, 2],
    [9999.999, 2],
    [10000, 3],
    [10000.001, 3],
  ])
    assert.equal(
      discoveryDistanceBand(distance, config.distanceBands),
      config.distanceBands.labels[band],
    );
  for (const invalid of [-1, NaN, Infinity])
    assert.throws(() => discoveryDistanceBand(invalid, config.distanceBands));
});
test('restricted-last precedes distance, price, score, score count and deterministic ID', () => {
  const a = {
    demoted: false,
    distanceMeters: 1000,
    priceCents: 4500,
    rating: 4,
    ratingCount: 2,
    barberId: 'a',
  };
  for (const b of [
    { ...a, demoted: true, distanceMeters: 0 },
    { ...a, distanceMeters: 1001 },
    { ...a, priceCents: 4501 },
    { ...a, rating: 3 },
    { ...a, rating: null },
    { ...a, ratingCount: 1 },
    { ...a, barberId: 'b' },
  ]) {
    assert.ok(compareDiscoveryKeys(a, b) < 0);
    assert.ok(compareDiscoveryKeys(b, a) > 0);
  }
  assert.equal(compareDiscoveryKeys(a, a), 0);
});
