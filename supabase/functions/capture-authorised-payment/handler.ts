import {
  bookingStatusSchema,
  captureAuthorisedPaymentRequestSchema,
  captureAuthorisedPaymentResponseSchema,
  integerCentsSchema,
  paymentStatusSchema,
  postgresUuidSchema,
  timestampSchema,
} from '@quicktrimr/validation';
import { z } from 'zod';

import { json } from '../_shared/responses/json.mts';

import type { CaptureProvider } from './stripe.ts';

const operationSchema = z.strictObject({
  paymentId: postgresUuidSchema,
  requestId: postgresUuidSchema,
  intentId: z.string().regex(/^pi_[A-Za-z0-9]+$/),
  amountCents: integerCentsSchema,
  status: paymentStatusSchema,
  authorisationExpiresAt: timestampSchema,
  expired: z.boolean(),
  failureReason: z.enum(['capture_failed', 'authorisation_expired']).nullable(),
  idempotent: z.boolean(),
});
const gatewayErrorSchema = z.object({
  message: z.enum(['invalid_status_transition', 'authorisation_expired']),
});
const paymentStatus = paymentStatusSchema.enum;
const methods = { Allow: 'POST' };
type Operation = z.infer<typeof operationSchema>;

function respond(operation: Operation) {
  if (operation.status === paymentStatus.capture_failed) {
    if (operation.failureReason === 'authorisation_expired')
      return json({ error: 'authorisation_expired' }, 409);
    return json({ error: 'capture_failed' }, 402);
  }
  return json(
    captureAuthorisedPaymentResponseSchema.parse({
      paymentId: operation.paymentId,
      status: operation.status,
      capturedCents: operation.amountCents,
      bookingStatus: bookingStatusSchema.enum.paid_confirmed,
      ...(operation.idempotent ? { idempotent: true } : {}),
    }),
    200,
  );
}

export function createCaptureHandler({
  supabaseUrl,
  serviceRoleKey,
  provider,
  fetcher = fetch,
  log = console,
  now = Date.now,
}: {
  supabaseUrl: string;
  serviceRoleKey: string;
  provider: CaptureProvider;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
  now?: () => number;
}) {
  const rpc = new URL('/rest/v1/rpc/capture_authorised_payment', supabaseUrl);

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, methods);
    const authorization = request.headers.get('authorization');
    if (!authorization) return json({ error: 'unauthorized' }, 401);
    if (!/^Bearer [^\s,]+$/i.test(authorization))
      return json({ error: 'forbidden' }, 403);
    const headers = {
      apikey: serviceRoleKey,
      authorization,
      'content-type': 'application/json',
    };
    const input = captureAuthorisedPaymentRequestSchema.safeParse(
      await request.json().catch(() => null),
    );

    function apply(step: 'begin' | 'complete' | 'fail', providerResult = {}) {
      // PostgREST verifies the supplied service JWT, and the RPC checks its
      // grants and role. The configured key is used only as the API key.
      return fetcher(rpc, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_payment_id: input.success ? input.data.paymentId : null,
          p_step: step,
          ...providerResult,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    }

    try {
      const start = await apply('begin');
      if (start.status === 401 || start.status === 403)
        return json({ error: 'forbidden' }, 403);
      if (!input.success && start.ok) {
        const fields: Record<string, string> = {};
        for (const issue of input.error.issues)
          fields[String(issue.path[0] ?? '_request')] ??= issue.message;
        return json({ error: 'validation_failed', fields }, 422);
      }
      if (start.status === 404) return json({ error: 'not_found' }, 404);
      if (start.status === 409) {
        const error = gatewayErrorSchema.parse(await start.json());
        return json({ error: error.message }, 409);
      }
      if (!start.ok) throw new Error('Could not claim capture.');
      const operation = operationSchema.parse(await start.json());
      if (operation.status !== paymentStatus.capture_pending)
        return respond(operation);

      let result;
      try {
        // A previous attempt might have reached Stripe before its response was
        // lost. Always read that same intent before deciding whether to capture.
        result = await provider.read(operation);
        if (result.status === 'capturable') {
          if (
            operation.expired ||
            now() >=
              Math.min(
                result.expiresAt,
                Date.parse(operation.authorisationExpiresAt),
              )
          )
            return json({ error: 'authorisation_expired' }, 409);
          const attempt = await provider.capture(operation);
          result =
            attempt.status === 'unknown'
              ? await provider.read(operation)
              : attempt;
        } else if (result.status === 'failed' && operation.expired) {
          return json({ error: 'authorisation_expired' }, 409);
        }
      } catch {
        log.error('payment_capture.provider_unavailable');
        return json({ error: 'stripe_unavailable' }, 502);
      }

      if (result.status === 'unknown' || result.status === 'capturable') {
        log.error('payment_capture.outcome_unconfirmed');
        return json({ error: 'stripe_unavailable' }, 502);
      }
      const complete = result.status === 'captured';
      const final = await apply(complete ? 'complete' : 'fail', {
        p_intent_id: operation.intentId,
        ...(result.status === 'captured'
          ? {
              p_captured_cents: operation.amountCents,
              p_charge_id: result.chargeId,
              p_balance_transaction_id: result.balanceTransactionId,
              p_fee_cents: result.feeCents,
            }
          : {
              p_failure_reason:
                result.status === 'expired'
                  ? 'authorisation_expired'
                  : 'capture_failed',
            }),
      });
      if (!final.ok) throw new Error('Could not persist capture outcome.');
      return respond(operationSchema.parse(await final.json()));
    } catch {
      log.error('payment_capture.persistence_failed');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
