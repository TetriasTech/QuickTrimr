import { EmptyState, Screen } from '@quicktrimr/ui';
import { postgresUuidSchema } from '@quicktrimr/validation';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useCallback, useMemo } from 'react';

import {
  bookingRequestApi,
  cancelPendingBookingRequest,
} from '@/features/booking-requests/booking-request-api';
import { BookingRequestStatusScreen } from '@/features/booking-requests/status-screen';
import { useMobileSession } from '@/features/session/session-provider';

export default function RequestStatusRoute() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const focused = useIsFocused();
  const { userId, supabase } = useMobileSession();
  const api = useMemo(
    () => bookingRequestApi(supabase, userId ?? ''),
    [supabase, userId],
  );
  const discovery = () => router.dismissTo('/(client)');
  const resolvedId = useCallback(
    (id: string) => {
      router.replace({
        pathname: '/requests/[requestId]',
        params: { requestId: id },
      });
    },
    [router],
  );
  const active = requestId === 'active';
  const latest = requestId === 'latest';
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Request status',
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
      {userId &&
      (active || latest || postgresUuidSchema.safeParse(requestId).success) ? (
        <BookingRequestStatusScreen
          api={api}
          userId={userId}
          requestId={active || latest ? null : requestId}
          activeAvailableNow={active}
          focused={focused}
          onDiscovery={discovery}
          onResolvedId={resolvedId}
          onPayment={(id, recovery) =>
            router.push({
              pathname: '/sandbox-payment/[requestId]',
              params: {
                requestId: id,
                ...(recovery ? { recovery: 'yes' } : {}),
              },
            })
          }
          onCancel={(id) => cancelPendingBookingRequest(supabase, userId, id)}
        />
      ) : (
        <Screen edges={['right', 'bottom', 'left']}>
          <EmptyState
            message="This request link is unavailable."
            action={{ label: 'Back to discovery', onPress: discovery }}
          />
        </Screen>
      )}
    </>
  );
}
