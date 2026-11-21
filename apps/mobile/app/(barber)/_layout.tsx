import { Stack } from 'expo-router';

import { useBrandNavigationOptions } from '@/brand/navigation';

export default function BarberLayout() {
  const navigationOptions = useBrandNavigationOptions();
  return <Stack screenOptions={navigationOptions} />;
}
