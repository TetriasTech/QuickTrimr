import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
