import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';
import { createAuthorisationProvider } from '../create-payment-authorisation/stripe.ts';

import { createCaptureHandler } from './handler.ts';
import { createRequestPaymentSweep } from './lifecycle.ts';
import { createCaptureProvider } from './stripe.ts';

const runtime = supabaseRuntimeConfig((name) => Deno.env.get(name));
const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const platform = Deno.env.get('STRIPE_CONNECT_SANDBOX_ACCOUNT_ID') ?? '';
const capture = createCaptureHandler({
  ...runtime,
  provider: createCaptureProvider(key, platform),
});
const sweep = createRequestPaymentSweep({
  ...runtime,
  capture,
  authorisation: createAuthorisationProvider(key, platform),
});
Deno.serve((request) =>
  new URL(request.url).pathname.endsWith('/capture-authorised-payment/sweep')
    ? sweep(request)
    : capture(request),
);
