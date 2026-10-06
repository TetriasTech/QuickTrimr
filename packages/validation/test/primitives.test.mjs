import assert from 'node:assert/strict';
import test from 'node:test';

import { LOCATION_SOURCE, SHARED_ENUMS } from '@quicktrimr/shared';

import {
  SHARED_ENUM_SCHEMAS,
  geographicPointSchema,
  integerCentsSchema,
  locationSourceSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../src/index.ts';

test('Postgres UUIDs accept canonical values and reject malformed values', () => {
  assert.equal(
    postgresUuidSchema.safeParse('11111111-1111-4111-8111-111111111111')
      .success,
    true,
  );
  for (const invalid of [
    'not-a-uuid',
    '11111111-1111-1111-1111-111111111111',
    1,
  ]) {
    assert.equal(postgresUuidSchema.safeParse(invalid).success, false);
  }
});

test('timestamps require an ISO datetime with an explicit offset', () => {
  assert.equal(timestampSchema.safeParse('2026-08-05T04:11:22Z').success, true);
  assert.equal(
    timestampSchema.safeParse('2026-08-05T14:11:22+10:00').success,
    true,
  );
  for (const invalid of ['2026-08-05T04:11:22', '2026-08-05', 'tomorrow']) {
    assert.equal(timestampSchema.safeParse(invalid).success, false);
  }
});

test('geographic points enforce latitude and longitude boundaries', () => {
  for (const valid of [
    { lat: -90, lng: -180 },
    { lat: 0, lng: 0 },
    { lat: 90, lng: 180 },
  ]) {
    assert.equal(geographicPointSchema.safeParse(valid).success, true);
  }
  for (const invalid of [
    { lat: -90.0001, lng: 0 },
    { lat: 90.0001, lng: 0 },
    { lat: 0, lng: -180.0001 },
    { lat: 0, lng: 180.0001 },
  ]) {
    assert.equal(geographicPointSchema.safeParse(invalid).success, false);
  }
});

test('integer cents reject decimals and negatives', () => {
  assert.equal(integerCentsSchema.safeParse(0).success, true);
  assert.equal(integerCentsSchema.safeParse(4_500).success, true);
  for (const invalid of [45.5, -1, Number.POSITIVE_INFINITY]) {
    assert.equal(integerCentsSchema.safeParse(invalid).success, false);
  }
});

test('every status enum schema is driven by packages/shared', () => {
  assert.deepEqual(
    Object.keys(SHARED_ENUM_SCHEMAS).sort(),
    Object.keys(SHARED_ENUMS).sort(),
  );
  for (const [id, values] of Object.entries(SHARED_ENUMS)) {
    const schema = SHARED_ENUM_SCHEMAS[id];
    assert.deepEqual(schema.options, values, id);
    for (const value of values)
      assert.equal(schema.safeParse(value).success, true, `${id}: ${value}`);
    assert.equal(
      schema.safeParse('__outside_shared_enum__').success,
      false,
      id,
    );
  }
});

test('location source uses the shared RULE-AVAIL-02 values', () => {
  assert.deepEqual(locationSourceSchema.options, LOCATION_SOURCE);
  for (const value of LOCATION_SOURCE)
    assert.equal(locationSourceSchema.safeParse(value).success, true);
  assert.equal(locationSourceSchema.safeParse('satellite').success, false);
});
