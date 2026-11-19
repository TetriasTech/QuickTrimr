import { toIntegerCents } from '@quicktrimr/shared';

import { formatAudCents } from '../src/presentation/money';

test.each([
  [0, 'A$0.00'],
  [1, 'A$0.01'],
  [99, 'A$0.99'],
  [4550, 'A$45.50'],
  [4625, 'A$46.25'],
  [123456789, 'A$1,234,567.89'],
  [-1, '-A$0.01'],
  [-4550, '-A$45.50'],
  [Number.MAX_SAFE_INTEGER, 'A$90,071,992,547,409.91'],
  [Number.MIN_SAFE_INTEGER, '-A$90,071,992,547,409.91'],
])(
  'formats integer cents %s without Intl BigInt support',
  (amount, expected) => {
    expect(formatAudCents(toIntegerCents(amount))).toBe(expected);
  },
);
test('rejects unsafe and fractional values even when a caller bypasses the type', () => {
  for (const amount of [NaN, Infinity, 45.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() =>
      formatAudCents(amount as ReturnType<typeof toIntegerCents>),
    ).toThrow(RangeError);
});
