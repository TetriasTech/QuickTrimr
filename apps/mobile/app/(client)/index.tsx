import { Stack, useRouter } from 'expo-router';

import { DiscoveryFiltersScreen } from '@/features/discovery/discovery-filters-screen';
import { useMobileSession } from '@/features/session/session-provider';
export default function ClientRoute() {
  const { userId } = useMobileSession();
  const router = useRouter();
  return userId ? (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Find a barber' }} />
      <DiscoveryFiltersScreen
        key={userId}
        userId={userId}
        onManageAddresses={() => router.push('/addresses')}
      />
    </>
  ) : null;
}
