import { createDiscoveryFiltersHandler } from '../_shared/discovery/filters.ts';
import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';
Deno.serve(
  createDiscoveryFiltersHandler(
    supabaseRuntimeConfig((name) => Deno.env.get(name)),
  ),
);
