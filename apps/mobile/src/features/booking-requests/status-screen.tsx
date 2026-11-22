import { REQUEST_STATUS_VALUE } from '@quicktrimr/shared';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  spacing,
  useTheme,
} from '@quicktrimr/ui';
import { focusManager, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { queryKeys } from '@/lib/query/query-keys';

import type { BookingRequestApi } from './booking-request-api';
import type { RequestStatus } from '@quicktrimr/shared';

const terminal = {
  accepted: {
    title: 'Request accepted',
    message: 'Your barber accepted the request.',
    action: 'Back to discovery',
  },
  declined: {
    title: 'Request declined',
    message:
      'This barber declined your request. You can choose another barber.',
    action: 'Find another barber',
  },
  expired: {
    title: 'Request expired',
    message: 'The response window ended. You can send a new request.',
    action: 'Start a new search',
  },
  cancelled: {
    title: 'Request cancelled',
    message: 'This request has been cancelled.',
    action: 'Find a barber',
  },
} satisfies Record<
  Exclude<RequestStatus, 'pending'>,
  { title: string; message: string; action: string }
>;

export function BookingRequestStatusScreen({
  api,
  userId,
  requestId,
  activeAvailableNow,
  focused,
  onDiscovery,
  onResolvedId,
}: {
  api: BookingRequestApi;
  userId: string;
  requestId: string | null;
  activeAvailableNow: boolean;
  focused: boolean;
  onDiscovery: () => void;
  onResolvedId: (id: string) => void;
}) {
  const { typography } = useTheme();
  const query = useQuery({
    queryKey: queryKeys.bookingRequests.status(
      userId,
      requestId,
      activeAvailableNow,
    ),
    queryFn: async ({ signal }) => ({
      request: await api.status(requestId, activeAvailableNow, signal),
      receivedAt: performance.now(),
    }),
    enabled: focused,
  });
  const [tick, setTick] = useState(() => performance.now());
  const checkedDeadline = useRef<string | null>(null);
  const sample = query.data;
  const request = sample?.request;
  const pending = request?.status === REQUEST_STATUS_VALUE.PENDING;
  const deadline = pending ? `${request.id}:${request.expiresAt}` : null;
  const remaining =
    pending && sample
      ? Math.max(
          0,
          Math.ceil(
            (Date.parse(request.expiresAt) -
              Date.parse(request.serverNow) -
              Math.max(0, tick - sample.receivedAt)) /
              1000,
          ),
        )
      : 0;
  const { refetch } = query;
  const deadlineReached = remaining === 0;

  useEffect(() => {
    if (!deadline || !focused || deadlineReached) return;
    const timer = setInterval(() => {
      if (focusManager.isFocused()) setTick(performance.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, focused, deadlineReached]);

  useEffect(() => {
    if (
      !focused ||
      !deadline ||
      remaining !== 0 ||
      checkedDeadline.current === deadline
    )
      return;
    checkedDeadline.current = deadline;
    refetch().catch(() => undefined);
  }, [deadline, focused, refetch, remaining]);

  useEffect(() => {
    if (focused && activeAvailableNow && request?.id) onResolvedId(request.id);
  }, [activeAvailableNow, focused, onResolvedId, request?.id]);

  return (
    <Screen
      edges={['right', 'bottom', 'left']}
      scroll
      contentContainerStyle={{ gap: spacing.lg }}
    >
      {query.isError || query.fetchStatus === 'paused' ? (
        <ErrorState
          message="Could not check the request status."
          onRetry={() => refetch().catch(() => undefined)}
        />
      ) : null}
      {request === undefined &&
      !query.isError &&
      query.fetchStatus !== 'paused' ? (
        <LoadingState message="Checking your request…" />
      ) : null}
      {request === null ? (
        <EmptyState
          message={
            activeAvailableNow
              ? 'There is no active Available Now request.'
              : 'No request found.'
          }
          action={{ label: 'Back to discovery', onPress: onDiscovery }}
        />
      ) : null}
      {request && request.status === REQUEST_STATUS_VALUE.PENDING ? (
        <>
          <Card style={{ gap: spacing.md }}>
            <Text style={typography.editorial} accessibilityRole="header">
              Waiting for a reply
            </Text>
            {remaining > 0 ? (
              <View style={{ gap: spacing.compact }}>
                <Text style={typography.caption}>Time left to respond</Text>
                <Text
                  style={[typography.price, { fontVariant: ['tabular-nums'] }]}
                >
                  {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, '0')}
                </Text>
              </View>
            ) : (
              <Text style={typography.body}>
                The response window has ended. Check for the latest status.
              </Text>
            )}
          </Card>
          <Button
            label="Check status"
            loading={query.isFetching}
            onPress={() => refetch().catch(() => undefined)}
          />
          <Button
            label="Back to discovery"
            variant="secondary"
            onPress={onDiscovery}
          />
        </>
      ) : null}
      {request && request.status !== REQUEST_STATUS_VALUE.PENDING ? (
        <>
          <Card style={{ gap: spacing.md }}>
            <Text style={typography.editorial} accessibilityRole="header">
              {terminal[request.status].title}
            </Text>
            <Text style={typography.body}>
              {terminal[request.status].message}
            </Text>
          </Card>
          <Button
            label={terminal[request.status].action}
            onPress={onDiscovery}
          />
        </>
      ) : null}
    </Screen>
  );
}
