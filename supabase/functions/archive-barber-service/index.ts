import { createBarberServiceHandler } from '../_shared/services/barber-service-handler.ts';
import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';
Deno.serve(
  createBarberServiceHandler({
    ...supabaseRuntimeConfig((name) => Deno.env.get(name)),
    operation: 'archive',
  }),
);
