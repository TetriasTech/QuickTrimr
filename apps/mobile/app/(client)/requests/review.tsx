import { EmptyState, Screen } from '@quicktrimr/ui';
import { createBookingRequestRequestSchema } from '@quicktrimr/validation';
import { Stack, useRouter } from 'expo-router';
import { useMemo } from 'react';

import { bookingRequestApi } from '@/features/booking-requests/booking-request-api';
import { BookingRequestReviewScreen } from '@/features/booking-requests/review-screen';
import { useMobileSession } from '@/features/session/session-provider';
import { useBookingDraftStore } from '@/stores/booking-draft-store';

export default function RequestReviewRoute() {
  const router = useRouter();
  const { userId, supabase } = useMobileSession();
  const draft = useBookingDraftStore();
  const api = useMemo(
    () => bookingRequestApi(supabase, userId ?? ''),
    [supabase, userId],
  );
  const parsed = createBookingRequestRequestSchema.safeParse({
    bookingType: draft.selectedBookingType,
    barberId: draft.selectedBarberId,
    serviceCategoryId: draft.selectedServiceCategoryId,
    clientAddressId: draft.selectedAddressId,
    ...(draft.scheduledFor ? { scheduledFor: draft.scheduledFor } : {}),
  });
  const edit = () => router.dismissTo('/(client)');
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Request review',
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
      {userId && parsed.success ? (
        <BookingRequestReviewScreen
          userId={userId}
          input={parsed.data}
          api={api}
          onEdit={edit}
          onSent={(requestId) => {
            draft.patchDraft({ selectedBarberId: null });
            router.replace({
              pathname: '/requests/[requestId]',
              params: { requestId },
            });
          }}
          onExisting={() =>
            router.push({
              pathname: '/requests/[requestId]',
              params: { requestId: 'active' },
            })
          }
        />
      ) : (
        <Screen edges={['right', 'bottom', 'left']}>
          <EmptyState
            message="Choose a barber and service address to start a request."
            action={{ label: 'Back to discovery', onPress: edit }}
          />
        </Screen>
      )}
    </>
  );
}
