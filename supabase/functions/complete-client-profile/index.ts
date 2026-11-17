import { createCompleteClientProfileHandler } from './handler.ts';

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing Edge runtime variable ${name}.`);
  return value;
}

Deno.serve(
  createCompleteClientProfileHandler({
    supabaseUrl: requiredEnv('SUPABASE_URL'),
    anonKey: requiredEnv('SUPABASE_ANON_KEY'),
    serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  }),
);
