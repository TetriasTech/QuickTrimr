import { PlaceholderScreen } from '@/components/placeholder-screen';
import { SignOutButton } from '@/features/auth/screens/sign-out-button';

export function OnboardingPlaceholderScreen() {
  return (
    <PlaceholderScreen
      title="Finish onboarding"
      description="Your barber account is ready. Finish your profile to continue."
    >
      <SignOutButton />
    </PlaceholderScreen>
  );
}
