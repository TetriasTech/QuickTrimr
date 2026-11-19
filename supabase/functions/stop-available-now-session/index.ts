import { createAvailableNowHandler } from '../_shared/availability/handler.ts';
import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';
Deno.serve(
  createAvailableNowHandler({
    ...supabaseRuntimeConfig((name) => Deno.env.get(name)),
    operation: 'stop',
  }),
);
