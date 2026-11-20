import { createDiscoveryHandler } from '../_shared/discovery/handler.ts';
import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';
Deno.serve(
  createDiscoveryHandler({
    ...supabaseRuntimeConfig((name) => Deno.env.get(name)),
    cursorKey: Deno.env.get('DISCOVERY_CURSOR_KEY') ?? '',
  }),
);
