import { BOOKING_TYPE_VALUE } from '@quicktrimr/shared';

import type { BookingType } from '@quicktrimr/shared';

// RULE-PAY-17. The input is the first confirmed failure, so retries retain
// the same deadline. SQL mirrors this in the locked payment transaction.
export function paymentRecoveryDeadline(
  kind: BookingType,
  failedAtMs: number,
  scheduledForMs: number | null,
  config: { available_now_minutes: number; scheduled_hours: number },
) {
  if (kind === BOOKING_TYPE_VALUE.AVAILABLE_NOW)
    return failedAtMs + config.available_now_minutes * 60_000;
  const end = failedAtMs + config.scheduled_hours * 3_600_000;
  return scheduledForMs === null ? end : Math.min(end, scheduledForMs);
}
