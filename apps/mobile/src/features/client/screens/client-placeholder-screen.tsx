import { PlaceholderScreen } from '@/components/placeholder-screen';
import { SignOutButton } from '@/features/auth/screens/sign-out-button';

export function ClientPlaceholderScreen() {
  return (
    <PlaceholderScreen
      title="Client journey"
      description="Client marketplace features will mount inside this route group."
    >
      <SignOutButton />
    </PlaceholderScreen>
  );
}
