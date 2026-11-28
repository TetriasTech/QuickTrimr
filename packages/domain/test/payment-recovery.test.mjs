import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  paymentRecoveryDeadline,
  requestDeadlineReached,
} from '../src/index.ts';

test('the configured recovery windows start at failure and end at the scheduled cutoff', () => {
  const at = Date.parse('2026-11-28T01:00:00Z');
  const config = { available_now_minutes: 5, scheduled_hours: 2 };
  const immediate = paymentRecoveryDeadline('available_now', at, null, config);
  const scheduled = paymentRecoveryDeadline(
    'scheduled',
    at,
    at + 10_800_000,
    config,
  );
  assert.equal(immediate, at + 300_000);
  assert.equal(scheduled, at + 7_200_000);
  assert.equal(
    paymentRecoveryDeadline('scheduled', at, at + 7_000, config),
    at + 7_000,
  );
  assert.equal(requestDeadlineReached(immediate, immediate - 1), false);
  assert.equal(requestDeadlineReached(immediate, immediate), true);
});
