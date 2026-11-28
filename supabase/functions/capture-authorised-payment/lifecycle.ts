import { integerCentsSchema, postgresUuidSchema } from '@quicktrimr/validation';
import { z } from 'zod';

import { json } from '../_shared/responses/json.mts';

import type { AuthorisationProvider } from '../create-payment-authorisation/stripe.ts';

const workSchema = z.strictObject({
  concurrency: z.number().int().positive(),
  jobs: z.array(
    z.strictObject({
      paymentId: postgresUuidSchema,
      requestId: postgresUuidSchema,
      intentId: z
        .string()
        .regex(/^pi_[A-Za-z0-9]+$/)
        .nullable(),
      amountCents: integerCentsSchema,
      action: z.enum(['capture', 'release']),
    }),
  ),
});

export function createRequestPaymentSweep({
  supabaseUrl,
  serviceRoleKey,
  authorisation,
  capture,
  fetcher = fetch,
  log = console,
}: {
  supabaseUrl: string;
  serviceRoleKey: string;
  authorisation: AuthorisationProvider;
  capture: (request: Request) => Promise<Response>;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
}) {
  const serviceAuth = 'Bearer ' + serviceRoleKey;
  const rpc = (
    name: string,
    body: Record<string, unknown>,
    authorization = serviceAuth,
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

  return async (request: Request) => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    const authorization = request.headers.get('authorization');
    if (!authorization) return json({ error: 'unauthorized' }, 401);
    const input = z
      .strictObject({ requestId: postgresUuidSchema.optional() })
      .safeParse(await request.json().catch(() => null));
    if (!input.success)
      return json(
        {
          error: 'validation_failed',
          fields: { requestId: 'Use a request ID or omit it.' },
        },
        422,
      );

    try {
      const response = await rpc(
        'claim_request_payment_work',
        {
          p_request_id: input.data.requestId ?? null,
        },
        authorization,
      );
      if (response.status === 401 || response.status === 403)
        return json({ error: 'forbidden' }, 403);
      if (!response.ok) throw new Error('Unable to claim payment work.');
      const { jobs, concurrency } = workSchema.parse(await response.json());
      let captured = false;
      for (let offset = 0; offset < jobs.length; offset += concurrency) {
        await Promise.all(
          jobs.slice(offset, offset + concurrency).map(async (job) => {
            try {
              if (job.action === 'capture') {
                const outcome = await capture(
                  new Request(request.url, {
                    method: 'POST',
                    headers: {
                      authorization: serviceAuth,
                      'content-type': 'application/json',
                    },
                    body: JSON.stringify({ paymentId: job.paymentId }),
                  }),
                );
                if (outcome.ok) captured = true;
                return;
              }

              const identity = {
                p_payment_id: job.paymentId,
                p_intent_id: job.intentId,
              };
              const guard = await rpc(
                'complete_request_payment_release',
                identity,
              );
              if (!guard.ok) throw new Error('Unable to check release.');
              if (!z.boolean().parse(await guard.json())) return;
              if (job.intentId) {
                const intentId = job.intentId;
                const checkIdentity = (
                  intent: Awaited<ReturnType<AuthorisationProvider['read']>>,
                ) => {
                  if (
                    intent.id !== intentId ||
                    intent.requestId !== job.requestId ||
                    intent.amountCents !== job.amountCents
                  )
                    throw new Error('Payment intent identity mismatch.');
                };
                let intent = await authorisation.read(intentId);
                checkIdentity(intent);
                if (intent.status !== 'canceled') {
                  if (intent.status === 'processing') return;
                  intent = await authorisation.cancel(intentId);
                  checkIdentity(intent);
                }
                if (intent.status !== 'canceled') return;
              }
              const done = await rpc('complete_request_payment_release', {
                ...identity,
                p_released: true,
              });
              if (!done.ok) throw new Error('Unable to record release.');
            } catch {
              log.error('request_payment.work_will_retry', job.action);
            }
          }),
        );
      }
      return json({ captured }, 200);
    } catch {
      log.error('request_payment.sweep_failed');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
