import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';

import { createCaptureHandler } from './handler.ts';
import { createCaptureProvider } from './stripe.ts';

Deno.serve(
  createCaptureHandler({
    ...supabaseRuntimeConfig((name) => Deno.env.get(name)),
    provider: createCaptureProvider(
      Deno.env.get('STRIPE_SECRET_KEY') ?? '',
      Deno.env.get('STRIPE_CONNECT_SANDBOX_ACCOUNT_ID') ?? '',
    ),
  }),
);
