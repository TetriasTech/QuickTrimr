import { PlaceholderScreen } from '@/components/placeholder-screen';
import { SignOutButton } from '@/features/auth/screens/sign-out-button';

export function BarberPlaceholderScreen() {
  return (
    <PlaceholderScreen
      title="Barber journey"
      description="Barber marketplace features will mount inside this route group."
    >
      <SignOutButton />
    </PlaceholderScreen>
  );
}
