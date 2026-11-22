import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useMemo } from 'react';

import { publicProfileApi } from '@/features/public-profiles/public-profile-api';
import { PublicBarberProfileScreen } from '@/features/public-profiles/public-profile-screen';
import { useMobileSession } from '@/features/session/session-provider';
import { mobileEnv } from '@/lib/env';
import { useBookingDraftStore } from '@/stores/booking-draft-store';

export default function BarberProfileRoute() {
  const { barberId, serviceCategoryId } = useLocalSearchParams<{
    barberId: string;
    serviceCategoryId?: string;
  }>();
  const { supabase, userId } = useMobileSession();
  const router = useRouter();
  const active = useIsFocused();
  const canReview = useBookingDraftStore(
    (draft) =>
      draft.selectedBarberId === barberId &&
      !!serviceCategoryId &&
      draft.selectedServiceCategoryId === serviceCategoryId &&
      !!draft.selectedBookingType &&
      !!draft.selectedAddressId,
  );
  const api = useMemo(
    () => publicProfileApi(supabase, userId ?? '', barberId, serviceCategoryId),
    [supabase, userId, barberId, serviceCategoryId],
  );
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Barber profile',
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
      {userId ? (
        <PublicBarberProfileScreen
          key={`${userId}:${barberId}`}
          userId={userId}
          barberId={barberId}
          selectedServiceId={serviceCategoryId}
          api={api}
          active={active}
          photoBaseUrl={mobileEnv.supabaseUrl}
          {...(canReview
            ? { onReviewRequest: () => router.push('/requests/review') }
            : {})}
          onBack={() =>
            router.canGoBack() ? router.back() : router.replace('/(client)')
          }
        />
      ) : null}
    </>
  );
}
