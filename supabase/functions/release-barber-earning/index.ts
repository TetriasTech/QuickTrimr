import { releaseEarningHandler } from '../_shared/services/earning-handlers.ts';
import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';

Deno.serve(
  releaseEarningHandler(supabaseRuntimeConfig((name) => Deno.env.get(name))),
);
