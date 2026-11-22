import assert from 'node:assert/strict';
import test from 'node:test';

import { requestSnapshot } from '../src/index.ts';
export const policy = {
  commissionPct: 20,
  refundPct: { scheduled: 75, available_now: 50 },
  inconveniencePct: { scheduled: 25, available_now: 50 },
  lateCancellationHours: 12,
  availableExpiryMinutes: 5,
  scheduledExpiryHours: 2,
};
test('request snapshots reconcile the KB examples and keep per-type cancellation and configured deadlines', () => {
  const now = Date.parse('2026-11-22T00:00:00Z');
  for (const type of ['available_now', 'scheduled']) {
    for (const [price, commission, net] of [
      [4500, 900, 3600],
      [4503, 900, 3603],
      [1, 0, 1],
      [2147483647, 429496729, 1717986918],
    ]) {
      const result = requestSnapshot(price, type, now, policy);
      assert.equal(result.grossCents, price);
      assert.equal(result.commissionCents, commission);
      assert.equal(result.barberNetCents, net);
      assert.equal(result.cancellationRefundPct, policy.refundPct[type]);
      assert.equal(
        result.cancellationInconveniencePct,
        policy.inconveniencePct[type],
      );
      assert.equal(
        Date.parse(result.expiresAt) - now,
        type === 'scheduled' ? 7200000 : 300000,
      );
    }
  }
  const original = requestSnapshot(4503, 'scheduled', now, policy);
  const changed = requestSnapshot(4503, 'scheduled', now, {
    ...policy,
    commissionPct: 33,
    scheduledExpiryHours: 3,
  });
  assert.equal(original.commissionCents, 900);
  assert.equal(changed.commissionCents, 1485);
  for (const invalid of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])
    assert.throws(() => requestSnapshot(invalid, 'scheduled', now, policy));
  for (const edit of [
    { commissionPct: 101 },
    { commissionPct: 20.5 },
    { lateCancellationHours: 0 },
    { scheduledExpiryHours: NaN },
    { refundPct: { scheduled: 80, available_now: 50 } },
  ])
    assert.throws(() =>
      requestSnapshot(4503, 'scheduled', now, { ...policy, ...edit }),
    );
});
