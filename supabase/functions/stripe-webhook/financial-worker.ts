import { postgresUuidSchema } from '@quicktrimr/validation';
import { z } from 'zod';

import { json } from '../_shared/responses/json.mts';

import { financialReferenceSchema } from './financial-events.ts';

import type {
  FinancialProvider,
  FinancialReference,
} from './financial-events.ts';

const sweepSchema = z.strictObject({
  lease: postgresUuidSchema,
  concurrency: z.number().int().positive(),
  jobs: z.array(financialReferenceSchema),
});

export function createFinancialWorker({
  supabaseUrl,
  serviceRoleKey,
  provider,
  fetcher = fetch,
  log = console,
}: {
  supabaseUrl: string;
  serviceRoleKey: string;
  provider: FinancialProvider;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
}) {
  const rpc = async (
    name: string,
    body: Record<string, unknown>,
    authorization = 'Bearer ' + serviceRoleKey,
  ) =>
    fetcher(new URL('/rest/v1/rpc/' + name, supabaseUrl), {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });

  async function enqueue(event: FinancialReference) {
    const result = await rpc('enqueue_stripe_financial_event', {
      p_event_id: event.eventId,
      p_event_type: event.type,
      p_account_id: event.accountId,
      p_object_id: event.objectId,
    });
    if (!result.ok) throw new Error('Could not save verified event.');
    return z.boolean().parse(await result.json());
  }

  async function sweep(request: Request) {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    const authorization = request.headers.get('authorization');
    if (!authorization) return json({ error: 'unauthorized' }, 401);
    try {
      // PostgREST authenticates the caller before the claim is executed.
      const result = await rpc(
        'claim_stripe_financial_events',
        {},
        authorization,
      );
      if (result.status === 401 || result.status === 403)
        return json({ error: 'forbidden' }, 403);
      if (!result.ok) throw new Error('Unable to claim webhook sweep.');
      const batch = sweepSchema.nullable().parse(await result.json());
      if (!batch) return json({ processed: 0 }, 200);
      let processed = 0;
      for (
        let offset = 0;
        offset < batch.jobs.length;
        offset += batch.concurrency
      ) {
        await Promise.all(
          batch.jobs
            .slice(offset, offset + batch.concurrency)
            .map(async (event) => {
              const fact = await provider(event).catch(() => null);
              const args = {
                p_event_id: event.eventId,
                p_lease: batch.lease,
                p_fact: fact,
              };
              try {
                let final = await rpc('finish_stripe_financial_event', args);
                if (!final.ok && fact !== null)
                  final = await rpc('finish_stripe_financial_event', {
                    ...args,
                    p_fact: null,
                  });
                if (!final.ok)
                  throw new Error('Could not commit webhook outcome.');
                const outcome = z.string().parse(await final.json());
                if (outcome === 'applied' || outcome === 'unchanged')
                  processed++;
                else
                  log.error(
                    'stripe_webhook.event_not_applied',
                    event.type,
                    event.eventId,
                  );
              } catch {
                log.error(
                  'stripe_webhook.outcome_persistence_failed',
                  event.type,
                  event.eventId,
                );
              }
            }),
        );
      }
      const released = await rpc('release_stripe_financial_sweep', {
        p_lease: batch.lease,
      });
      if (!released.ok) throw new Error('Unable to finish webhook sweep.');
      return json({ processed }, 200);
    } catch {
      log.error('stripe_webhook.sweep_failed');
      return json({ error: 'processing_failed' }, 500);
    }
  }

  return { enqueue, sweep };
}
