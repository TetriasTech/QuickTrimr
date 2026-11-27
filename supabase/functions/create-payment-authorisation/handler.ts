import {
  createPaymentAuthorisationRequestSchema,
  createPaymentAuthorisationResponseSchema,
  integerCentsSchema,
  paymentStatusSchema,
  postgresUuidSchema,
  timestampSchema,
} from '@quicktrimr/validation';
import { z } from 'zod';

import { createStoredRoleVerifier } from '../_shared/auth/stored-role.ts';
import { json } from '../_shared/responses/json.mts';

import type { AuthorisationProvider, SandboxIntent } from './stripe.ts';

const contextSchema = z.strictObject({
  paymentId: postgresUuidSchema,
  eligible: z.boolean(),
  amountCents: integerCentsSchema,
  status: paymentStatusSchema,
  intentId: z
    .string()
    .regex(/^pi_[A-Za-z0-9]+$/)
    .nullable(),
  authorisationExpiresAt: timestampSchema.nullable(),
  releaseReason: z
    .enum(['request_not_pending', 'authorisation_window_unavailable'])
    .nullable(),
});
type PaymentContext = z.infer<typeof contextSchema>;
type Step = 'prepare' | 'read' | 'bind' | 'record' | 'release' | 'cancelled';

class RequestNotPending extends Error {}
class ForbiddenRequest extends Error {}
class ProviderUnavailable extends Error {}

async function providerCall(call: () => Promise<SandboxIntent>) {
  try {
    return await call();
  } catch {
    // Stripe errors can carry full payment objects and SDK credentials.
    throw new ProviderUnavailable();
  }
}

function verifyProviderIdentity(
  intent: SandboxIntent,
  requestId: string,
  context: PaymentContext,
) {
  if (
    intent.requestId !== requestId ||
    intent.amountCents !== context.amountCents ||
    (context.intentId !== null && intent.id !== context.intentId)
  )
    throw new ProviderUnavailable();
}

const successful = (body: unknown) =>
  json(createPaymentAuthorisationResponseSchema.parse(body), 200);

function authorised(context: PaymentContext) {
  if (!context.eligible) return json({ error: 'request_not_pending' }, 409);
  return successful({
    paymentId: context.paymentId,
    status: paymentStatusSchema.enum.authorised,
    amountCents: context.amountCents,
    authorisationExpiresAt: context.authorisationExpiresAt
      ? new Date(context.authorisationExpiresAt).toISOString()
      : null,
  });
}

export function createPaymentAuthorisationHandler({
  supabaseUrl,
  anonKey,
  serviceRoleKey,
  provider,
  fetcher = fetch,
  log = console,
}: {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  provider: AuthorisationProvider;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
}) {
  const baseUrl = new URL(supabaseUrl);
  const verifyClient = createStoredRoleVerifier({ baseUrl, anonKey, fetcher });
  const endpoint = new URL(
    '/rest/v1/rpc/request_payment_authorisation',
    baseUrl,
  );

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    try {
      const caller = await verifyClient(
        request.headers.get('authorization'),
        'client',
      );
      if ('error' in caller)
        return json({ error: caller.error }, caller.status);
      const { userId } = caller;
      const parsed = createPaymentAuthorisationRequestSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues)
          fields[String(issue.path[0] ?? '_request')] ??= issue.message;
        return json({ error: 'validation_failed', fields }, 422);
      }
      const { bookingRequestId, operation } = parsed.data;
      async function run(step: Step, intent?: SandboxIntent) {
        const result = await fetcher(endpoint, {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            p_client_id: userId,
            p_request_id: bookingRequestId,
            p_step: step,
            p_stripe_intent_id: intent?.id,
            p_capture_before:
              step === 'record' ? intent?.captureBefore : undefined,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
        if (result.status === 403) throw new ForbiddenRequest();
        if (result.status === 409) throw new RequestNotPending();
        if (!result.ok) throw new Error('Payment persistence failed.');
        return contextSchema.nullable().parse(await result.json());
      }
      const load = async (step: Step, intent?: SandboxIntent) =>
        contextSchema.parse(await run(step, intent));
      let context = await run(operation === 'prepare' ? 'prepare' : 'read');
      if (context?.status === 'authorised') return authorised(context);
      if (context && !context.eligible && !context.intentId)
        throw new RequestNotPending();
      if (!context || (!context.intentId && operation === 'verify'))
        return json({ error: 'payment_method_required' }, 409);
      if (context.status !== 'requires_authorisation')
        return json(
          { error: context.releaseReason ?? 'request_not_pending' },
          409,
        );

      let intent: SandboxIntent;
      if (context.intentId) {
        const intentId = context.intentId;
        intent = await providerCall(() => provider.read(intentId));
      } else {
        if (!context.eligible) throw new RequestNotPending();
        const amountCents = context.amountCents;
        intent = await providerCall(() =>
          provider.create(bookingRequestId, amountCents),
        );
        verifyProviderIdentity(intent, bookingRequestId, context);
        // Bind the durable identity before the owning app can confirm it.
        context = await load('bind', intent);
      }
      verifyProviderIdentity(intent, bookingRequestId, context);
      if (intent.status === 'canceled') {
        context = await load('cancelled', intent);
        return json(
          { error: context.releaseReason ?? 'request_not_pending' },
          409,
        );
      }
      // These transactions recheck eligibility after Stripe I/O. An intent
      // can change while the client is completing the bank's challenge.
      context = await load(
        intent.status === 'requires_capture' ? 'record' : 'release',
        intent,
      );
      if (context.status === 'authorised') return authorised(context);
      if (context.releaseReason) {
        if (context.status === 'requires_authorisation') {
          const cancelled = await providerCall(() =>
            provider.cancel(intent.id, bookingRequestId),
          );
          verifyProviderIdentity(cancelled, bookingRequestId, context);
          if (cancelled.status !== 'canceled') throw new ProviderUnavailable();
          await load('cancelled', cancelled);
        }
        return json({ error: context.releaseReason }, 409);
      }
      if (!context.eligible || context.status !== 'requires_authorisation')
        throw new RequestNotPending();
      const authenticationRequired = intent.status === 'requires_action';
      if (
        intent.status !== 'requires_payment_method' &&
        !authenticationRequired
      )
        throw new ProviderUnavailable();
      if (operation === 'verify') {
        if (authenticationRequired)
          return json({ error: 'authentication_required' }, 402);
        if (intent.decline) return json({ error: intent.decline }, 402);
        return json({ error: 'payment_method_required' }, 409);
      }
      return successful({
        paymentId: context.paymentId,
        status: context.status,
        clientSecret: intent.clientSecret,
        authenticationRequired,
      });
    } catch (error) {
      if (error instanceof ForbiddenRequest)
        return json({ error: 'forbidden' }, 403);
      if (error instanceof RequestNotPending)
        return json({ error: 'request_not_pending' }, 409);
      if (error instanceof ProviderUnavailable) {
        log.error('payment_authorisation.provider_unavailable');
        return json({ error: 'stripe_unavailable' }, 502);
      }
      log.error('payment_authorisation.internal_error');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
