import { USER_ROLE_VALUE } from '@quicktrimr/shared';

import { BarberProfileScreen } from '@/features/onboarding/screens/barber-profile-screen';
import { ClientProfileScreen } from '@/features/onboarding/screens/client-profile-screen';
import { OnboardingPlaceholderScreen } from '@/features/onboarding/screens/onboarding-placeholder-screen';
import { useMobileSession } from '@/features/session/session-provider';

export default function OnboardingRoute() {
  const { state, userId } = useMobileSession();
  if (
    state.status === 'signed-in' &&
    state.role === USER_ROLE_VALUE.CLIENT &&
    userId
  ) {
    return <ClientProfileScreen key={userId} userId={userId} />;
  }
  if (
    state.status === 'signed-in' &&
    state.role === USER_ROLE_VALUE.BARBER &&
    userId
  )
    return <BarberProfileScreen key={userId} userId={userId} />;
  return <OnboardingPlaceholderScreen />;
}
