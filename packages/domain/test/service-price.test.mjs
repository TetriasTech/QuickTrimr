import assert from 'node:assert/strict';
import test from 'node:test';

import {
  audPriceText,
  parseAudPrice,
  servicePriceFits,
} from '../src/service-price.ts';

test('AUD text converts to exact integer cents, including cent precision and safe-number boundaries', () => {
  for (const [text, expected] of [
    ['45', 4500],
    ['45.5', 4550],
    ['45.50', 4550],
    [' 045.50 ', 4550],
    ['0.01', 1],
    ['45.', 4500],
    ['0.00', 0],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ]) {
    assert.equal(parseAudPrice(text), expected);
    assert.ok(Number.isSafeInteger(parseAudPrice(text)));
    assert.equal(parseAudPrice(audPriceText(expected)), expected);
  }
  for (const text of [
    '',
    ' ',
    '45.501',
    '-45',
    '1e2',
    '$45',
    '45,50',
    'NaN',
    'Infinity',
    '90071992547409.92',
  ])
    assert.equal(parseAudPrice(text), null);
  for (const value of [-1, 1.5, Infinity, NaN])
    assert.throws(() => audPriceText(value));
});

test('RULE-SERVICE-05 Haircut bounds accept both exact boundaries and reject either adjacent cent', () => {
  const bounds = { minPriceCents: 2000, maxPriceCents: 15000 };
  for (const [price, fits] of [
    [1999, false],
    [2000, true],
    [2001, true],
    [4500, true],
    [14999, true],
    [15000, true],
    [15001, false],
    [4500.5, false],
  ])
    assert.equal(servicePriceFits(price, bounds), fits);
});
