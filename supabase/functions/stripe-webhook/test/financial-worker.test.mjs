import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as yieldToQueue } from 'node:timers/promises';

import { createFinancialWorker } from '../financial-worker.ts';

test('sweep forwards caller authentication and bounds provider fan-out until outcomes commit', async () => {
  let active = 0,
    peak = 0,
    finished = 0;
  const order = [];
  const jobs = Array.from({ length: 11 }, (_, index) => ({
    eventId: 'evt_Unit' + index,
    type: 'payment_intent.succeeded',
    accountId: null,
    objectId: 'pi_Unit' + index,
  }));
  const worker = createFinancialWorker({
    supabaseUrl: 'http://localhost',
    serviceRoleKey: 'synthetic-service-key',
    provider: async () => {
      active++;
      peak = Math.max(peak, active);
      await yieldToQueue();
      active--;
      return { status: 'succeeded', amountCents: 4503 };
    },
    fetcher: async (url, options) => {
      const name = url.pathname.split('/').at(-1);
      order.push(name);
      if (name === 'claim_stripe_financial_events') {
        assert.equal(
          options.headers.authorization,
          'Bearer verified-test-worker',
        );
        return Response.json({
          lease: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          concurrency: 4,
          jobs,
        });
      }
      if (name === 'finish_stripe_financial_event') {
        finished++;
        return Response.json('applied');
      }
      assert.equal(name, 'release_stripe_financial_sweep');
      assert.equal(finished, jobs.length);
      return new Response(null, { status: 204 });
    },
  });
  const result = await worker.sweep(
    new Request('http://localhost/stripe-webhook/sweep', {
      method: 'POST',
      headers: { authorization: 'Bearer verified-test-worker' },
    }),
  );
  assert.deepEqual(await result.json(), { processed: jobs.length });
  assert.equal(peak, 4);
  assert.equal(order.at(-1), 'release_stripe_financial_sweep');
});
