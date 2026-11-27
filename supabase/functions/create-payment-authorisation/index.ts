import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';

import { createPaymentAuthorisationHandler } from './handler.ts';
import { createAuthorisationProvider } from './stripe.ts';

Deno.serve(
  createPaymentAuthorisationHandler({
    ...supabaseRuntimeConfig((name) => Deno.env.get(name)),
    provider: createAuthorisationProvider(
      Deno.env.get('STRIPE_SECRET_KEY') ?? '',
      Deno.env.get('STRIPE_CONNECT_SANDBOX_ACCOUNT_ID') ?? '',
    ),
  }),
);
