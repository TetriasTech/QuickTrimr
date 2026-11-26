import { Stack, useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useMemo } from 'react';

import { barberInboxApi } from '@/features/barber-inbox/barber-inbox-api';
import { BarberInboxScreen } from '@/features/barber-inbox/barber-inbox-screen';
import { useMobileSession } from '@/features/session/session-provider';

export default function BarberInboxRoute() {
  const { supabase, userId } = useMobileSession();
  const router = useRouter();
  const focused = useIsFocused();
  const api = useMemo(
    () => barberInboxApi(supabase, userId ?? ''),
    [supabase, userId],
  );
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Booking requests',
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
      {userId ? (
        <BarberInboxScreen
          key={userId}
          api={api}
          userId={userId}
          focused={focused}
          onAvailability={() => router.push('/available-now')}
          onBooking={(bookingId) =>
            router.push({
              pathname: '/(barber)/bookings/[bookingId]',
              params: { bookingId },
            })
          }
        />
      ) : null}
    </>
  );
}
