import { createConnectStatusProvider } from '../_shared/stripe/connect-status.ts';
import { createConnectRefresher } from '../_shared/stripe/refresh.ts';

import { createConnectStatusHandler } from './handler.ts';

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing Edge runtime variable ${name}.`);
  return value;
}
const supabaseUrl = requiredEnv('SUPABASE_URL');
const platformAccountId = requiredEnv('STRIPE_CONNECT_SANDBOX_ACCOUNT_ID');
const refresh = createConnectRefresher({
  supabaseUrl,
  serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  platformAccountId,
  provider: createConnectStatusProvider(
    requiredEnv('STRIPE_SECRET_KEY'),
    platformAccountId,
  ),
});

Deno.serve(
  createConnectStatusHandler({
    supabaseUrl,
    anonKey: requiredEnv('SUPABASE_ANON_KEY'),
    refresh,
  }),
);
