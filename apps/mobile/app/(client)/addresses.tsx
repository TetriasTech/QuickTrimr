import { useRouter } from 'expo-router';

import { ClientAddressesScreen } from '@/features/addresses/client-addresses-screen';
import { useMobileSession } from '@/features/session/session-provider';

export default function ClientAddressesRoute() {
  const router = useRouter();
  const { userId } = useMobileSession();
  return userId ? (
    <ClientAddressesScreen
      key={userId}
      userId={userId}
      onBack={() => router.dismissTo('/')}
    />
  ) : null;
}
