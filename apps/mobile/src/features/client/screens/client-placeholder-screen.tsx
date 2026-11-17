import { Button } from '@quicktrimr/ui';
import { useRouter } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { SignOutButton } from '@/features/auth/screens/sign-out-button';

export function ClientPlaceholderScreen() {
  const router = useRouter();
  return (
    <PlaceholderScreen
      title="Client journey"
      description="Client marketplace features will mount inside this route group."
    >
      <Button
        label="Service addresses"
        onPress={() => router.push('/addresses')}
      />
      <SignOutButton />
    </PlaceholderScreen>
  );
}
