import { createBookingRequestHandler } from '../_shared/requests/handler.ts';
import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';
Deno.serve(
  createBookingRequestHandler(
    supabaseRuntimeConfig((name) => Deno.env.get(name)),
  ),
);
