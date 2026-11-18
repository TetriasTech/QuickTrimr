import { Button, Screen } from '@quicktrimr/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';

import { SignOutButton } from '@/features/auth/screens/sign-out-button';
import { ConnectCard } from '@/features/connect/connect-card';
import { useConnect } from '@/features/connect/connect-provider';
import { useMobileSession } from '@/features/session/session-provider';

// Public callback data is only a notification, never proof of verification.
export default function ConnectCallbackRoute() {
  const params = useLocalSearchParams<{ action?: string | string[] }>();
  const action =
    typeof params.action === 'string' &&
    (params.action === 'return' || params.action === 'refresh')
      ? params.action
      : undefined;
  const flow = useConnect();
  const { state } = useMobileSession();
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (handled.current === action) return;
    handled.current = action;
    flow.callback(action);
  }, [action, flow]);
  return (
    <Screen scroll>
      <ConnectCard />
      <Button
        label="Back to barber journey"
        variant="secondary"
        onPress={() =>
          router.replace(
            state.status === 'signed-in' && state.onboardingComplete
              ? '/(barber)'
              : '/onboarding',
          )
        }
      />
      <SignOutButton />
    </Screen>
  );
}
