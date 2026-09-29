import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { PLACEHOLDER_SESSION } from '@/features/session/placeholder-session';
import { getRouteAccess } from '@/features/session/route-access';
import { MobileQueryProvider } from '@/lib/query/query-provider';

export default function RootLayout() {
  const access = getRouteAccess(PLACEHOLDER_SESSION);

  return (
    <MobileQueryProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={access.auth}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>

        <Stack.Protected guard={access.onboarding}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>

        <Stack.Protected guard={access.client}>
          <Stack.Screen name="(client)" />
        </Stack.Protected>

        <Stack.Protected guard={access.barber}>
          <Stack.Screen name="(barber)" />
        </Stack.Protected>

        <Stack.Protected guard={access.modals}>
          <Stack.Screen name="(modals)" options={{ presentation: 'modal' }} />
        </Stack.Protected>
      </Stack>
      <StatusBar style="auto" />
    </MobileQueryProvider>
  );
}
