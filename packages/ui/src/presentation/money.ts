import type { IntegerCents } from '@quicktrimr/shared';

const wholeDollars = new Intl.NumberFormat('en-AU', {
  maximumFractionDigits: 0,
});
// Display conversion only: BigInt preserves every cent at safe-integer limits.
export function formatAudCents(amount: IntegerCents): string {
  if (!Number.isSafeInteger(amount))
    throw new RangeError('Money requires safe integer cents');
  const cents = BigInt(amount);
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}A$${wholeDollars.format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`;
}
