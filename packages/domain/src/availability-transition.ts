import { AVAIL_STATUS_VALUE, type AvailStatus } from '@quicktrimr/shared';

// Internal events, not new product statuses. Durable request receipts deduplicate
// delivery before this pure policy is applied under the profile/session locks.
export type AvailabilityEvent =
  | 'expired'
  | 'missed'
  | 'responded'
  | 'accepted'
  | 'manually_disabled'
  | 'check_misses';

export function availabilityTransition(
  current: {
    status: AvailStatus;
    misses: number;
    availableUntil: number | null;
  },
  event: AvailabilityEvent,
  serverNow: number,
  missedRequestThreshold: number,
) {
  if (
    !Number.isFinite(serverNow) ||
    !Number.isSafeInteger(current.misses) ||
    current.misses < 0 ||
    !Number.isSafeInteger(missedRequestThreshold) ||
    missedRequestThreshold <= 0 ||
    (current.availableUntil !== null &&
      !Number.isFinite(current.availableUntil))
  )
    throw new Error('Invalid availability transition input');
  let status = current.status;
  let misses = current.misses;
  let reason: string | null = null;
  if (status === AVAIL_STATUS_VALUE.ACTIVE) {
    switch (event) {
      case 'expired':
        if (
          current.availableUntil !== null &&
          current.availableUntil <= serverNow
        ) {
          status = AVAIL_STATUS_VALUE.EXPIRED;
          reason = 'Available-until deadline reached.';
        }
        break;
      case 'missed':
      case 'check_misses':
        if (event === 'missed') misses += 1;
        if (!Number.isSafeInteger(misses))
          throw new Error('Invalid miss count');
        if (misses >= missedRequestThreshold) {
          status = AVAIL_STATUS_VALUE.AUTO_DISABLED;
          reason = 'missed_requests';
        } else if (event === 'missed') reason = 'Unanswered request expired.';
        break;
      case 'responded':
        misses = 0;
        reason = 'Barber responded to a request.';
        break;
      case 'accepted':
        misses = 0;
        status = AVAIL_STATUS_VALUE.BUSY;
        reason = 'Available Now booking accepted.';
        break;
      case 'manually_disabled':
        status = AVAIL_STATUS_VALUE.MANUALLY_DISABLED;
        reason = 'Barber manually stopped availability.';
        break;
      default:
        throw new Error('Invalid availability event');
    }
  }
  const applied = status !== current.status || misses !== current.misses;
  return { status, misses, reason: applied ? reason : null, applied };
}

export function availabilityWorkerHealth(
  lastSuccess: number | null,
  oldestDue: number | null,
  failedRuns: number,
  serverNow: number,
  config: { staleHeartbeatSeconds: number; overdueSeconds: number },
) {
  if (
    !Number.isFinite(serverNow) ||
    [lastSuccess, oldestDue].some(
      (value) => value !== null && !Number.isFinite(value),
    ) ||
    !Number.isSafeInteger(failedRuns) ||
    failedRuns < 0 ||
    !Number.isFinite(config.staleHeartbeatSeconds) ||
    config.staleHeartbeatSeconds <= 0 ||
    !Number.isFinite(config.overdueSeconds) ||
    config.overdueSeconds <= 0
  )
    throw new Error('Invalid worker health input');
  const staleHeartbeat =
    lastSuccess === null ||
    serverNow - lastSuccess > config.staleHeartbeatSeconds * 1000;
  const overdue =
    oldestDue !== null && serverNow - oldestDue > config.overdueSeconds * 1000;
  return {
    staleHeartbeat,
    overdue,
    failedRuns,
    healthy: !(staleHeartbeat || overdue || failedRuns > 0),
  };
}
