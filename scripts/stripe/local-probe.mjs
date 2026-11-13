import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import Stripe from 'stripe';

import { loadVerificationConfig } from './config.mjs';

// Local diagnostic bounds, not booking/payout policy. Fail closed instead of evicting IDs.
export const probeLimits = Object.freeze({
  maxBodyBytes: 1024 * 1024,
  maxEvents: 1000,
});

const verifier = new Stripe(null, {
  authenticator: () =>
    Promise.reject(new Error('Stripe API access is disabled in this probe.')),
});

function reply(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

export function createProbe({ webhookSecret, config, limits = probeLimits }) {
  if (typeof webhookSecret !== 'string' || !webhookSecret.trim())
    throw new Error('STRIPE_WEBHOOK_SECRET is required.');
  const events = new Map();
  let duplicateDeliveries = 0;
  const callbacks = { return: 0, refresh: 0 };
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'GET') {
        if (path === '/health')
          return reply(response, 200, {
            probe: 'quicktrimr-stripe',
            sandboxOnly: true,
          });
        if (path === '/evidence')
          return reply(response, 200, {
            uniqueEvents: events.size,
            duplicateDeliveries,
            events: [...events].map(([id, type]) => ({ id, type })),
            callbacks,
            durable: false,
            businessEffects: false,
          });
        const callback =
          path === config.returnPath
            ? 'return'
            : path === config.refreshPath
              ? 'refresh'
              : null;
        if (callback) {
          callbacks[callback]++;
          return reply(response, 200, {
            callback,
            onboardingVerified: false,
            message:
              'Local callback observed. Recheck Stripe account requirements; this page does not confirm onboarding.',
          });
        }
      }
      if (path !== '/stripe/webhook')
        return reply(response, 404, { error: 'not_found' });
      if (request.method !== 'POST')
        return reply(response, 405, { error: 'method_not_allowed' });
      const chunks = [];
      let size = 0;
      let oversized = false;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > limits.maxBodyBytes) {
          oversized = true;
          continue;
        }
        if (!oversized) chunks.push(chunk);
      }
      if (oversized) return reply(response, 413, { error: 'body_too_large' });
      let event;
      try {
        event = verifier.webhooks.constructEvent(
          Buffer.concat(chunks),
          request.headers['stripe-signature'],
          webhookSecret,
        );
      } catch {
        return reply(response, 400, { error: 'invalid_signature_or_payload' });
      }
      if (
        !event ||
        event.object !== 'event' ||
        typeof event.id !== 'string' ||
        !event.id.startsWith('evt_') ||
        event.id.length > 200 ||
        typeof event.type !== 'string' ||
        event.type.length > 200 ||
        !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(event.type)
      )
        return reply(response, 400, { error: 'invalid_event' });
      if (event.livemode !== false)
        return reply(response, 403, { error: 'sandbox_events_only' });
      if (events.has(event.id)) {
        duplicateDeliveries++;
        return reply(response, 200, { received: true, duplicate: true });
      }
      if (events.size >= limits.maxEvents)
        return reply(response, 503, { error: 'probe_capacity' });
      // No await between deduplication and recording; parallel deliveries have one winner.
      events.set(event.id, event.type);
      return reply(response, 200, { received: true, duplicate: false });
    } catch {
      if (!response.headersSent)
        reply(response, 400, { error: 'invalid_request' });
      else response.destroy();
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return server;
}

async function main() {
  const config = await loadVerificationConfig();
  const server = createProbe({
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    config,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolve);
  });
  process.stdout.write(
    `QuickTrimr sandbox probe: http://127.0.0.1:${config.port}\n`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => server.close(() => process.exit(0)));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    process.stderr.write(
      'Probe could not start. Check STRIPE_WEBHOOK_SECRET, local callback config and port availability.\n',
    );
    process.exitCode = 1;
  });
