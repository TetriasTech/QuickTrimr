import assert from 'node:assert/strict';

// Planning scenarios, not product configuration or a forecast. Prices checked 2026-10-03.
// Keep vendor prices in tenths of a micro-dollar to avoid intermediate rounding.
const unitsPerDollar = 10_000_000;
const usd = (units) => Number((units / unitsPerDollar).toFixed(4));
export function estimate(bookings, activeSeconds = 2) {
  assert.ok(Number.isSafeInteger(bookings) && bookings > 0);
  assert.ok(Number.isSafeInteger(activeSeconds) && activeSeconds > 0);
  const lifecycleRuns = bookings * 12;
  const reconciliationRuns = 30 * 24 * 60;
  const totalRuns = lifecycleRuns + reconciliationRuns;
  const inngestExecutions = lifecycleRuns * 3 + reconciliationRuns * 2;
  const triggerUsage = totalRuns * (250 + activeSeconds * 338);
  return {
    bookings, activeSeconds, lifecycleRuns, reconciliationRuns, totalRuns,
    pgCronTicksAtTenSeconds: 30 * 24 * 60 * 6,
    supabaseEdgeOverageUsdIfQuotaUnused: Math.ceil(Math.max(0, totalRuns - 2_000_000) / 1_000_000) * 2,
    supabaseEdgeOverageUsdIfQuotaAlreadyUsed: Math.ceil(totalRuns / 1_000_000) * 2,
    inngestExecutions,
    inngestProUsdUpperEstimate: usd(99 * unitsPerDollar + Math.max(0, inngestExecutions - 1_000_000) * 500),
    triggerUsageUsd: usd(triggerUsage),
    triggerProUsd: usd(Math.max(50 * unitsPerDollar, triggerUsage)),
  };
}

assert.equal(estimate(10_000).inngestExecutions, 446400);
assert.equal(estimate(100_000).inngestExecutions, 3686400);
assert.equal(estimate(100_000).inngestProUsdUpperEstimate, 233.32);
assert.equal(estimate(10_000).triggerUsageUsd, 15.1123);
assert.equal(estimate(100_000, 5).triggerUsageUsd, 241.1808);
assert.throws(() => estimate(-1));
assert.throws(() => estimate(1, 0));
console.log(JSON.stringify({ currency: 'USD', excludes: 'common Supabase baseline, worker hosting, database resizing, network, log overages, retries, tax and operator time', scenarios: [estimate(10_000), estimate(100_000), estimate(100_000, 5)] }, null, 2));
