import { Stack } from 'expo-router';

// A profile deep link still has a native Back destination before search exists.
export const unstable_settings = { anchor: 'index' };

export default function ClientLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
