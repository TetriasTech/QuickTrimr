import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';

import { createPublicBarberProfileHandler } from './handler.ts';

Deno.serve(
  createPublicBarberProfileHandler(
    supabaseRuntimeConfig((name) => Deno.env.get(name)),
  ),
);
