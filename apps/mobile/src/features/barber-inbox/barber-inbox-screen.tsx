import { BOOKING_TYPE_VALUE } from '@quicktrimr/shared';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  radius,
  spacing,
  useTheme,
} from '@quicktrimr/ui';
import { formatAudCents } from '@quicktrimr/ui/presentation';
import {
  focusManager,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { distanceBandLabels } from '@/lib/presentation/distance';
import { queryKeys } from '@/lib/query/query-keys';

import type { BarberInboxApi, InboxCursor } from './barber-inbox-api';
import type { BarberRequestInboxWithJobSlot } from '@quicktrimr/validation';
import type { InfiniteData } from '@tanstack/react-query';

type Request = BarberRequestInboxWithJobSlot['requests'][number];
type Page = BarberRequestInboxWithJobSlot & { observedAt: number };

const requestedTime = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'full',
  timeStyle: 'short',
});

function formatCountdown(seconds: number) {
  const twoDigits = (value: number) => String(value).padStart(2, '0');
  const minutes = Math.floor(seconds / 60);
  const tail = `${twoDigits(minutes % 60)}:${twoDigits(seconds % 60)}`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${tail}` : tail;
}

function InboxCard({
  request,
  remainingSeconds,
  occupied,
}: {
  request: Request;
  remainingSeconds: number;
  occupied: boolean;
}) {
  const { colors, typography } = useTheme();
  if (remainingSeconds <= 0) {
    return (
      <Card>
        <Text style={typography.headline}>Request expired</Text>
        <Text style={typography.caption}>The response window has ended.</Text>
      </Card>
    );
  }
  const immediate = request.bookingType === BOOKING_TYPE_VALUE.AVAILABLE_NOW;
  const typeColor = immediate ? colors.onAccent : colors.text;
  const timeLeft = formatCountdown(remainingSeconds);
  return (
    <Card
      style={{
        gap: spacing.md,
        borderColor: immediate ? colors.accent : colors.border,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.compact,
        }}
      >
        <View
          style={{
            backgroundColor: immediate ? colors.accent : colors.surfaceMuted,
            borderRadius: radius.full,
            paddingHorizontal: spacing.compact,
            paddingVertical: spacing.xs,
          }}
        >
          <Text style={[typography.caption, { color: typeColor }]}>
            {immediate ? 'Available Now' : 'Scheduled'}
          </Text>
        </View>
        <View accessible accessibilityLabel={`Time to respond ${timeLeft}`}>
          <Text style={typography.caption}>Time to respond</Text>
          <Text
            style={[
              typography.price,
              { fontVariant: ['tabular-nums'], color: colors.accent },
            ]}
          >
            {timeLeft}
          </Text>
        </View>
      </View>
      <View style={{ gap: spacing.xs }}>
        <Text accessibilityRole="header" style={typography.headline}>
          {request.serviceName}
        </Text>
        <Text style={typography.body}>
          {formatAudCents(request.priceCents)}
        </Text>
        <Text style={typography.body}>{request.clientDisplayName}</Text>
        <Text style={typography.caption}>
          {request.suburb}
          {request.distanceBand
            ? ` · ${distanceBandLabels[request.distanceBand]}`
            : ''}
        </Text>
      </View>
      {request.scheduledFor ? (
        <View style={{ gap: spacing.xs }}>
          <Text style={typography.caption}>Requested time</Text>
          <Text style={typography.body}>
            {requestedTime.format(new Date(request.scheduledFor))}
          </Text>
        </View>
      ) : null}
      {immediate && occupied ? (
        <Text style={[typography.body, { color: colors.warning }]}>
          You already have an active Available Now job. This request can’t be
          accepted while that job is active.
        </Text>
      ) : null}
    </Card>
  );
}

export function BarberInboxScreen({
  api,
  userId,
  focused,
  onAvailability,
}: {
  api: BarberInboxApi;
  userId: string;
  focused: boolean;
  onAvailability: () => void;
}) {
  const cache = useQueryClient();
  const key = useMemo(
    () => queryKeys.bookingRequests.barberInbox(userId),
    [userId],
  );
  const inbox = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as InboxCursor,
    queryFn: async ({ signal, pageParam }) => ({
      ...(await api.read(pageParam, signal)),
      observedAt: performance.now(),
    }),
    getNextPageParam: (page) => page.nextCursor,
    enabled: focused,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { refetch } = inbox;
  const restartAtFirstPage = useCallback(() => {
    cache.cancelQueries({ queryKey: key, exact: true }).catch(() => undefined);
    cache.setQueryData<InfiniteData<Page, InboxCursor>>(key, (data) =>
      data && data.pages.length > 1
        ? { pages: data.pages.slice(0, 1), pageParams: [null] }
        : data,
    );
  }, [cache, key]);
  const refresh = useCallback(() => {
    restartAtFirstPage();
    refetch().catch(() => undefined);
  }, [refetch, restartAtFirstPage]);

  useEffect(() => {
    if (!focused) return;
    const unsubscribe = focusManager.subscribe((foreground) => {
      if (foreground) refresh();
    });
    // A covered or popped screen discards its continuation so the next
    // enabled fetch starts from the currently pending first page.
    return () => {
      unsubscribe();
      restartAtFirstPage();
    };
  }, [focused, refresh, restartAtFirstPage]);

  const pages = inbox.data?.pages;
  const latest = pages?.at(-1);
  const items = useMemo(() => {
    const unique = new Map<string, { request: Request; deadline: number }>();
    for (const page of pages ?? []) {
      const shift = page.observedAt - Date.parse(page.serverNow);
      for (const request of page.requests) {
        if (!unique.has(request.id)) {
          unique.set(request.id, {
            request,
            deadline: Date.parse(request.expiresAt) + shift,
          });
        }
      }
    }
    return [...unique.values()];
  }, [pages]);
  const [tick, setTick] = useState(() => performance.now());
  const observedNow = Math.max(tick, latest?.observedAt ?? 0);
  const ticking = items.some(({ deadline }) => deadline > observedNow);
  useEffect(() => {
    if (!focused || !ticking) return;
    const timer = setInterval(() => {
      if (focusManager.isFocused()) setTick(performance.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [focused, ticking]);

  const empty = inbox.isSuccess && !inbox.isFetching && items.length === 0;
  const availability = useQuery({
    queryKey: queryKeys.availability.state(userId),
    queryFn: ({ signal }) => api.readAvailability(signal),
    enabled: focused && empty,
  });
  const inboxError = inbox.isError || inbox.fetchStatus === 'paused';
  const availabilityError =
    availability.isError || availability.fetchStatus === 'paused';

  return (
    <Screen edges={['right', 'bottom', 'left']}>
      <FlatList
        data={items}
        keyExtractor={({ request }) => request.id}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}
        refreshing={items.length > 0 && inbox.isRefetching}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <InboxCard
            request={item.request}
            remainingSeconds={Math.ceil((item.deadline - observedNow) / 1000)}
            occupied={latest?.hasActiveAvailableNowJob ?? false}
          />
        )}
        ListHeaderComponent={
          inboxError ? (
            <ErrorState
              message="Could not refresh booking requests."
              onRetry={refresh}
            />
          ) : null
        }
        ListEmptyComponent={
          inboxError ? null : !empty ? (
            <LoadingState message="Checking booking requests…" />
          ) : availabilityError ? (
            <ErrorState
              message="Could not check your availability."
              onRetry={() => availability.refetch().catch(() => undefined)}
            />
          ) : availability.isFetching || !availability.data ? (
            <LoadingState message="Checking availability…" />
          ) : availability.data.session?.isActive ? (
            <EmptyState message="You’re Available Now. New requests will appear here." />
          ) : (
            <EmptyState
              message="You’re not Available Now. Turn on availability to receive Available Now requests."
              action={{ label: 'Manage availability', onPress: onAvailability }}
            />
          )
        }
        ListFooterComponent={
          inbox.hasNextPage && !inboxError ? (
            <Button
              label="Load more requests"
              variant="secondary"
              disabled={inbox.isFetching}
              loading={inbox.isFetchingNextPage}
              onPress={() =>
                inbox
                  .fetchNextPage({ cancelRefetch: false })
                  .catch(() => undefined)
              }
            />
          ) : null
        }
      />
    </Screen>
  );
}
