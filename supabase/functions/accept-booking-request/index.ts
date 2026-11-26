import { createBookingRequestActionHandler } from '../_shared/requests/action-handler.ts';
import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';

Deno.serve(
  createBookingRequestActionHandler(
    'accept',
    supabaseRuntimeConfig((name) => Deno.env.get(name)),
  ),
);
