import { BOOKING_STATUS_VALUE } from '@quicktrimr/shared';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  StatusBadge,
  spacing,
  useTheme,
} from '@quicktrimr/ui';
import { skipToken, useQuery } from '@tanstack/react-query';
import { Text } from 'react-native';

import { queryKeys } from '@/lib/query/query-keys';

import type { BarberInboxApi } from './barber-inbox-api';

export function BarberBookingStatusScreen({
  read,
  bookingId,
  userId,
  focused,
  onInbox,
}: {
  read: BarberInboxApi['readBookingStatus'];
  bookingId: string | null;
  userId: string;
  focused: boolean;
  onInbox: () => void;
}) {
  const { typography } = useTheme();
  const query = useQuery({
    queryKey: queryKeys.bookings.barberStatus(userId, bookingId ?? ''),
    queryFn: bookingId ? ({ signal }) => read(bookingId, signal) : skipToken,
    enabled: focused && bookingId !== null,
  });
  const unavailable = !bookingId || query.data === null;
  const failed = query.isError || query.fetchStatus === 'paused';
  return (
    <Screen edges={['right', 'bottom', 'left']} scroll>
      {failed ? (
        <ErrorState
          message="Could not check the booking status."
          onRetry={() => query.refetch().catch(() => undefined)}
        />
      ) : null}
      {unavailable ? (
        <EmptyState message="This booking is unavailable." />
      ) : !failed && query.data === undefined ? (
        <LoadingState message="Checking booking status…" />
      ) : null}
      {query.data ? (
        <Card style={{ gap: spacing.md }}>
          <StatusBadge status={query.data.status} />
          {query.data.status ===
          BOOKING_STATUS_VALUE.ACCEPTED_PENDING_PAYMENT ? (
            <Text style={typography.body}>
              You accepted this request. Wait for booking confirmation before
              travelling.
            </Text>
          ) : null}
          <Text style={typography.caption}>Booking reference</Text>
          <Text selectable style={typography.body}>
            {query.data.id}
          </Text>
        </Card>
      ) : null}
      <Button label="Back to requests" variant="secondary" onPress={onInbox} />
    </Screen>
  );
}
