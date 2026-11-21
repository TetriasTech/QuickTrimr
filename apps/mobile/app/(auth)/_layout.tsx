import { Stack } from 'expo-router';

import { useBrandNavigationOptions } from '@/brand/navigation';

export default function AuthLayout() {
  const navigationOptions = useBrandNavigationOptions();
  return (
    <Stack screenOptions={navigationOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="ui-primitives"
        options={{ headerShown: true, title: 'UI primitives' }}
      />
      <Stack.Screen
        name="state-foundations"
        options={{ headerShown: true, title: 'State foundations' }}
      />
    </Stack>
  );
}
