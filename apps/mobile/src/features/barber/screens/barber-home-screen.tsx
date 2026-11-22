import { BrandLockup, Button, Screen, spacing, useTheme } from '@quicktrimr/ui';
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { SignOutButton } from '@/features/auth/screens/sign-out-button';
import { ConnectCard } from '@/features/connect/connect-card';

export function BarberHomeScreen() {
  const { colors, typography } = useTheme();
  return (
    <Screen scroll contentContainerStyle={{ gap: spacing.xl }}>
      <BrandLockup />
      <View style={{ gap: spacing.sm }}>
        <Text style={typography.eyebrow}>YOUR CRAFT. YOUR BUSINESS.</Text>
        <Text accessibilityRole="header" style={typography.display}>
          Make it a good day.
        </Text>
        <Text style={typography.subhead}>
          Your availability, services and payment setup, all in one place.
        </Text>
      </View>
      <View style={{ gap: spacing.md }}>
        <Text style={typography.editorial}>Ready when you are.</Text>
        <Text style={typography.body}>
          Set your Available Now session when you’re ready to take requests.
        </Text>
        <Button
          label="Booking requests"
          size="large"
          onPress={() => router.navigate('/request-inbox')}
        />
        <Button
          label="Available Now"
          variant="secondary"
          onPress={() => router.push('/available-now')}
        />
        <Button
          label="Services & prices"
          variant="secondary"
          onPress={() => router.push('/barber-services')}
        />
      </View>
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingTop: spacing.lg,
          gap: spacing.md,
        }}
      >
        <Text style={typography.editorial}>Business essentials.</Text>
        <ConnectCard />
      </View>
      <SignOutButton />
    </Screen>
  );
}
