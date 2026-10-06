import {
  requireEnvironmentUrl,
  requireEnvironmentValue,
} from '@quicktrimr/validation';

// Static dot notation is required for Expo's build-time substitution.
// Lazy getters keep unused integrations from requiring credentials at shell startup.
export const mobileEnv = {
  get supabaseUrl(): string {
    return requireEnvironmentUrl(
      process.env.EXPO_PUBLIC_SUPABASE_URL,
      'EXPO_PUBLIC_SUPABASE_URL',
    );
  },
  get supabaseAnonKey(): string {
    return requireEnvironmentValue(
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    );
  },
  get googleMapsAndroidApiKey(): string {
    return requireEnvironmentValue(
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY,
      'EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY',
    );
  },
  get googleMapsIosApiKey(): string {
    return requireEnvironmentValue(
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY,
      'EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY',
    );
  },
  get stripePublishableKey(): string {
    return requireEnvironmentValue(
      process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    );
  },
  get sentryDsn(): string {
    return requireEnvironmentUrl(
      process.env.EXPO_PUBLIC_SENTRY_DSN,
      'EXPO_PUBLIC_SENTRY_DSN',
    );
  },
  get posthogKey(): string {
    return requireEnvironmentValue(
      process.env.EXPO_PUBLIC_POSTHOG_KEY,
      'EXPO_PUBLIC_POSTHOG_KEY',
    );
  },
  get posthogHost(): string {
    return requireEnvironmentUrl(
      process.env.EXPO_PUBLIC_POSTHOG_HOST,
      'EXPO_PUBLIC_POSTHOG_HOST',
    );
  },
  get appEnvironment(): string {
    return requireEnvironmentValue(
      process.env.EXPO_PUBLIC_APP_ENV,
      'EXPO_PUBLIC_APP_ENV',
    );
  },
} as const;
