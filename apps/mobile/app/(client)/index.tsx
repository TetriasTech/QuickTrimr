import { Stack, useRouter } from 'expo-router';

import { DiscoveryFiltersScreen } from '@/features/discovery/discovery-filters-screen';
import { useMobileSession } from '@/features/session/session-provider';
import { mobileEnv } from '@/lib/env';
export default function ClientRoute() {
  const { userId } = useMobileSession();
  const router = useRouter();
  return userId ? (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Find a barber' }} />
      <DiscoveryFiltersScreen
        key={userId}
        photoBaseUrl={mobileEnv.supabaseUrl}
        userId={userId}
        onSelectBarber={(barberId, serviceCategoryId) =>
          router.push({
            pathname: '/barbers/[barberId]',
            params: { barberId, serviceCategoryId },
          })
        }
        onManageAddresses={() => router.push('/addresses')}
      />
    </>
  ) : null;
}
