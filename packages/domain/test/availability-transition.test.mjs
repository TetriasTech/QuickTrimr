import assert from 'node:assert/strict';
import test from 'node:test';

import { AVAIL_STATUS } from '@quicktrimr/shared';

import {
  availabilityTransition,
  availabilityWorkerHealth,
} from '../src/availability-transition.ts';

const active = { status: 'active', misses: 0, availableUntil: 1000 };
test('RULE-AVAIL-03: exact expiry boundary, never early; all terminal states resist stale events', () => {
  for (const now of [999, 1000, 1001])
    assert.equal(
      availabilityTransition(active, 'expired', now, 2).applied,
      now >= 1000,
    );
  for (const status of AVAIL_STATUS.filter((s) => s !== 'active'))
    for (const event of [
      'expired',
      'missed',
      'responded',
      'accepted',
      'manually_disabled',
      'check_misses',
    ])
      assert.deepEqual(
        availabilityTransition({ ...active, status }, event, 1001, 2),
        {
          status,
          misses: 0,
          reason: null,
          applied: false,
        },
      );
  assert.equal(
    availabilityTransition(
      { ...active, availableUntil: null },
      'expired',
      1001,
      2,
    ).applied,
    false,
  );
});
test('consecutive misses reset on response; config changes behavior without code changes', () => {
  let state = availabilityTransition(active, 'missed', 999, 2);
  assert.equal(state.status, 'active');
  assert.equal(state.misses, 1);
  state = availabilityTransition({ ...active, ...state }, 'responded', 999, 2);
  assert.equal(state.misses, 0);
  state = availabilityTransition({ ...active, ...state }, 'missed', 999, 2);
  assert.equal(state.status, 'active');
  const disabled = availabilityTransition(
    { ...active, ...state },
    'missed',
    999,
    2,
  );
  assert.equal(disabled.status, 'auto_disabled');
  assert.equal(disabled.reason, 'missed_requests');
  assert.equal(
    availabilityTransition({ ...active, misses: 2 }, 'check_misses', 999, 3)
      .applied,
    false,
  );
  assert.equal(
    availabilityTransition({ ...active, misses: 2 }, 'check_misses', 999, 2)
      .status,
    'auto_disabled',
  );
});
test('acceptance resets misses and makes busy; manual stop is distinct and terminal', () => {
  assert.deepEqual(
    availabilityTransition({ ...active, misses: 1 }, 'accepted', 999, 2),
    {
      applied: true,
      status: 'busy',
      misses: 0,
      reason: 'Available Now booking accepted.',
    },
  );
  const stopped = availabilityTransition(active, 'manually_disabled', 999, 2);
  assert.equal(stopped.status, 'manually_disabled');
  assert.equal(
    availabilityTransition({ ...active, ...stopped }, 'expired', 1001, 2)
      .applied,
    false,
  );
});
test('invalid config, server clock and miss count fail closed', () => {
  for (const threshold of [null, 0, -1, 1.5, NaN, Infinity])
    assert.throws(() =>
      availabilityTransition(active, 'missed', 999, threshold),
    );
  assert.throws(() => availabilityTransition(active, 'expired', NaN, 2));
  assert.throws(() =>
    availabilityTransition({ ...active, misses: -1 }, 'missed', 999, 2),
  );
});
test('approved worker health boundaries: strictly older/overdue, first failure and empty market', () => {
  const config = { staleHeartbeatSeconds: 120, overdueSeconds: 60 };
  assert.deepEqual(availabilityWorkerHealth(0, 60000, 0, 120000, config), {
    staleHeartbeat: false,
    overdue: false,
    failedRuns: 0,
    healthy: true,
  });
  assert.equal(
    availabilityWorkerHealth(0, null, 0, 120001, config).staleHeartbeat,
    true,
  );
  assert.equal(
    availabilityWorkerHealth(120000, 60000, 0, 120001, config).overdue,
    true,
  );
  assert.equal(
    availabilityWorkerHealth(120000, null, 1, 120000, config).healthy,
    false,
  );
  assert.equal(
    availabilityWorkerHealth(null, null, 0, 120000, config).healthy,
    false,
  );
});
