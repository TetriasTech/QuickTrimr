import { createConnectOnboardingHandler } from './handler.ts';
import { createStripeConnect } from './stripe-connect.ts';

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing Edge runtime variable ${name}.`);
  return value;
}

const platformAccountId = requiredEnv('STRIPE_CONNECT_SANDBOX_ACCOUNT_ID');
Deno.serve(
  createConnectOnboardingHandler({
    supabaseUrl: requiredEnv('SUPABASE_URL'),
    anonKey: requiredEnv('SUPABASE_ANON_KEY'),
    serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    platformAccountId,
    stripe: createStripeConnect({
      key: requiredEnv('STRIPE_SECRET_KEY'),
      platformAccountId,
      returnUrl: requiredEnv('STRIPE_CONNECT_RETURN_URL'),
      refreshUrl: requiredEnv('STRIPE_CONNECT_REFRESH_URL'),
    }),
  }),
);
