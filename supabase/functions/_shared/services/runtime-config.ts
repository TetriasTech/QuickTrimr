export function supabaseRuntimeConfig(
  get: (name: string) => string | undefined,
) {
  function required(name: string) {
    const value = get(name);
    if (!value) throw new Error(`Missing Edge runtime variable ${name}.`);
    return value;
  }
  return {
    supabaseUrl: required('SUPABASE_URL'),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  };
}
