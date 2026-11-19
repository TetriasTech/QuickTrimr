import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bookingEligibility,
  availableNowBoundsFit,
} from '../src/availability.ts';
const levels = ['good_standing', 'watch', 'limited', 'restricted', 'suspended'];
test('RULE-RELY-06: every level, no cooldown and before/at/after deadline; Scheduled never blocked by cooldown', () => {
  for (const level of levels) {
    for (const delta of [-1, 0, 1]) {
      assert.deepEqual(bookingEligibility(level, 1000, 1000 + delta), {
        availableNowAllowed: level !== 'suspended' && delta >= 0,
        scheduledAllowed: level !== 'suspended',
        searchDemoted: level === 'restricted',
      });
    }
    assert.equal(
      bookingEligibility(level, null, 1000).availableNowAllowed,
      level !== 'suspended',
    );
  }
  assert.throws(() => bookingEligibility('watch', NaN, 1000));
  assert.throws(() => bookingEligibility('watch', null, NaN));
});
test('RULE-AVAIL-08: inclusive fractional radii, strict future and inclusive 12-hour boundary, configurable values', () => {
  const config = { minRadiusKm: 1, maxRadiusKm: 50, maxHours: 12 };
  const now = 1000000;
  for (const [radius, expected] of [
    [0.999, false],
    [1, true],
    [1.01, true],
    [49.999, true],
    [50, true],
    [50.001, false],
    [Infinity, false],
    [NaN, false],
  ])
    assert.equal(
      availableNowBoundsFit(radius, now + 1, now, config).radiusKm,
      expected,
    );
  for (const [delta, expected] of [
    [-1, false],
    [0, false],
    [1, true],
    [43200000, true],
    [43200001, false],
  ])
    assert.equal(
      availableNowBoundsFit(1, now + delta, now, config).availableUntil,
      expected,
    );
  assert.deepEqual(
    availableNowBoundsFit(60, now + 43200001, now, {
      minRadiusKm: 50,
      maxRadiusKm: 70,
      maxHours: 24,
    }),
    { radiusKm: true, availableUntil: true },
  );
});
