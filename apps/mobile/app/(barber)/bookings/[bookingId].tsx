import { postgresUuidSchema } from '@quicktrimr/validation';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';

import { BarberBookingStatusScreen } from '@/features/barber-inbox/barber-booking-status-screen';
import { barberInboxApi } from '@/features/barber-inbox/barber-inbox-api';
import { useMobileSession } from '@/features/session/session-provider';

export default function BarberBookingStatusRoute() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams();
  const { supabase, userId } = useMobileSession();
  const focused = useIsFocused();
  const validId = postgresUuidSchema.safeParse(bookingId);
  const onInbox = () => router.dismissTo('/(barber)/request-inbox');
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Booking status',
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
      {userId ? (
        <BarberBookingStatusScreen
          key={userId}
          read={barberInboxApi(supabase, userId).readBookingStatus}
          bookingId={validId.success ? validId.data : null}
          userId={userId}
          focused={focused}
          onInbox={onInbox}
        />
      ) : null}
    </>
  );
}
