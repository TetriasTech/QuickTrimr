import { createAcceptBookingRequestHandler } from '../_shared/requests/accept-handler.ts';
import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';

Deno.serve(
  createAcceptBookingRequestHandler(
    supabaseRuntimeConfig((name) => Deno.env.get(name)),
  ),
);
