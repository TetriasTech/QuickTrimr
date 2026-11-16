import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  completeClientProfileRequestSchema,
  INVALID_AU_MOBILE_MESSAGE,
} from '../src/index.ts';

test('domestic and international Australian mobiles normalize identically', () => {
  for (const mobile of [
    '0412345678',
    '0412 345 678',
    '+61 412 345 678',
    '(04) 1234-5678',
    '+61412345678',
  ]) {
    assert.deepEqual(
      completeClientProfileRequestSchema.parse({
        displayName: '  Sam Example  ',
        mobile,
      }),
      {
        displayName: 'Sam Example',
        mobile: '+61412345678',
      },
    );
  }
});

test('invalid length, landline, unsupported prefix and missing fields fail validation', () => {
  for (const mobile of [
    '041234567',
    '04123456789',
    '0212345678',
    '0512345678',
    '+610412345678',
    '+12025550100',
    '0412abc678',
  ]) {
    const parsed = completeClientProfileRequestSchema.safeParse({
      displayName: 'Sam Example',
      mobile,
    });
    assert.equal(parsed.success, false);
    assert.deepEqual(parsed.error.issues[0].path, ['mobile']);
    assert.equal(parsed.error.issues[0].message, INVALID_AU_MOBILE_MESSAGE);
  }
  assert.equal(
    completeClientProfileRequestSchema.safeParse({
      displayName: '   ',
      mobile: '0412345678',
    }).success,
    false,
  );
  assert.equal(
    completeClientProfileRequestSchema.safeParse({ displayName: 'Sam Example' })
      .success,
    false,
  );
});
