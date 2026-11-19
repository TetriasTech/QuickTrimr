/** AUD input boundary: decimal text to exact whole cents, never a floating price. */
export function parseAudPrice(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents =
    BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

/** Editable text from cents, without dividing through a decimal number. */
export function audPriceText(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error('Expected whole nonnegative cents.');
  const digits = String(cents).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export function servicePriceFits(
  priceCents: number,
  bounds: { minPriceCents: number; maxPriceCents: number },
): boolean {
  return (
    Number.isSafeInteger(priceCents) &&
    priceCents >= bounds.minPriceCents &&
    priceCents <= bounds.maxPriceCents
  );
}
