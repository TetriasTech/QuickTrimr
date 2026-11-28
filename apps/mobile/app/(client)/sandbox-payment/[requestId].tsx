import { EmptyState, Screen } from '@quicktrimr/ui';
import { postgresUuidSchema } from '@quicktrimr/validation';
import { StripeProvider } from '@stripe/stripe-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Platform } from 'react-native';

import { authoriseBookingRequest } from '@/features/booking-requests/booking-request-api';
import { PaymentAuthorisationScreen } from '@/features/payment-authorisation/payment-authorisation-screen';
import { useMobileSession } from '@/features/session/session-provider';
import { readStripeSandboxPublishableKey } from '@/lib/env';
import { queryKeys } from '@/lib/query/query-keys';

export default function SandboxPaymentRoute() {
  const { requestId, recovery } = useLocalSearchParams();
  const router = useRouter();
  const cache = useQueryClient();
  const id = postgresUuidSchema.safeParse(requestId);
  const { supabase, userId } = useMobileSession();
  const publishableKey =
    __DEV__ && Platform.OS !== 'web'
      ? readStripeSandboxPublishableKey()
      : undefined;
  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: 'Card authorisation' }}
      />
      {publishableKey && id.success && userId ? (
        <StripeProvider publishableKey={publishableKey} urlScheme="quicktrimr">
          <PaymentAuthorisationScreen
            key={userId + id.data}
            requestId={id.data}
            recovery={recovery === 'yes'}
            onDone={() => {
              cache
                .invalidateQueries({ queryKey: queryKeys.bookingRequests.all })
                .catch(() => undefined);
              router.replace({
                pathname: '/requests/[requestId]',
                params: { requestId: id.data },
              });
            }}
            authorise={(input) =>
              authoriseBookingRequest(supabase, userId, input)
            }
          />
        </StripeProvider>
      ) : (
        <Screen scroll>
          <EmptyState message="Card authorisation is unavailable." />
        </Screen>
      )}
    </>
  );
}
