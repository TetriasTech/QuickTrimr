import type { BookingType } from '@quicktrimr/shared';

export type RequestPolicy = {
  commissionPct: number;
  refundPct: Record<BookingType, number>;
  inconveniencePct: Record<BookingType, number>;
  lateCancellationHours: number;
  availableExpiryMinutes: number;
  scheduledExpiryHours: number;
};

// ADR-009, RULE-PAY-11, RULE-CANCEL-07. SQL mirrors this pure calculation
// inside the atomic write; live parity tests guard every field and rounding.
export function requestSnapshot(
  servicePriceCents: number,
  bookingType: BookingType,
  serverNow: number,
  policy: RequestPolicy,
) {
  const percentages = [
    policy.commissionPct,
    policy.refundPct[bookingType],
    policy.inconveniencePct[bookingType],
  ];
  if (
    !Number.isSafeInteger(servicePriceCents) ||
    servicePriceCents <= 0 ||
    percentages.some((p) => !Number.isSafeInteger(p) || p < 0 || p > 100) ||
    policy.refundPct[bookingType] + policy.inconveniencePct[bookingType] !==
      100 ||
    !Number.isFinite(serverNow) ||
    [
      policy.lateCancellationHours,
      policy.availableExpiryMinutes,
      policy.scheduledExpiryHours,
    ].some((n) => !Number.isSafeInteger(n) || n <= 0)
  )
    throw new Error('Invalid request policy');
  const commissionCents = Number(
    (BigInt(servicePriceCents) * BigInt(policy.commissionPct)) / 100n,
  );
  const expiresAt =
    serverNow +
    (bookingType === 'available_now'
      ? policy.availableExpiryMinutes * 60_000
      : policy.scheduledExpiryHours * 3_600_000);
  return {
    servicePriceCents,
    commissionPct: policy.commissionPct,
    grossCents: servicePriceCents,
    commissionCents,
    barberNetCents: servicePriceCents - commissionCents,
    cancellationRefundPct: policy.refundPct[bookingType],
    cancellationInconveniencePct: policy.inconveniencePct[bookingType],
    lateCancellationHours: policy.lateCancellationHours,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}
