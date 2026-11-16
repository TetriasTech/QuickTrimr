import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { mobileEnv } from '@/lib/env';

const storageOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export function createMobileSupabase() {
  if (Platform.OS === 'web')
    throw new Error('Native secure storage is required.');

  const url = mobileEnv.supabaseUrl;
  const storageHost = new URL(url).host.replace(/[^a-zA-Z0-9._-]/g, '_');
  return createClient(url, mobileEnv.supabaseAnonKey, {
    auth: {
      storageKey: `quicktrimr-auth-${storageHost}`,
      storage: {
        getItem: (key: string) => SecureStore.getItemAsync(key, storageOptions),
        setItem: (key: string, data: string) =>
          SecureStore.setItemAsync(key, data, storageOptions),
        removeItem: (key: string) =>
          SecureStore.deleteItemAsync(key, storageOptions),
      },
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

// A recovery token can change the password without opening marketplace routes
// or leaving a persisted login behind if the app closes mid-recovery.
export function createRecoverySupabase() {
  return createClient(mobileEnv.supabaseUrl, mobileEnv.supabaseAnonKey, {
    auth: {
      storageKey: 'quicktrimr-password-recovery',
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
