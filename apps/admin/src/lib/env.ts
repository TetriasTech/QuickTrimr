import {
  requireEnvironmentUrl,
  requireEnvironmentValue,
} from '@quicktrimr/validation';

// Static dot notation is required for Next.js build-time substitution.
// This module is safe for browser imports; sensitive actions belong in Edge Functions.
export const adminEnv = {
  get supabaseUrl(): string {
    return requireEnvironmentUrl(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      'NEXT_PUBLIC_SUPABASE_URL',
    );
  },
  get supabaseAnonKey(): string {
    return requireEnvironmentValue(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
  },
  get googleMapsApiKey(): string {
    return requireEnvironmentValue(
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
      'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
    );
  },
  get sentryDsn(): string {
    return requireEnvironmentUrl(
      process.env.NEXT_PUBLIC_SENTRY_DSN,
      'NEXT_PUBLIC_SENTRY_DSN',
    );
  },
  get posthogKey(): string {
    return requireEnvironmentValue(
      process.env.NEXT_PUBLIC_POSTHOG_KEY,
      'NEXT_PUBLIC_POSTHOG_KEY',
    );
  },
  get posthogHost(): string {
    return requireEnvironmentUrl(
      process.env.NEXT_PUBLIC_POSTHOG_HOST,
      'NEXT_PUBLIC_POSTHOG_HOST',
    );
  },
  get appEnvironment(): string {
    return requireEnvironmentValue(
      process.env.NEXT_PUBLIC_APP_ENV,
      'NEXT_PUBLIC_APP_ENV',
    );
  },
} as const;
