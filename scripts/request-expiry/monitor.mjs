import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { availabilityWorkerHealth } from '../../packages/domain/src/index.ts';
import { queryLocal } from '../db/verify.mjs';

// This process runs independently of pg_cron. It uses only the fixed local
// database target and sends redacted health transitions to a local test receiver.
const [receiver, mode] = process.argv.slice(2);
assert.ok(
  typeof receiver === 'string' &&
    [undefined, '--once'].includes(mode) &&
    process.argv.length <= 4,
  'Usage: node scripts/request-expiry/monitor.mjs http://127.0.0.1:PORT [--once]',
);
const destination = new URL(receiver);
assert.ok(
  destination.protocol === 'http:' &&
    destination.hostname === '127.0.0.1' &&
    destination.port &&
    !destination.username &&
    !destination.password &&
    !destination.search &&
    !destination.hash &&
    destination.pathname === '/',
  'The alert receiver must be a plain loopback HTTP URL.',
);
const milliseconds = (seconds) => seconds * 1000;
const timestamp = (value) => (value === null ? null : Date.parse(value));
const asJson = (query) => JSON.parse(queryLocal(query));
const config = asJson('select private.booking_request_expiry_config()');
assert.ok(
  Number.isSafeInteger(config.healthCheckSeconds) &&
    config.healthCheckSeconds > 0,
  'Health check interval is invalid.',
);
let previousObservation;
let previousReasons = [];
do {
  let reasons, observation, failure;
  try {
    const snapshot = asJson('select private.booking_request_expiry_health()');
    observation = timestamp(snapshot.serverNow);
    failure = timestamp(snapshot.lastFailureAt);
    const recentFailure =
      failure !== null &&
      failure >
        (previousObservation ??
          observation - milliseconds(config.healthCheckSeconds));
    const heartbeats = [
      snapshot.primaryHeartbeat,
      snapshot.reconcileHeartbeat,
    ].map(timestamp);
    const oldestHeartbeat = heartbeats.includes(null)
      ? null
      : Math.min(...heartbeats);
    const health = availabilityWorkerHealth(
      oldestHeartbeat,
      timestamp(snapshot.oldestDueAt),
      recentFailure ? 1 : 0,
      observation,
      config,
    );
    reasons = [
      ...(health.staleHeartbeat ? ['stale_heartbeat'] : []),
      ...(health.overdue ? ['overdue_requests'] : []),
      ...(health.failedRuns ? ['failed_run'] : []),
    ];
  } catch {
    reasons = ['database_unreachable'];
  }
  const changed = reasons.join(',') !== previousReasons.join(',');
  const newFailure =
    reasons.includes('failed_run') && failure > previousObservation;
  if (changed || newFailure) {
    try {
      const result = await fetch(destination, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          worker: 'booking-request-expiry',
          status: reasons.length ? 'alert' : 'recovered',
          reasons,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(milliseconds(config.healthCheckSeconds)),
      });
      if (!result.ok) throw new Error('Notification rejected.');
      previousReasons = reasons;
    } catch {
      console.error('Request expiry health delivery failed.');
      if (mode === '--once') process.exitCode = 1;
      if (mode !== '--once')
        await delay(milliseconds(config.healthCheckSeconds));
      continue;
    }
  }
  previousObservation = observation ?? previousObservation;
  if (mode !== '--once') await delay(milliseconds(config.healthCheckSeconds));
} while (mode !== '--once');
