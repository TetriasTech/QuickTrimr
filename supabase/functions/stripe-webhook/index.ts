import { createConnectStatusProvider } from '../_shared/stripe/connect-status.ts';
import { createConnectRefresher } from '../_shared/stripe/refresh.ts';

import { createFinancialProvider } from './financial-events.ts';
import { createFinancialWorker } from './financial-worker.ts';
import { createStripeWebhookHandler } from './handler.ts';

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing Edge runtime variable ${name}.`);
  return value;
}
const supabaseUrl = requiredEnv('SUPABASE_URL');
const platformAccountId = requiredEnv('STRIPE_CONNECT_SANDBOX_ACCOUNT_ID');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const stripeKey = requiredEnv('STRIPE_SECRET_KEY');
const refresh = createConnectRefresher({
  supabaseUrl,
  serviceRoleKey,
  platformAccountId,
  provider: createConnectStatusProvider(stripeKey, platformAccountId),
});

Deno.serve(
  createStripeWebhookHandler({
    refresh,
    platformId: platformAccountId,
    financial: createFinancialWorker({
      supabaseUrl,
      serviceRoleKey,
      provider: createFinancialProvider(stripeKey, platformAccountId),
    }),
    secrets: [
      requiredEnv('STRIPE_WEBHOOK_SECRET'),
      Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET'),
    ].filter((secret): secret is string => Boolean(secret)),
  }),
);
