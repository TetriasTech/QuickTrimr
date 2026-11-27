// RULE-CANCEL-07. The client refund rounds up and the barber gets the remainder.
export function cancellationRefundCents(grossCents: number, refundPct: number) {
  if (
    !Number.isSafeInteger(grossCents) ||
    grossCents <= 0 ||
    !Number.isSafeInteger(refundPct) ||
    refundPct < 0 ||
    refundPct > 100
  )
    throw new Error('Invalid cancellation snapshot.');
  return Number((BigInt(grossCents) * BigInt(refundPct) + 99n) / 100n);
}

export function earningAllocation({
  grossCents,
  originalCommissionCents,
  refundedCents,
  retainedProcessingFeeCents,
  cancellation,
}: {
  grossCents: number;
  originalCommissionCents: number;
  refundedCents: number;
  retainedProcessingFeeCents: number | null;
  cancellation: boolean;
}) {
  if (
    !Number.isSafeInteger(grossCents) ||
    grossCents <= 0 ||
    [originalCommissionCents, refundedCents].some(
      (amount) =>
        !Number.isSafeInteger(amount) || amount < 0 || amount > grossCents,
    ) ||
    (retainedProcessingFeeCents !== null &&
      (!Number.isSafeInteger(retainedProcessingFeeCents) ||
        retainedProcessingFeeCents < 0))
  )
    throw new Error('Invalid earning amounts.');

  const remaining = grossCents - refundedCents;
  // RULE-PAY-11 uses the cumulative service refund; cancellations waive all
  // commission under RULE-CANCEL-07.
  const commissionCents = cancellation
    ? 0
    : Number(
        (BigInt(originalCommissionCents) * BigInt(remaining)) /
          BigInt(grossCents),
      );
  return {
    grossCents,
    refundedCents,
    commissionCents,
    barberNetCents: remaining - commissionCents,
    platformAfterProcessingCents:
      retainedProcessingFeeCents === null
        ? null
        : commissionCents - retainedProcessingFeeCents,
  };
}
