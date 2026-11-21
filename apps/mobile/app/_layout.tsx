import {
  LoadingState,
  ErrorState,
  Screen,
  brand,
  brandAssets,
  sizes,
  spacing,
  useTheme,
} from '@quicktrimr/ui';
import { useFonts } from 'expo-font';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { brandFonts } from '@/brand/assets';
import { useBrandNavigationOptions } from '@/brand/navigation';
import { SignOutButton } from '@/features/auth/screens/sign-out-button';
import { ConnectProvider } from '@/features/connect/connect-provider';
import { getRouteAccess } from '@/features/session/route-access';
import {
  SessionProvider,
  useMobileSession,
} from '@/features/session/session-provider';
import { createMobileSupabase } from '@/lib/api/supabase';
import { MobileQueryProvider } from '@/lib/query/query-provider';

function RootNavigator() {
  const navigationOptions = useBrandNavigationOptions();
  const { state, retry, supabase, userId } = useMobileSession();
  if (state.status === 'loading')
    return (
      <Screen>
        <LoadingState message="Checking your session…" />
      </Screen>
    );
  if (state.status === 'profile-error') {
    return (
      <Screen>
        <ErrorState
          message="Could not load your QuickTrimr profile."
          onRetry={retry}
        />
        <SignOutButton />
      </Screen>
    );
  }
  const access = getRouteAccess(state);

  const navigation = (
    <>
      <Stack screenOptions={navigationOptions}>
        <Stack.Protected guard={access.connect}>
          <Stack.Screen name="connect" />
        </Stack.Protected>
        <Stack.Protected guard={access.availability}>
          <Stack.Screen
            name="available-now"
            options={{
              headerShown: true,
              title: 'Available Now',
              headerBackButtonDisplayMode: 'minimal',
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={access.services}>
          <Stack.Screen
            name="barber-services"
            options={{ headerShown: true, title: 'Services & prices' }}
          />
        </Stack.Protected>
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
    </>
  );
  return state.status === 'signed-in' && state.role === 'barber' && userId ? (
    <ConnectProvider key={userId} userId={userId} supabase={supabase}>
      {navigation}
    </ConnectProvider>
  ) : (
    navigation
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(brandFonts);
  const { colors } = useTheme();
  const [supabase] = useState(() => {
    try {
      return createMobileSupabase();
    } catch {
      return null;
    }
  });
  if (!fontsLoaded && !fontError)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: brand.palette.forest,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.lg,
        }}
      >
        <Image
          source={brandAssets.markInverse}
          style={{ width: sizes.markLarge, height: sizes.markLarge }}
          accessibilityLabel="QuickTrimr"
        />
        <ActivityIndicator color={brand.palette.citrus} />
      </View>
    );
  if (fontError)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colors.text }}>
          Please reopen QuickTrimr to finish loading.
        </Text>
      </View>
    );
  if (!supabase)
    return (
      <Screen>
        <Text accessibilityRole="alert">
          QuickTrimr sign-in requires a configured iOS or Android app.
        </Text>
      </Screen>
    );

  return (
    <MobileQueryProvider>
      <SessionProvider supabase={supabase}>
        <RootNavigator />
      </SessionProvider>
    </MobileQueryProvider>
  );
}
