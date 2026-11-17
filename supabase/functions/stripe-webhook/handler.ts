import { stripeWebhookRequestSchema } from '@quicktrimr/validation';
import Stripe from 'stripe';
import { z } from 'zod';

import { json } from '../_shared/responses/json.mts';

import type { ConnectRefresher } from '../_shared/stripe/refresh.ts';

// Accounts v2 capabilities/requirements are separate thin events.
export const connectEventTypes = [
  'account.updated',
  'v2.core.account.updated',
  'v2.core.account.closed',
  'v2.core.account[configuration.merchant].capability_status_updated',
  'v2.core.account[configuration.recipient].capability_status_updated',
  'v2.core.account[requirements].updated',
] as const;
const eventEnvelope = stripeWebhookRequestSchema.extend({
  id: z.string().regex(/^evt_[A-Za-z0-9_]+$/),
  type: z.string().max(200),
  livemode: z.boolean(),
  account: z.string().optional(),
});
type Options = {
  secrets: readonly string[];
  refresh: ConnectRefresher;
  log?: Pick<Console, 'error'>;
};
export function createStripeWebhookHandler({
  secrets,
  refresh,
  log = console,
}: Options) {
  if (!secrets.length || secrets.some((secret) => !secret.startsWith('whsec_')))
    throw new Error('Stripe webhook configuration missing.');
  // Crypto implementation works in both Node tests and the Deno Edge runtime.
  const crypto = Stripe.createSubtleCryptoProvider();
  const verifier = new Stripe('unused', {
    httpClient: Stripe.createFetchHttpClient(),
    telemetry: false,
  });
  return async (request: Request) => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    const signature = request.headers.get('stripe-signature');
    if (!signature) return json({ error: 'invalid_signature' }, 400);
    // Transport limit only. Never parse or persist an unverified provider body.
    const maxBytes = 1024 * 1024;
    if (Number(request.headers.get('content-length')) > maxBytes)
      return json({ error: 'invalid_event' }, 400);
    let raw: Uint8Array;
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'invalid_signature' }, 400);
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          return json({ error: 'invalid_event' }, 400);
        }
        chunks.push(value);
      }
      const joined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      raw = joined;
      let valid = false;
      for (const secret of secrets) {
        try {
          await verifier.webhooks.signature!.verifyHeaderAsync(
            raw,
            signature,
            secret,
            undefined,
            crypto,
          );
          valid = true;
          break;
        } catch {
          /* Try the other configured destination's signing secret. */
        }
      }
      if (!valid) return json({ error: 'invalid_signature' }, 400);
    } catch {
      return json({ error: 'invalid_signature' }, 400);
    }

    const decoded = eventEnvelope.safeParse(
      (() => {
        try {
          return JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(raw),
          );
        } catch {
          return null;
        }
      })(),
    );
    if (!decoded.success) return json({ error: 'invalid_event' }, 400);
    const event = decoded.data;
    if (event.livemode) return json({ error: 'sandbox_events_only' }, 403);
    if (!connectEventTypes.some((type) => type === event.type))
      return json({ received: true }, 200);
    const snapshot = z
      .object({
        object: z.object({ id: z.string(), object: z.literal('account') }),
      })
      .safeParse(event.data);
    const accountId =
      event.type === 'account.updated'
        ? snapshot.data?.object.id
        : event.related_object?.id;
    if (
      !accountId ||
      !/^acct_[A-Za-z0-9]+$/.test(accountId) ||
      (event.type === 'account.updated' &&
        event.account !== undefined &&
        event.account !== accountId) ||
      (event.type !== 'account.updated' &&
        event.related_object?.type !== 'v2.core.account')
    )
      return json({ error: 'invalid_event' }, 400);
    try {
      const result = await refresh({
        accountId,
        eventId: event.id,
        eventType: event.type,
      });
      return json(
        result.duplicate
          ? { received: true, duplicate: true }
          : { received: true },
        200,
      );
    } catch {
      // Only a committed update and receipt permit a successful acknowledgement.
      log.error('stripe_connect.webhook_processing_failed');
      return json({ error: 'processing_failed' }, 500);
    }
  };
}
