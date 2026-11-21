import { Stack } from 'expo-router';

import { useBrandNavigationOptions } from '@/brand/navigation';

// A profile deep link still has a native Back destination before search exists.
export const unstable_settings = { anchor: 'index' };

export default function ClientLayout() {
  const navigationOptions = useBrandNavigationOptions();
  return <Stack screenOptions={navigationOptions} />;
}
