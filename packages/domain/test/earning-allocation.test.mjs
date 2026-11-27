import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cancellationRefundCents, earningAllocation } from '../src/index.ts';

test('RULE-PAY-11 reconciles the worked examples and keeps fees with the platform', () => {
  const cases = [
    { gross: 4500, refund: 0, commission: 900, barber: 3600, platform: 793 },
    { gross: 4500, refund: 4500, commission: 0, barber: 0, platform: -107 },
    { gross: 4500, refund: 2250, commission: 450, barber: 1800, platform: 343 },
    { gross: 4503, refund: 0, commission: 900, barber: 3603, platform: 793 },
    { gross: 4503, refund: 2251, commission: 450, barber: 1802, platform: 343 },
    { gross: 4501, refund: 123, commission: 875, barber: 3503, platform: 768 },
  ];
  for (const { gross, refund, commission, barber, platform } of cases) {
    const allocation = earningAllocation({
      grossCents: gross,
      originalCommissionCents: 900,
      refundedCents: refund,
      retainedProcessingFeeCents: 107,
      cancellation: false,
    });
    assert.equal(allocation.commissionCents, commission);
    assert.equal(allocation.barberNetCents, barber);
    assert.equal(allocation.platformAfterProcessingCents, platform);
    assert.equal(refund + barber + platform + 107, gross);
  }
});

test('RULE-CANCEL-07 rounds refunds up and fully reverses commission', () => {
  for (const [pct, expectedRefund, expectedNet] of [
    [75, 3378, 1125],
    [50, 2252, 2251],
    [100, 4503, 0],
  ]) {
    const refundedCents = cancellationRefundCents(4503, pct);
    const outcome = earningAllocation({
      grossCents: 4503,
      originalCommissionCents: 900,
      refundedCents,
      retainedProcessingFeeCents: 107,
      cancellation: true,
    });
    assert.equal(refundedCents, expectedRefund);
    assert.equal(outcome.barberNetCents, expectedNet);
    assert.equal(outcome.commissionCents, 0);
    assert.equal(outcome.platformAfterProcessingCents, -107);
    assert.equal(
      refundedCents +
        outcome.barberNetCents +
        outcome.platformAfterProcessingCents +
        107,
      4503,
    );
  }
});

test('rejects fractional or impossible cents and preserves unknown fees', () => {
  assert.throws(() => cancellationRefundCents(4503.1, 75));
  assert.throws(() => cancellationRefundCents(4503, 101));
  const snapshot = {
    grossCents: 4503,
    originalCommissionCents: 900,
    refundedCents: 0,
    retainedProcessingFeeCents: null,
    cancellation: false,
  };
  assert.throws(() => earningAllocation({ ...snapshot, refundedCents: 4504 }));
  assert.throws(() =>
    earningAllocation({ ...snapshot, retainedProcessingFeeCents: 107.5 }),
  );
  assert.equal(earningAllocation(snapshot).platformAfterProcessingCents, null);
});
