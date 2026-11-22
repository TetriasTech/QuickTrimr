import { Stack, useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';

import { barberInboxApi } from '@/features/barber-inbox/barber-inbox-api';
import { BarberInboxScreen } from '@/features/barber-inbox/barber-inbox-screen';
import { useMobileSession } from '@/features/session/session-provider';

export default function BarberInboxRoute() {
  const { supabase, userId } = useMobileSession();
  const router = useRouter();
  const focused = useIsFocused();
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
          api={barberInboxApi(supabase, userId)}
          userId={userId}
          focused={focused}
          onAvailability={() => router.push('/available-now')}
        />
      ) : null}
    </>
  );
}
