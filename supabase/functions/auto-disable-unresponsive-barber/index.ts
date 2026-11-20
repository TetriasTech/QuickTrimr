import { createAvailabilityWorkerHandler } from '../_shared/availability/worker-handler.ts';
import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';
Deno.serve(
  createAvailabilityWorkerHandler(
    supabaseRuntimeConfig((name) => Deno.env.get(name)),
  ),
);
