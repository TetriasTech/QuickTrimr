import type { IntegerCents } from '@quicktrimr/shared';

// Display conversion only: BigInt preserves every cent at safe-integer limits.
export function formatAudCents(amount: IntegerCents): string {
  if (!Number.isSafeInteger(amount))
    throw new RangeError('Money requires safe integer cents');
  const cents = BigInt(amount);
  const absolute = cents < 0n ? -cents : cents;
  // Hermes supports BigInt arithmetic but not Intl.NumberFormat(BigInt).
  const dollars = String(absolute / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0n ? '-' : ''}A$${dollars}.${String(absolute % 100n).padStart(2, '0')}`;
}
