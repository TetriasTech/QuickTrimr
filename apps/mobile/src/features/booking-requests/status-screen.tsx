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
import { focusManager, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { PaymentCaptureNotice } from '@/features/payment-authorisation/payment-capture-notice';
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
  onPayment,
  onCancel,
}: {
  api: BookingRequestApi;
  userId: string;
  requestId: string | null;
  activeAvailableNow: boolean;
  focused: boolean;
  onDiscovery: () => void;
  onResolvedId: (id: string) => void;
  onPayment?: (id: string, recovery: boolean) => void;
  onCancel?: (id: string) => Promise<unknown>;
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
  const cancellation = useMutation({
    mutationFn: async (id: string) => onCancel?.(id),
    onSuccess: () => refetch(),
  });
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
              {request.paymentRequired
                ? 'Authorise payment to send your request'
                : 'Waiting for a reply'}
            </Text>
            {request.paymentRequired && remaining > 0 ? (
              <Text style={typography.body}>
                Your barber will see this request after your card hold is
                verified.
              </Text>
            ) : remaining > 0 ? (
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
          {request.paymentRequired && onPayment && remaining > 0 ? (
            <Button
              label="Continue to payment"
              onPress={() => onPayment(request.id, false)}
            />
          ) : null}
          {cancellation.isError ? (
            <Text accessibilityRole="alert" style={typography.body}>
              Could not cancel the request. Check its status and try again.
            </Text>
          ) : null}
          {onCancel ? (
            <Button
              label="Cancel request"
              variant="secondary"
              loading={cancellation.isPending}
              disabled={cancellation.isPending}
              onPress={() => cancellation.mutate(request.id)}
            />
          ) : null}
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
            {request.captureNotice ? (
              <PaymentCaptureNotice
                outcome={request.captureNotice}
                audience="client"
              />
            ) : null}
            {request.captureNotice === 'capture_failed' &&
            request.paymentRecoveryDeadline &&
            Date.parse(request.serverNow) >=
              Date.parse(request.paymentRecoveryDeadline) ? (
              <Text style={typography.body}>
                The payment recovery window ended. We’re checking the final
                payment status.
              </Text>
            ) : null}
          </Card>
          {request.status === REQUEST_STATUS_VALUE.ACCEPTED &&
          request.captureNotice === 'capture_failed' &&
          request.paymentRecoveryDeadline &&
          onPayment &&
          Date.parse(request.serverNow) <
            Date.parse(request.paymentRecoveryDeadline) ? (
            <Button
              label="Retry payment"
              onPress={() => onPayment(request.id, true)}
            />
          ) : null}
          {request.status === REQUEST_STATUS_VALUE.ACCEPTED &&
          request.captureNotice !== 'captured' ? (
            <Button
              label="Check status"
              loading={query.isFetching}
              onPress={() => refetch().catch(() => undefined)}
            />
          ) : null}
          <Button
            label={terminal[request.status].action}
            onPress={onDiscovery}
          />
        </>
      ) : null}
    </Screen>
  );
}
