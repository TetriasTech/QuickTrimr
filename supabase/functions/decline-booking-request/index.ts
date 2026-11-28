import { createBookingRequestActionHandler } from '../_shared/requests/action-handler.ts';
import { requestPaymentSweep } from '../_shared/requests/payment-sweep.ts';
import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';

const runtime = supabaseRuntimeConfig((name) => Deno.env.get(name));
Deno.serve(
  createBookingRequestActionHandler('decline', {
    ...runtime,
    reconcilePayment: requestPaymentSweep(runtime),
  }),
);
