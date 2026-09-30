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
