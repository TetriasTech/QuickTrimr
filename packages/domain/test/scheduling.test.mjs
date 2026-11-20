import assert from 'node:assert/strict';
import test from 'node:test';

import {
  schedulingWindow,
  scheduledTimeIssue,
  scheduledLeadGuidance,
} from '../src/index.ts';
const now = Date.parse('2026-10-03T16:00:00Z'); // Australian DST weekend: elapsed days.
for (const config of [
  { minimumLeadMinutes: 240, maximumHorizonDays: 30 },
  { minimumLeadMinutes: 90, maximumHorizonDays: 2 },
])
  test(`inclusive server-derived scheduling boundaries ${JSON.stringify(config)}`, () => {
    const { minimum, maximum } = schedulingWindow(now, config);
    assert.equal(minimum - now, config.minimumLeadMinutes * 60000);
    assert.equal(maximum - now, config.maximumHorizonDays * 86400000);
    assert.ok(scheduledTimeIssue(minimum - 1, now, config));
    assert.equal(scheduledTimeIssue(minimum, now, config), null);
    assert.equal(scheduledTimeIssue(minimum + 1, now, config), null);
    assert.equal(scheduledTimeIssue(maximum - 1, now, config), null);
    assert.equal(scheduledTimeIssue(maximum, now, config), null);
    assert.ok(scheduledTimeIssue(maximum + 1, now, config));
    assert.ok(scheduledTimeIssue(now - 1, now, config));
    assert.ok(scheduledTimeIssue(NaN, now, config));
    assert.ok(
      scheduledTimeIssue(minimum, now + 1, config),
      'time ages into lead window',
    );
  });
test('guidance uses live configuration and requested time, without a calendar promise', () => {
  assert.equal(
    scheduledLeadGuidance({ minimumLeadMinutes: 240, maximumHorizonDays: 30 }),
    "Scheduled bookings need at least 4 hours' notice. Try Available Now for sooner.",
  );
  assert.match(
    scheduledLeadGuidance({ minimumLeadMinutes: 90, maximumHorizonDays: 2 }),
    /90 minutes/,
  );
});
