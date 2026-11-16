import { PlaceholderScreen } from '@/components/placeholder-screen';
import { SignOutButton } from '@/features/auth/screens/sign-out-button';
import { useMobileSession } from '@/features/session/session-provider';

export function OnboardingPlaceholderScreen() {
  const { state } = useMobileSession();
  const description =
    state.status === 'signed-in' && state.role === 'barber'
      ? 'Your barber account is ready. Finish your profile to continue.'
      : 'Your client account is ready. Finish your profile to continue.';
  return (
    <PlaceholderScreen title="Finish onboarding" description={description}>
      <SignOutButton />
    </PlaceholderScreen>
  );
}
