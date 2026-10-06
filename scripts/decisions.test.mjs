import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { RELIABILITY_LEVEL } from '../packages/shared/src/enums/reliability-level.ts';

const kb = await readFile(new URL('../QUICKTRIMR_KNOWLEDGE_BASE.md', import.meta.url), 'utf8');
const backlog = await readFile(new URL('../QUICKTRIMR_BACKLOG_README.md', import.meta.url), 'utf8');

function section(markdown, start, end) {
  const startAt = markdown.indexOf(start);
  assert.notEqual(startAt, -1, `Missing section: ${start}`);
  const endAt = markdown.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `Missing end marker: ${end}`);
  return markdown.slice(startAt, endAt);
}

const policy = section(kb, '- `RULE-PAY-11` —', '### Barber earnings and payouts');
const configRow = kb.split('\n').find((line) => line.startsWith('| `CFG-COMMISSION-PCT` |'));
assert.ok(configRow, 'Commission config must exist');
const commissionPct = BigInt(configRow.split('|')[2].trim());

// Test-only specification arithmetic. No app imports this file. Production domain functions
// and their validation/idempotency/integration tests belong to the later build tickets.
function serviceSplit(serviceCents, originalCommissionCents, cumulativeRefundCents) {
  const retainedCommission = originalCommissionCents * (serviceCents - cumulativeRefundCents) / serviceCents;
  return {
    retainedCommission,
    barberEntitlement: serviceCents - cumulativeRefundCents - retainedCommission,
  };
}

test('P0-D02 records the approved config, payer, rounding and dispute policy', () => {
  assert.equal(commissionPct, 20n);
  assert.match(configRow, /booked service price only/);
  assert.match(policy, /QuickTrimr absorbs Stripe payment-processing fees/);
  assert.match(policy, /no client card-processing surcharge/);
  assert.match(policy, /Round \*\*QuickTrimr's commission down\*\*/);
  assert.match(policy, /reverse commission proportionally/);
  assert.match(policy, /Original booking snapshots remain unchanged/);
  assert.match(policy, /barber paid\*\* keeps the normal snapshotted split/);
  assert.match(policy, /actual Stripe-reported retained processing fee/);
});

test('P0-D02 resolves both TBCs in place and removes its pending rule', () => {
  for (const id of ['TBC-COMMISSION-PCT', 'TBC-STRIPE-FEES']) {
    const rows = kb.split('\n').filter((line) => line.startsWith(`| \`${id}\` |`));
    assert.equal(rows.length, 1, id);
    assert.match(rows[0], /RESOLVED → `RULE-PAY-11`/);
  }
  const pending = section(kb, '### Pending rules', '## 10.');
  assert.doesNotMatch(pending, /RULE-PAY-11/);
});

const examples = policy.split('\n').filter((line) => /^\| \d+\./.test(line));
test('P0-D02 retains all six worked examples', () => {
  assert.equal(examples.length, 6);
});

for (const row of examples) {
  const [label, ...cells] = row.split('|').slice(1, -1).map((cell) => cell.trim());
  test(`P0-D02 reconciles ${label}`, () => {
    assert.equal(cells.length, 6);
    for (const cell of cells) assert.match(cell, /^-?\d+$/, 'Money must be integer cents');
    const [captured, refund, commission, barber, fee, platform] = cells.map(BigInt);
    assert.ok(captured > 0n && refund >= 0n && refund <= captured && fee >= 0n);
    const originalCommission = captured * commissionPct / 100n;
    const expected = serviceSplit(captured, originalCommission, refund);
    assert.equal(commission, expected.retainedCommission);
    assert.equal(barber, expected.barberEntitlement);
    assert.equal(platform, commission - fee);
    assert.equal(refund + barber + platform + fee, captured);
    if (refund === captured) {
      assert.equal(barber, 0n);
      assert.equal(commission, 0n);
      assert.equal(platform, -fee);
    }
  });
}

test('P0-D02 cumulative rounding uses original commission, not per-refund rounded reversals', () => {
  const snapshot = Object.freeze({ serviceCents: 4503n, commissionCents: 900n });
  const first = serviceSplit(snapshot.serviceCents, snapshot.commissionCents, 1n);
  const second = serviceSplit(snapshot.serviceCents, snapshot.commissionCents, 2n);
  assert.deepEqual(first, { retainedCommission: 899n, barberEntitlement: 3603n });
  assert.deepEqual(second, { retainedCommission: 899n, barberEntitlement: 3602n });
  // One refund of 2 cents or two 1-cent refunds has the same cumulative result.
  const firstReversal = snapshot.commissionCents - first.retainedCommission;
  const secondReversal = first.retainedCommission - second.retainedCommission;
  assert.equal(firstReversal + secondReversal, snapshot.commissionCents - second.retainedCommission);
  const full = serviceSplit(snapshot.serviceCents, snapshot.commissionCents, snapshot.serviceCents);
  assert.deepEqual(full, { retainedCommission: 0n, barberEntitlement: 0n });
});

test('P0-D02 does not decide cancellation split or inconvenience payment', () => {
  assert.match(policy, /does \*\*not\*\* choose that policy/);
  assert.match(policy, /not profit/);
  assert.match(policy, /late-cancellation refund percentage, inconvenience payment.*`P0-D03`/);
  const decision = section(backlog, '#### P0-D02 —', '#### P0-D03 —');
  assert.match(decision, /\*\*Out of scope\*\*.*cancellation split, which is `P0-D03`/);
  // Do not freeze other decisions as unresolved: P0-D03/D04/D05 must be able to close later.
});

test('P5-T07 partial-service-refund example follows the approved commission reversal', () => {
  const ticket = section(backlog, '#### P5-T07 —', '#### P5-T08 —');
  const response = ticket.match(/\/\/ 200\s*(\{[\s\S]*?\})/);
  assert.ok(response, 'Admin resolution success example must exist');
  const example = JSON.parse(response[1]);
  const captured = BigInt(example.capturedCents);
  const refund = BigInt(example.refundCents);
  const expected = serviceSplit(captured, captured * commissionPct / 100n, refund);
  assert.equal(BigInt(example.platformRetainedCents), expected.retainedCommission);
  assert.equal(BigInt(example.barberNetCents), expected.barberEntitlement);
  assert.match(ticket, /platformRetainedCents` is commission \*\*before processing fees\*\*/);
});

const cancellationPolicy = section(kb, '- `RULE-CANCEL-07` —', '### Barber reliability');
function configValue(id) {
  const row = kb.split('\n').find((line) => line.startsWith(`| \`${id}\` |`));
  assert.ok(row, `Missing config: ${id}`);
  return row.split('|')[2].replaceAll('`', '').trim();
}
function percentages(id) {
  return Object.fromEntries(configValue(id).split(';').map((entry) => {
    const [bookingType, value] = entry.trim().split(':').map((part) => part.trim());
    return [bookingType, BigInt(value)];
  }));
}
const refundPercentages = percentages('CFG-CANCEL-REFUND-PCT');
const inconveniencePercentages = percentages('CFG-INCONVENIENCE-FEE');
const lateWindowMs = BigInt(configValue('CFG-LATE-CANCEL-WINDOW-HOURS')) * 60n * 60n * 1000n;

// Documentation arithmetic only, assuming an otherwise eligible cancellation. Actual status,
// capture/refund state, authorization and release gates must be tested by downstream tickets.
function cancellationRefundPct(bookingType, remainingMs, actor = 'client') {
  if (actor === 'barber' || (bookingType === 'scheduled' && remainingMs > lateWindowMs)) return 100n;
  assert.ok(bookingType in refundPercentages);
  return refundPercentages[bookingType];
}
function cancellationSplit(captured, refundPct) {
  const refund = (captured * refundPct + 99n) / 100n;
  return { refund, barber: captured - refund, commission: 0n };
}

test('P0-D03 config records complementary booking-type percentages and client-up rounding', () => {
  assert.deepEqual(refundPercentages, { scheduled: 75n, available_now: 50n });
  assert.deepEqual(inconveniencePercentages, { scheduled: 25n, available_now: 50n });
  for (const type of Object.keys(refundPercentages)) {
    assert.equal(refundPercentages[type] + inconveniencePercentages[type], 100n);
  }
  assert.match(cancellationPolicy, /client refund up/);
  assert.match(cancellationPolicy, /all withheld service money/);
  assert.match(cancellationPolicy, /QuickTrimr keeps zero cancellation commission/);
  assert.match(cancellationPolicy, /fully reverse the original commission/);
  assert.match(cancellationPolicy, /normal service\/dispute refunds, not this cancellation allocation/);
});

test('P0-D03 resolves both TBCs in place and removes the pending cancellation rule', () => {
  for (const id of ['TBC-CANCEL-SPLIT', 'TBC-INCONVENIENCE-FEE']) {
    const rows = kb.split('\n').filter((line) => line.startsWith(`| \`${id}\` |`));
    assert.equal(rows.length, 1, id);
    assert.match(rows[0], /RESOLVED → `RULE-CANCEL-07`/);
  }
  assert.doesNotMatch(section(kb, '### Pending rules', '## 10.'), /RULE-CANCEL-07/);
});

const cancellationExamples = cancellationPolicy.split('\n').filter((line) => /^\| \d+\./.test(line));
const cancellationCases = [
  { label: /before acceptance/, refundPct: 100n },
  { label: /more than 12 hours/, refundPct: cancellationRefundPct('scheduled', lateWindowMs + 1n) },
  { label: /at or within 12 hours/, refundPct: cancellationRefundPct('scheduled', lateWindowMs) },
  { label: /Available Now after acceptance/, refundPct: cancellationRefundPct('available_now', 0n) },
  { label: /Barber cancels/, refundPct: cancellationRefundPct('scheduled', lateWindowMs, 'barber') },
  { label: /late Scheduled, \$45.03/, refundPct: cancellationRefundPct('scheduled', lateWindowMs - 1n) },
  { label: /Available Now, \$45.03/, refundPct: cancellationRefundPct('available_now', 0n) },
];
test('P0-D03 retains all seven cancellation examples', () => {
  assert.equal(cancellationExamples.length, cancellationCases.length);
});
for (const [index, row] of cancellationExamples.entries()) {
  const [label, ...cells] = row.split('|').slice(1, -1).map((cell) => cell.trim());
  test(`P0-D03 reconciles ${label}`, () => {
    assert.match(label, cancellationCases[index].label);
    assert.equal(cells.length, 6);
    for (const cell of cells) assert.match(cell, /^-?\d+$/, 'Money must be integer cents');
    const [captured, refund, barber, commission, fee, platform] = cells.map(BigInt);
    assert.ok(captured >= 0n && fee >= 0n);
    assert.deepEqual({ refund, barber, commission }, cancellationSplit(captured, cancellationCases[index].refundPct));
    assert.equal(platform, -fee);
    assert.equal(refund + barber + platform + fee, captured);
    if (index === 0) assert.deepEqual(cells.map(BigInt), [0n, 0n, 0n, 0n, 0n, 0n]);
  });
}

test('P0-D03 exact Scheduled boundary is late; one millisecond outside is free', () => {
  assert.equal(lateWindowMs, 43_200_000n);
  assert.match(cancellationPolicy, /\*\*more than\*\*/);
  assert.match(cancellationPolicy, /\*\*at or within\*\*/);
  assert.equal(cancellationRefundPct('scheduled', lateWindowMs + 1n), 100n);
  assert.equal(cancellationRefundPct('scheduled', lateWindowMs), 75n);
  assert.equal(cancellationRefundPct('scheduled', lateWindowMs - 1n), 75n);
  assert.equal(cancellationRefundPct('available_now', lateWindowMs + 1n), 50n);
  assert.equal(cancellationRefundPct('available_now', 0n, 'barber'), 100n);
});

test('P0-D03 earning exception preserves refund-success, dispute and no-fake-completion gates', async () => {
  const earningsPolicy = section(kb, '- `RULE-EARN-02`', '- `RULE-EARN-03`');
  assert.match(earningsPolicy, /cancellation and its refund have succeeded, with no open dispute/);
  assert.match(earningsPolicy, /cancelled booking is never marked completed/);
  assert.match(cancellationPolicy, /pending or failed refund does not release it/);
  assert.match(cancellationPolicy, /full refund reverses the earning/);
  for (const path of ['QUICKTRIMR_TICKET_PROMPT.md', 'QUICKTRIMR_AUDIT_PROMPT.md']) {
    const prompt = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(prompt, /RULE-CANCEL-07.*cancellation\/refund-success exception/);
    assert.doesNotMatch(prompt, /earning becomes `available` only on completion/);
  }
  const queue = section(backlog, '#### P3-T10 —', '#### P3-T11 —');
  assert.match(queue, /even though its booking is cancelled/);
  assert.match(queue, /pending\/failed/);
  assert.match(queue, /no open dispute/);
});

test('P0-D03 snapshots terms and does not decide payout cadence or legal compliance', () => {
  assert.match(cancellationPolicy, /Snapshot the cancellation terms.*at request time/);
  assert.match(cancellationPolicy, /Original snapshots remain unchanged/);
  assert.match(cancellationPolicy, /does not decide payout cadence/);
  assert.match(cancellationPolicy, /legal review.*before launch/);
  const creation = section(backlog, '#### P2-T08 —', '#### P2-T09 —');
  assert.match(creation, /Snapshot the booking-type-specific cancellation terms/);
  assert.match(creation, /client-supplied policy values/);
});

test('P3-T07 contract examples match both approved splits and full barber-cancellation refund', () => {
  const ticket = section(backlog, '#### P3-T07 —', '#### P3-T08 —');
  const examples = [...ticket.matchAll(/\/\/ 200 — [^\n]+\n(\{[\s\S]*?\})/g)].map((match) => JSON.parse(match[1]));
  assert.equal(examples.length, 4);
  for (const [index, pct] of [50n, 75n, 100n].entries()) {
    const example = examples[index];
    const expected = cancellationSplit(BigInt(example.capturedCents), pct);
    assert.equal(BigInt(example.refundCents), expected.refund);
    assert.equal(BigInt(example.barberInconvenienceCents), expected.barber);
    assert.equal(BigInt(example.platformRetainedCents), expected.commission);
    assert.equal(example.status, 'cancelled');
  }
  assert.equal(examples[3].refundCents, 0);
  assert.equal(examples[3].authorisationCancelled, true);
});

const reliabilityPolicy = section(kb, '- `RULE-RELY-06` —', '### ETA and location');
const reliabilityWindowMs = Number(configValue('CFG-RELIABILITY-WINDOW-DAYS')) * 86_400_000;
const reliabilityResetMs = Number(configValue('CFG-RELIABILITY-RESET-DAYS')) * 86_400_000;
const reliabilityCooldownMs = Number(configValue('CFG-RELIABILITY-COOLDOWN-MIN')) * 60_000;
const reliabilityThresholds = Object.fromEntries(
  configValue('CFG-RELIABILITY-THRESHOLDS').split(';').map((entry) => {
    const [level, count] = entry.trim().split(':').map((part) => part.trim());
    return [level, Number(count)];
  }),
);

// Test-only specification oracle for the approved UTC example and boundary arithmetic.
// Inputs are already established, non-excused offence facts, not raw client claims.
// This proves no production authorization, persistence, event deduplication or timer behavior.
function reliabilityExampleState(occurredTimes, now) {
  const occurrences = occurredTimes.filter((at) => at <= now).sort((a, b) => a - b);
  const count = occurrences.filter((at) => at > now - reliabilityWindowMs).length;
  const level = count >= reliabilityThresholds.restricted ? 'restricted'
    : count >= reliabilityThresholds.limited ? 'limited'
    : count >= reliabilityThresholds.watch ? 'watch' : 'good_standing';
  const triggers = occurrences.filter((at) =>
    occurrences.filter((prior) => prior <= at && prior > at - reliabilityWindowMs).length
      >= reliabilityThresholds.limited);
  const cooldownUntil = triggers.length === 0 ? null : triggers.at(-1) + reliabilityCooldownMs;
  return { count, level, cooldownUntil, cooldownActive: cooldownUntil !== null && now < cooldownUntil };
}

test('P0-D04 records approved config and an effect for every shared reliability level', () => {
  assert.equal(reliabilityWindowMs, 30 * 86_400_000);
  assert.equal(reliabilityResetMs, reliabilityWindowMs);
  assert.equal(reliabilityCooldownMs, 60 * 60_000);
  assert.deepEqual(reliabilityThresholds, { watch: 1, limited: 2, restricted: 3, suspension_review: 4 });
  assert.equal(configValue('CFG-RELIABILITY-SEARCH-PENALTY'), 'after_non_restricted');
  for (const level of RELIABILITY_LEVEL) {
    const rows = reliabilityPolicy.split('\n').filter((line) => line.startsWith(`| \`${level}\` |`));
    assert.equal(rows.length, 1, `${level} needs one threshold/effect row`);
    assert.equal(rows[0].split('|').slice(1, -1).filter((cell) => cell.trim()).length, 3);
  }
});

test('P0-D04 resolves its TBC in place and removes both reserved markers', () => {
  const rows = kb.split('\n').filter((line) => line.startsWith('| `TBC-RELIABILITY-THRESHOLDS` |'));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /RESOLVED → `RULE-RELY-06`/);
  assert.doesNotMatch(section(kb, '### Pending rules', '## 10.'), /RULE-RELY-06/);
  assert.doesNotMatch(kb, /`RULE-RELY-06` \*\(reserved/);
});

const reliabilityExamples = reliabilityPolicy.split('\n').filter((line) => /^\| 2026-/.test(line));
const offenceTimes = reliabilityExamples.filter((line) => /late cancellation/.test(line))
  .map((line) => Date.parse(line.split('|')[1].trim()));
test('P0-D04 retains the eight-row recovery example with three late cancellations', () => {
  assert.equal(reliabilityExamples.length, 8);
  assert.equal(offenceTimes.length, 3);
  assert.deepEqual(offenceTimes.map((at) => new Date(at).toISOString()), [
    '2026-10-01T10:00:00.000Z', '2026-10-05T10:00:00.000Z', '2026-10-10T10:00:00.000Z',
  ]);
  assert.match(reliabilityExamples.at(-1), /2026-11-09T10:00:00Z.*good_standing/);
});
for (const row of reliabilityExamples) {
  const [timestamp, event, count, level, active] = row.split('|').slice(1, -1).map((cell) => cell.trim());
  test(`P0-D04 UTC example ${timestamp}: ${event}`, () => {
    const state = reliabilityExampleState(offenceTimes, Date.parse(timestamp));
    assert.equal(state.count, Number(count));
    assert.equal(state.level, level.replaceAll('`', ''));
    assert.equal(state.cooldownActive, active === 'yes');
    assert.ok(['yes', 'no'].includes(active));
  });
}

test('P0-D04 window expires at exactly 30 elapsed days and excludes future events', () => {
  const at = offenceTimes[0];
  assert.match(reliabilityPolicy, /now - window < occurredAt <= now/);
  assert.equal(reliabilityExampleState([at], at - 1).count, 0);
  assert.equal(reliabilityExampleState([at], at).count, 1);
  assert.equal(reliabilityExampleState([at], at + reliabilityWindowMs - 1).level, 'watch');
  assert.equal(reliabilityExampleState([at], at + reliabilityWindowMs).level, 'good_standing');
  assert.equal(reliabilityExampleState([at], at + reliabilityWindowMs + 1).level, 'good_standing');
});

test('P0-D04 cooldown starts on second offence, ends exactly at deadline and restarts on a new offence', () => {
  const [first, second, third] = offenceTimes;
  assert.equal(reliabilityExampleState(offenceTimes, first).cooldownUntil, null);
  const deadline = second + reliabilityCooldownMs;
  assert.equal(reliabilityExampleState(offenceTimes, second).cooldownUntil, deadline);
  assert.equal(reliabilityExampleState(offenceTimes, deadline - 1).cooldownActive, true);
  assert.equal(reliabilityExampleState(offenceTimes, deadline).cooldownActive, false);
  assert.equal(reliabilityExampleState(offenceTimes, deadline + 1).cooldownActive, false);
  assert.equal(reliabilityExampleState(offenceTimes, third).cooldownUntil, third + reliabilityCooldownMs);
  // Re-evaluating the same facts later does not move their deadline.
  assert.equal(reliabilityExampleState(offenceTimes, third + 1).cooldownUntil, third + reliabilityCooldownMs);
  assert.match(reliabilityPolicy, /Duplicate delivery, login and recovery passes never restart it/);
});

test('P0-D04 fourth and later offences remain automatically restricted, never suspended', () => {
  const fourth = Date.parse('2026-10-11T10:00:00Z');
  for (const count of [reliabilityThresholds.suspension_review, reliabilityThresholds.suspension_review + 1]) {
    const times = Array.from({ length: count }, (_, index) => fourth - index * 86_400_000);
    assert.equal(reliabilityExampleState(times, fourth).count, count);
    assert.equal(reliabilityExampleState(times, fourth).level, 'restricted');
  }
  assert.match(reliabilityPolicy, /automatic calculation never returns `suspended`/);
  assert.match(reliabilityPolicy, /approved suspension persists until human reinstatement/);
  assert.match(reliabilityPolicy, /automatic recovery pass cannot override it even when all offences age out/);
  const engine = section(backlog, '#### P3-T12 —', '## Phase 4');
  assert.match(engine, /no pass may reinstate an admin-suspended barber/);
});

test('P0-D04 aging to watch does not erase or extend an already-triggered cooldown', () => {
  const second = offenceTimes[1];
  const times = [second - reliabilityWindowMs + reliabilityCooldownMs / 2, second];
  const aged = reliabilityExampleState(times, second + reliabilityCooldownMs / 2);
  assert.equal(aged.level, 'watch');
  assert.equal(aged.cooldownUntil, second + reliabilityCooldownMs);
  assert.equal(aged.cooldownActive, true);
  assert.equal(reliabilityExampleState(times, second + reliabilityCooldownMs).cooldownActive, false);
  assert.match(reliabilityPolicy, /previously triggered cooldown keeps its deadline when the count ages down/);
});

test('P0-D04 offence scope excludes missed and declined requests without changing auto-disable', () => {
  assert.equal(configValue('CFG-MISSED-REQUEST-THRESHOLD'), '2');
  assert.match(reliabilityPolicy, /one event per booking.*`RULE-CANCEL-04`/);
  assert.match(reliabilityPolicy, /at or within its snapshotted late-cancellation window/);
  assert.match(reliabilityPolicy, /Count neither declined nor missed requests, client cancellations, nor Scheduled cancellations outside that window/);
  assert.match(reliabilityPolicy, /No-shows and disputed fault require investigation/);
  const autoDisable = section(backlog, '#### P2-T03 —', '#### P2-T04 —');
  assert.match(autoDisable, /never count as reliability offences/);
  assert.match(autoDisable, /counter that \*\*resets on a response\*\*/);
});

test('P0-D04 restricted means demotion across both search types, not blanket exclusion', () => {
  assert.match(reliabilityPolicy, /after non-restricted barbers/);
  assert.match(reliabilityPolicy, /in both booking types, before the normal deterministic ordering/);
  const search = section(backlog, '#### P2-T04 —', '#### P2-T05 —');
  assert.match(search, /demotion, not exclusion/);
  assert.match(search, /before pagination/);
  assert.match(search, /cooldown excludes Available Now only/);
  assert.doesNotMatch(search, /or are reliability-restricted/);
});

test('P0-D04 server-side entry points and visible standing are in downstream scope', () => {
  for (const [id, next] of [['P2-T01', 'P2-T02'], ['P2-T08', 'P2-T09'], ['P2-T12', 'P2-T13']]) {
    const ticket = section(backlog, `#### ${id} —`, `#### ${next} —`);
    assert.match(ticket, /RULE-RELY-06/);
    assert.match(ticket, /barber_unavailable/);
    assert.match(ticket, /server-owned/);
  }
  const acceptance = section(backlog, '#### P2-T12 —', '#### P2-T13 —');
  assert.match(acceptance, /checked atomically with acceptance/);
  const toggle = section(backlog, '#### P2-T02 —', '#### P2-T03 —');
  assert.match(toggle, /standing and recovery remain visible outside a cancellation flow/);
});

test('P0-D04 keeps correction history, existing bookings and earnings intact', () => {
  assert.match(reliabilityPolicy, /do not edit\/delete original events/);
  assert.match(reliabilityPolicy, /no completed-job minimum/);
  assert.match(reliabilityPolicy, /Existing bookings are not automatically cancelled/);
  assert.match(reliabilityPolicy, /Reliability penalties do not confiscate earnings or change refund\/payout rules/);
  const admin = section(backlog, '#### P5-T13 —', '## Phase 6');
  assert.match(admin, /correction must refer to its original event/);
  assert.match(admin, /configured current offence threshold plus explicit admin approval/);
});

const payoutPolicy = section(kb, '- `RULE-EARN-04` —', '### Cancellations');
const payoutSchedule = JSON.parse(configValue('CFG-PAYOUT-SCHEDULE'));
const payoutMinimum = BigInt(configValue('CFG-PAYOUT-MIN-CENTS'));
const payoutDecision = section(backlog, '#### P0-D05 —', '#### P0-D06 —');
const payoutQueue = section(backlog, '#### P3-T10 —', '#### P3-T11 —');
const payoutProcessor = section(backlog, '#### P3-T11 —', '#### P3-T12 —');
const payoutScreen = section(backlog, '#### P3-T05 —', '#### P3-T06 —');
const payoutAdmin = section(backlog, '#### P5-T10 —', '#### P5-T11 —');

test('P0-D05 records the approved schedule, positive minimum and human approval', () => {
  assert.deepEqual(payoutSchedule, {
    frequency: 'weekly', weekday: 'Monday', time: '10:00', timezone: 'Australia/Sydney',
  });
  assert.equal(payoutMinimum, 1n);
  assert.match(payoutPolicy, /Andrew confirmed Option A for `P0-D05` on 2026-10-02/);
  assert.match(payoutPolicy, /One global batch per scheduled period contains per-barber items/);
  assert.match(payoutDecision, /\*\*Tests\*\*/);
  assert.match(payoutDecision, /CFG-PAYOUT-MIN-CENTS/);
});

test('P0-D05 resolves the TBC in place and removes both reserved markers', () => {
  const rows = kb.split('\n').filter((line) => line.startsWith('| `TBC-PAYOUT-SCHEDULE` |'));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /RESOLVED → `RULE-EARN-07`/);
  assert.doesNotMatch(section(kb, '### Pending rules', '## 10.'), /RULE-EARN-07/);
  assert.doesNotMatch(kb, /`RULE-EARN-07` \*\(reserved/);
});

const payoutTimeFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: payoutSchedule.timezone, weekday: 'long', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
});
function payoutTimeParts(timestamp) {
  return Object.fromEntries(payoutTimeFormatter.formatToParts(timestamp).map(({ type, value }) => [type, value]));
}

// Test-only oracle over these Sydney hourly-aligned fixtures. This is not a scheduler:
// no runtime exports, catch-up engine, persistence, eligible-earning query or Stripe calls.
function nextExamplePayoutCutoff(availableAt) {
  const hourMs = 60 * 60 * 1000;
  const availableMs = Date.parse(availableAt);
  for (let candidate = Math.floor(availableMs / hourMs) * hourMs;
    candidate <= availableMs + 8 * 24 * hourMs; candidate += hourMs) {
    const parts = payoutTimeParts(candidate);
    if (candidate > availableMs && parts.weekday === payoutSchedule.weekday
      && `${parts.hour}:${parts.minute}` === payoutSchedule.time) return candidate;
  }
  assert.fail('No cut-off found within the example horizon');
}

const payoutExamples = payoutPolicy.split('\n').filter((line) => /^\| \d+\./.test(line));
test('P0-D05 retains all six cut-off examples including daylight saving and one cent', () => {
  assert.equal(payoutExamples.length, 6);
});
for (const row of payoutExamples) {
  const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
  const [label, availableAt, net, cutoff, local] = cells;
  test(`P0-D05 cut-off example ${label}`, () => {
    assert.equal(cells.length, 5);
    assert.match(net, /^\d+$/);
    assert.ok(BigInt(net) >= payoutMinimum);
    assert.equal(nextExamplePayoutCutoff(availableAt), Date.parse(cutoff));
    const parts = payoutTimeParts(Date.parse(cutoff));
    assert.equal(parts.weekday, payoutSchedule.weekday);
    assert.equal(`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName.replace('GMT', '')}`, local);
  });
}

test('P0-D05 strict cut-off excludes equality and delayed workers do not widen it', () => {
  const scheduled = Date.parse('2026-10-04T23:00:00Z');
  const next = Date.parse('2026-10-11T23:00:00Z');
  assert.equal(nextExamplePayoutCutoff(new Date(scheduled - 1).toISOString()), scheduled);
  assert.equal(nextExamplePayoutCutoff(new Date(scheduled).toISOString()), next);
  assert.equal(nextExamplePayoutCutoff(new Date(scheduled + 1).toISOString()), next);
  assert.match(payoutPolicy, /does not widen the cut-off to the worker's actual start time/);
  assert.match(payoutQueue, /use the scheduled instant, not worker start time/);
  assert.match(payoutProcessor, /recovery of dropped\/late runs/);
});

test('P0-D05 pays one cent but never zero and does not deduct Connect fees', () => {
  assert.equal(0n >= payoutMinimum, false);
  assert.equal(1n >= payoutMinimum, true);
  assert.match(payoutPolicy, /Zero produces no payment/);
  assert.match(payoutPolicy, /no positive balance carried solely for being too small/);
  assert.match(payoutPolicy, /QuickTrimr absorbs standard Stripe Connect and payout fees/);
  assert.match(payoutPolicy, /without an extra deduction from barber earnings or a client surcharge/);
  assert.match(payoutProcessor, /actual provider costs are reconciled separately from booking snapshots/);
  assert.match(payoutScreen, /fees do not reduce the displayed barber entitlement/);
});

test('P0-D05 weekly local-time runs span spring and autumn clock changes', () => {
  const spring = Date.parse('2026-09-28T00:00:00Z');
  const autumn = Date.parse('2027-03-28T23:00:00Z');
  assert.equal(nextExamplePayoutCutoff(new Date(spring).toISOString()), Date.parse('2026-10-04T23:00:00Z'));
  assert.equal(nextExamplePayoutCutoff(new Date(autumn).toISOString()), Date.parse('2027-04-05T00:00:00Z'));
  assert.equal((nextExamplePayoutCutoff(new Date(spring).toISOString()) - spring) / 3_600_000, 167);
  assert.equal((nextExamplePayoutCutoff(new Date(autumn).toISOString()) - autumn) / 3_600_000, 169);
});

test('P0-D05 failures distinguish next-run retry, verified correction and unknown outcomes', () => {
  assert.match(payoutPolicy, /Confirmed temporary failure/);
  assert.match(payoutPolicy, /retry the original obligation on the next weekly run/);
  assert.match(payoutPolicy, /Resume on the next weekly run only after Stripe-verified correction/);
  assert.match(payoutPolicy, /Uncertain outcomes remain under reconciliation/);
  assert.match(payoutPolicy, /no unsettled or unavailable Stripe balance is advanced/);
  assert.match(payoutProcessor, /insufficient settled funds/);
  assert.match(payoutProcessor, /no attempted transfer\/payout to an ineligible account/);
});

test('P0-D05 transfer success is not bank payment and late failures preserve history', () => {
  assert.match(payoutPolicy, /only when its own mapped bank payout is confirmed `paid` by Stripe/);
  assert.match(payoutPolicy, /back to `queued_for_payout`/);
  assert.match(payoutPolicy, /append-only audit evidence/);
  assert.match(payoutProcessor, /Transfer success and payout creation leave earnings `queued_for_payout`/);
  assert.match(payoutProcessor, /all items are successfully paid, not merely terminal/);
  assert.doesNotMatch(payoutProcessor, /`paid` only when every item is terminal/);
  assert.match(payoutAdmin, /never labels a mixed paid\/failed batch as paid/);
});

test('P0-D05 durable obligations survive retries and provider key retention expiry', () => {
  assert.match(payoutPolicy, /a key alone is not a durable ledger/);
  assert.match(payoutPolicy, /Retries resume the original item/);
  assert.match(payoutPolicy, /reconciled returned funds/);
  assert.match(payoutQueue, /terminal status alone must never make an earning eligible for duplicate allocation/);
  assert.match(payoutProcessor, /retry beyond idempotency retention/);
  assert.match(payoutProcessor, /never transfer those funds again/);
  assert.match(payoutProcessor, /No database lock spans either external call/);
});

test('P0-D05 downstream setup and webhooks require compatible controls and account mapping', () => {
  const setup = section(backlog, '#### P0-T18 —', '#### P0-T19 —');
  const onboarding = section(backlog, '#### P1-T07 —', '#### P1-T08 —');
  const webhook = section(backlog, '#### P3-T03 —', '#### P3-T04 —');
  for (const ticket of [setup, onboarding, webhook]) {
    assert.match(ticket, /dependsOn: \[P0-D05,/);
    assert.match(ticket, /RULE-EARN-07/);
  }
  assert.match(setup, /platform-borne standard Connect\/payout fees/);
  assert.match(onboarding, /including reused accounts/);
  assert.match(webhook, /payout\.created.*payout\.updated.*payout\.paid.*payout\.failed/);
  assert.match(webhook, /unknown IDs or account mismatches must never credit an earning/);
});

test('P0-D05 surfaces timing, aged holds and notifications without manual payout controls', () => {
  assert.match(payoutScreen, /estimated bank-arrival date only when known/);
  assert.match(payoutScreen, /blocked item must not promise payment next Monday/);
  assert.match(payoutPolicy, /including bank holidays, not a bank-credit deadline/);
  assert.match(payoutPolicy, /operations must resolve or escalate with Stripe before that limit/);
  assert.match(payoutAdmin, /held age, provider holding deadline, next action and retry eligibility/);
  assert.match(payoutAdmin, /Read-only/);
  assert.match(payoutPolicy, /before a batch item exists/);
  assert.match(payoutQueue, /An unqueued account hold must not disappear/);
  assert.match(payoutProcessor, /Include `P3-T10`'s unqueued bank\/account holds/);
  assert.match(payoutAdmin, /Include unqueued bank\/account holds/);
  const notifications = section(backlog, '#### P6-T02 —', '#### P6-T03 —');
  assert.match(notifications, /P3-T11.*durable payout\/balance-change events/);
  assert.match(notifications, /transfer success is never announced as bank payment/);
});

// Decision/specification guards, not substitutes for the executable scheduler laboratories.
const workflowAdr = section(kb, '### ADR-011 —', '### ADR-012 —').replace(/\s+/g, ' ');
const workflowDecision = section(backlog, '#### P0-D07 —', '#### P0-D08 —').replace(/\s+/g, ' ');
const workflowRecord = (await readFile(new URL('../docs/decisions/P0-D07.md', import.meta.url), 'utf8')).replace(/\s+/g, ' ');
const workflowConsumerIds = ['P2-T03', 'P2-T15', 'P3-T11', 'P3-T12', 'P4-T05', 'P4-T11', 'P6-T02'];
const workflowConsumers = Object.fromEntries(workflowConsumerIds.map((id) => [
  id, section(backlog, `#### ${id} —`, '\n#### ').replace(/\s+/g, ' '),
]));

test('P0-D07 records the human-approved Supabase sweep architecture upstream', () => {
  assert.match(workflowAdr, /Confirmed by Andrew on 2026-10-03 \(P0-D07, Option A\)/);
  assert.match(workflowAdr, /Supabase `pg_cron`/);
  assert.match(workflowAdr, /bounded, indexed scans of authoritative due state/);
  assert.match(workflowAdr, /do not create a recurring cron job per entity/);
  assert.match(workflowAdr, /Inngest and Trigger.dev are not launch runtime dependencies/);
  assert.match(workflowDecision, /Approved by Andrew on 2026-10-03: Option A/);
  assert.match(workflowRecord, /Status: APPROVED by Andrew on 2026-10-03/);
});

test('P0-D07 records the explicit Trigger.dev comparison amendment without claiming a runtime pass', () => {
  for (const document of [workflowAdr, workflowDecision, workflowRecord]) {
    assert.match(document, /documentation-only/);
    assert.match(document, /Trigger\.dev/);
  }
  assert.match(workflowAdr, /it was not run/);
  assert.match(workflowDecision, /Trigger\.dev has not been run/);
  assert.match(workflowRecord, /still untested/);
  assert.match(workflowAdr, /does not waive live integration, security, recovery, monitoring or capacity tests/);
  assert.match(workflowDecision, /measured local Supabase\/Inngest evidence/);
});

test('P0-D07 resolves its TBC in place and updates stack and pending-rule projections', () => {
  const rows = kb.split('\n').filter((line) => line.startsWith('| `TBC-WORKFLOW-ENGINE` |'));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /RESOLVED → `ADR-011`/);
  const stackRow = kb.split('\n').find((line) => line.startsWith('| Workflows / timers |'));
  assert.match(stackRow, /Supabase `pg_cron`.*`ADR-011`/);
  assert.doesNotMatch(stackRow, /TBC-/);
  assert.doesNotMatch(section(kb, '### Pending rules', '## 10.'), /still gates the scheduling/);
});

test('P0-D07 makes deadlines authoritative and recovers missing or interrupted work', () => {
  assert.match(workflowAdr, /No client-side timers/);
  assert.match(workflowAdr, /Recheck current state and the authoritative deadline inside the conditional transition/);
  assert.match(workflowAdr, /Early wake-ups must not apply an effect or discard the pending obligation/);
  assert.match(workflowAdr, /stale\/cancelled work no-ops/);
  assert.match(workflowAdr, /missing work row, dropped wake-up, expired worker claim or interrupted run/);
  assert.match(workflowAdr, /original operation identity and current state guards/);
  assert.match(workflowAdr, /Production accepts no client-supplied clock/);
});

test('P0-D07 preserves atomic history and external-call idempotency without network locks', () => {
  assert.match(workflowAdr, /append-only history\/audit records commit together/);
  assert.match(workflowAdr, /Claim and commit before a provider call, release the lock/);
  assert.match(workflowAdr, /Never hold a database lock across a network call/);
  assert.match(workflowAdr, /deterministic server-derived keys and durable provider references/);
  assert.match(workflowAdr, /unknown result must not become a blind retry or a false success/);
  assert.match(workflowAdr, /Keep business-rule calculations pure in `packages\/domain`/);
});

test('P0-D07 requires operational evidence without turning lab settings into production defaults', () => {
  assert.match(workflowAdr, /independently alert on a stale worker heartbeat/);
  assert.match(workflowAdr, /oldest overdue work and failed runs/);
  assert.match(workflowAdr, /deny mobile access to worker controls/);
  assert.match(workflowAdr, /avoid outbound calls on empty ticks/);
  assert.match(workflowAdr, /not production defaults/);
  assert.match(workflowAdr, /cadence, batch\/concurrency and alert\/retention settings before deployment/);
  assert.match(workflowAdr, /sub-minute expiry behavior under a stated peak workload/);
  assert.match(workflowAdr, /Australia\/Sydney calendar, DST and original scheduled cut-off/);
});

test('P0-D07 names all seven affected workflow families', () => {
  const affects = workflowDecision.match(/affects: \[([^\]]+)\]/)?.[1].split(', ');
  assert.deepEqual(affects, workflowConsumerIds);
});

for (const id of workflowConsumerIds) {
  test(`P0-D07 synchronizes ${id} schedule, protection and independent monitoring ownership`, () => {
    const ticket = workflowConsumers[id];
    assert.match(ticket, /dependsOn: \[[^\]]*P0-D07/);
    assert.match(ticket, /knowledgeBase: \[[^\]]*ADR-011/);
    assert.match(ticket, /Supabase `pg_cron`/);
    assert.match(ticket, /bounded/);
    assert.match(ticket, /versioned schedule|Version schedules/);
    assert.match(ticket, /permissions|protected handler/);
    assert.match(ticket, /independent heartbeat|Independent heartbeat|independent stale-heartbeat/);
    assert.match(ticket, /interrupted/);
  });
}

test('P0-D07 expiry synchronization preserves committed acceptance without inventing race priority', () => {
  const expiry = workflowConsumers['P2-T15'];
  assert.match(expiry, /committed acceptance survives a stale expiry/);
  assert.match(expiry, /one legal committed outcome/);
  assert.match(expiry, /never unconditional acceptance priority or a new grace period/);
  assert.match(expiry, /does not permit acceptance of expired requests/);
  assert.match(expiry, /knowledgeBase: \[[^\]]*RULE-REQUEST-05/);
  assert.doesNotMatch(expiry, /accept always wins/);
});

test('P0-D07 delayed recovery preserves warning stages and throttled current ETA work', () => {
  assert.match(workflowConsumers['P4-T11'], /preserve its full configured final dispute window/);
  assert.match(workflowConsumers['P4-T11'], /never skip straight to release/);
  assert.match(workflowConsumers['P4-T05'], /recovery does not replay missed historical refreshes in a burst/);
  assert.match(workflowConsumers['P4-T05'], /Empty ticks make no Routes calls/);
  assert.match(workflowConsumers['P3-T12'], /no pass may reinstate an admin-suspended barber/);
});

test('P0-D07 notification recovery uses durable intent rather than lossy fire-and-forget', () => {
  assert.match(workflowConsumers['P6-T02'], /durable notification intent with the triggering change, commit, then dispatch/);
  assert.match(workflowConsumers['P6-T02'], /missing dispatch work is rediscovered from durable intents/);
  assert.match(workflowConsumers['P6-T02'], /do not invent a new identity on every retry/);
  assert.match(workflowConsumers['P6-T02'], /no business-state rollback on push failure/);
});
