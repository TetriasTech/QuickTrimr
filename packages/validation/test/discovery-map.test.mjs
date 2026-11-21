import assert from 'node:assert/strict';
import test from 'node:test';

import { API_FIXTURES } from '../src/fixtures.ts';
import {
  getDiscoveryFiltersResponseSchema,
  searchAvailableNowBarbersResponseSchema,
} from '../src/index.ts';

test('map policy is required public config, positive integer milliseconds with no fallback', () => {
  const input = structuredClone(API_FIXTURES['get-discovery-filters'].response);
  assert.deepEqual(getDiscoveryFiltersResponseSchema.parse(input).map, {
    refreshIntervalMs: 2000,
  });
  for (const value of [null, 0, -1, 1.5, 2_147_483_648, '2000']) {
    input.map = { refreshIntervalMs: value };
    assert.equal(
      getDiscoveryFiltersResponseSchema.safeParse(input).success,
      false,
    );
  }
  delete input.map;
  assert.equal(
    getDiscoveryFiltersResponseSchema.safeParse(input).success,
    false,
  );
});

test('public search accepts SAL representative points and rejects barber coordinates, exact distances and jitter', () => {
  const input = structuredClone(
    API_FIXTURES['search-available-now-barbers'].response,
  );
  assert.equal(
    searchAvailableNowBarbersResponseSchema.safeParse(input).success,
    true,
  );
  assert.ok(input.results.length > 0);
  for (const field of [
    'location',
    'currentLocation',
    'serviceAreaCentre',
    'distanceMeters',
    'jitter',
  ]) {
    const crafted = structuredClone(input);
    crafted.results[0][field] = { lat: -38, lng: 145 };
    assert.equal(
      searchAvailableNowBarbersResponseSchema.safeParse(crafted).success,
      false,
      field,
    );
  }
  const crafted = structuredClone(input);
  crafted.results[0].approximateArea.barberPoint = { lat: -38, lng: 145 };
  assert.equal(
    searchAvailableNowBarbersResponseSchema.safeParse(crafted).success,
    false,
  );
});
