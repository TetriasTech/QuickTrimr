import { BOOKING_TYPE_VALUE } from '@quicktrimr/shared';
import {
  Button,
  Card,
  ConfirmDialog,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { restrictionText } from '@/features/availability/availability-presentation';
import { EdgeFunctionError } from '@/lib/api/invoke-edge-function';
import { distanceBandLabels } from '@/lib/presentation/distance';
import { queryKeys } from '@/lib/query/query-keys';

import type { BarberInboxApi, InboxCursor } from './barber-inbox-api';
import type { BarberRequestInboxWithJobSlot } from '@quicktrimr/validation';
import type { InfiniteData } from '@tanstack/react-query';

type Request = BarberRequestInboxWithJobSlot['requests'][number];
type Page = BarberRequestInboxWithJobSlot & { observedAt: number };
type InboxItem = { request: Request; deadline: number };
type Action = 'accept' | 'decline';
type Interaction = { phase: 'confirm' | Action; item: InboxItem };
type Feedback = { message: string; bookingId?: string };

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
  disabled,
  standingBlocksAccept,
  submitting,
  onAccept,
  onDecline,
}: {
  request: Request;
  remainingSeconds: number;
  occupied: boolean;
  disabled: boolean;
  standingBlocksAccept: boolean;
  submitting: Action | null;
  onAccept: () => void;
  onDecline: () => void;
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Button
          label="Decline"
          accessibilityLabel={`Decline ${request.serviceName}`}
          variant="secondary"
          disabled={disabled}
          loading={submitting === 'decline'}
          onPress={onDecline}
          style={{ flexGrow: 1 }}
        />
        <Button
          label="Accept"
          accessibilityLabel={`Accept ${request.serviceName}`}
          disabled={disabled || standingBlocksAccept || (immediate && occupied)}
          loading={submitting === 'accept'}
          onPress={onAccept}
          style={{ flexGrow: 1 }}
        />
      </View>
    </Card>
  );
}

export function BarberInboxScreen({
  api,
  userId,
  focused,
  onAvailability,
  onBooking,
}: {
  api: BarberInboxApi;
  userId: string;
  focused: boolean;
  onAvailability: () => void;
  onBooking: (bookingId: string) => void;
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
  const refreshInbox = useCallback(
    (resolvedId?: string) => {
      restartAtFirstPage();
      if (resolvedId) {
        // The server confirmed this request has left the inbox. Keep it out of
        // the cached page even if the first-page read fails afterwards.
        cache.setQueryData<InfiniteData<Page, InboxCursor>>(
          key,
          (data) =>
            data && {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                requests: page.requests.filter(({ id }) => id !== resolvedId),
              })),
            },
        );
      }
      return refetch();
    },
    [cache, key, refetch, restartAtFirstPage],
  );
  const refresh = useCallback(() => {
    refreshInbox().catch(() => undefined);
  }, [refreshInbox]);

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
    const unique = new Map<string, InboxItem>();
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
  const [showStanding, setShowStanding] = useState(false);
  const availability = useQuery({
    queryKey: queryKeys.availability.state(userId),
    queryFn: ({ signal }) => api.readAvailability(signal),
    enabled: focused && (empty || showStanding),
  });
  const inboxError = inbox.isError || inbox.fetchStatus === 'paused';
  const availabilityError =
    availability.isError || availability.fetchStatus === 'paused';
  const standing =
    showStanding && !availabilityError ? availability.data : undefined;
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const { typography } = useTheme();

  function changeInteraction(value: Interaction | null) {
    interactionRef.current = value;
    setInteraction(value);
  }

  function blocksAcceptance(request: Request) {
    const immediate = request.bookingType === BOOKING_TYPE_VALUE.AVAILABLE_NOW;
    return (
      (showStanding && availability.isFetching) ||
      standing?.reliability.level === 'suspended' ||
      (immediate && standing?.reliability.availableNowAllowed === false)
    );
  }

  function confirmAcceptance(item: InboxItem) {
    if (interactionRef.current || inboxError || blocksAcceptance(item.request))
      return;
    if (
      item.request.bookingType === BOOKING_TYPE_VALUE.AVAILABLE_NOW &&
      latest?.hasActiveAvailableNowJob
    )
      return;
    if (performance.now() >= item.deadline) {
      setTick(performance.now());
      return;
    }
    changeInteraction({ phase: 'confirm', item });
  }

  async function sendAction(
    action: Action,
    item: InboxItem,
    confirmation?: Interaction,
  ) {
    if (interactionRef.current !== (confirmation ?? null)) return;
    if (!focused || !focusManager.isFocused()) {
      changeInteraction(null);
      return;
    }
    if (performance.now() >= item.deadline) {
      setTick(performance.now());
      setFeedback({ message: 'This request is no longer available.' });
      changeInteraction(null);
      return;
    }
    if (action === 'decline' && inboxError) return;
    changeInteraction({ phase: action, item });
    setFeedback(null);
    let resolvedId: string | undefined;
    try {
      const id = item.request.id;
      if (action === 'accept') {
        const accepted = await api.accept(id);
        setFeedback({
          message: 'Request accepted. Payment pending.',
          bookingId: accepted.bookingId,
        });
      } else {
        await api.decline(id);
        setFeedback({ message: 'Request declined.' });
      }
      resolvedId = id;
    } catch (error) {
      const conflict =
        error instanceof EdgeFunctionError && error.status === 409
          ? error.response.error
          : null;
      if (conflict === 'request_not_pending') {
        resolvedId = item.request.id;
        setFeedback({ message: 'This request is no longer available.' });
      } else if (conflict === 'active_job_exists') {
        setFeedback({
          message:
            'Finish your current Available Now job before accepting another.',
        });
      } else if (conflict === 'barber_unavailable') {
        setFeedback({ message: 'This request couldn’t be accepted.' });
        if (showStanding) availability.refetch().catch(() => undefined);
        else setShowStanding(true);
      } else {
        setFeedback({
          message:
            'Could not verify the response. Check the refreshed requests before trying again.',
        });
      }
    } finally {
      await refreshInbox(resolvedId).catch(() => undefined);
      changeInteraction(null);
    }
  }

  const confirmation = interaction?.phase === 'confirm' ? interaction : null;
  const acceptedBookingId = feedback?.bookingId;

  return (
    <Screen edges={['right', 'bottom', 'left']}>
      {feedback ? (
        <Card style={{ gap: spacing.sm }}>
          <Text accessibilityLiveRegion="polite" style={typography.body}>
            {feedback.message}
          </Text>
          {acceptedBookingId ? (
            <Button
              label="View booking status"
              size="small"
              onPress={() => onBooking(acceptedBookingId)}
            />
          ) : null}
        </Card>
      ) : null}
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
            disabled={interaction !== null || inboxError}
            standingBlocksAccept={blocksAcceptance(item.request)}
            submitting={
              interaction &&
              interaction.phase !== 'confirm' &&
              interaction.item.request.id === item.request.id
                ? interaction.phase
                : null
            }
            onAccept={() => confirmAcceptance(item)}
            onDecline={() => {
              sendAction('decline', item).catch(() => undefined);
            }}
          />
        )}
        ListHeaderComponent={
          inboxError || showStanding ? (
            <View style={{ gap: spacing.md }}>
              {inboxError ? (
                <ErrorState
                  message="Could not refresh booking requests."
                  onRetry={refresh}
                />
              ) : null}
              {showStanding ? (
                availabilityError ? (
                  <ErrorState
                    message="Could not check your standing."
                    onRetry={() =>
                      availability.refetch().catch(() => undefined)
                    }
                  />
                ) : availability.isFetching || !standing ? (
                  <LoadingState message="Checking your standing…" />
                ) : (
                  <Card style={{ gap: spacing.sm }}>
                    <Text style={typography.body}>
                      {restrictionText(standing)}
                    </Text>
                    <Button
                      label="Refresh standing"
                      variant="secondary"
                      size="small"
                      onPress={() =>
                        availability.refetch().catch(() => undefined)
                      }
                    />
                  </Card>
                )
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          inboxError ? null : !empty ? (
            <LoadingState message="Checking booking requests…" />
          ) : availabilityError ? (
            showStanding ? null : (
              <ErrorState
                message="Could not check your availability."
                onRetry={() => availability.refetch().catch(() => undefined)}
              />
            )
          ) : availability.isFetching || !availability.data ? (
            showStanding ? null : (
              <LoadingState message="Checking availability…" />
            )
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
      <ConfirmDialog
        visible={confirmation !== null}
        title="Accept this request?"
        consequence="Accepting commits you to this appointment. Check the booking status before travelling."
        confirmLabel="Accept request"
        onCancel={() => {
          if (confirmation && interactionRef.current === confirmation)
            changeInteraction(null);
        }}
        onConfirm={() => {
          if (confirmation)
            sendAction('accept', confirmation.item, confirmation).catch(
              () => undefined,
            );
        }}
      />
    </Screen>
  );
}
