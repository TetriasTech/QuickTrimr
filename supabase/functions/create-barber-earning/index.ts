import { createEarningHandler } from '../_shared/services/earning-handlers.ts';
import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';

Deno.serve(
  createEarningHandler(supabaseRuntimeConfig((name) => Deno.env.get(name))),
);
