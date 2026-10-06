import assert from 'node:assert/strict';
import test from 'node:test';

import { toIntegerCents } from '../src/index.ts';

test('toIntegerCents explicitly converts safe integer values', () => {
  assert.equal(toIntegerCents(0), 0);
  assert.equal(toIntegerCents(4_500), 4_500);
  assert.equal(toIntegerCents(-1), -1);
});

test('toIntegerCents rejects values that are not safe integers', () => {
  for (const value of [
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(() => toIntegerCents(value), {
      name: 'RangeError',
      message: 'Integer cents must be a safe integer',
    });
  }
});
