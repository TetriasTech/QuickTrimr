import { Screen, spacing, typography } from '@quicktrimr/ui';
import { Text } from 'react-native';

import { SignOutButton } from '@/features/auth/screens/sign-out-button';
import { ConnectCard } from '@/features/connect/connect-card';

export function BarberPlaceholderScreen() {
  return (
    <Screen scroll contentContainerStyle={{ gap: spacing.lg }}>
      <Text style={typography.title}>Barber journey</Text>
      <Text style={typography.body}>
        Manage your Stripe setup while the remaining marketplace features are
        being prepared.
      </Text>
      <ConnectCard />
      <SignOutButton />
    </Screen>
  );
}
