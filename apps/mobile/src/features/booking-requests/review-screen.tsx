import { BOOKING_TYPE_VALUE } from '@quicktrimr/shared';
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
import { formatAudCents } from '@quicktrimr/ui/presentation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { EdgeFunctionError } from '@/lib/api/invoke-edge-function';
import { queryKeys } from '@/lib/query/query-keys';

import type { BookingRequestApi } from './booking-request-api';
import type { CreateBookingRequestRequest } from '@quicktrimr/validation';

export function BookingRequestReviewScreen({
  userId,
  input,
  api,
  onEdit,
  onSent,
  onExisting,
}: {
  userId: string;
  input: CreateBookingRequestRequest;
  api: BookingRequestApi;
  onEdit: () => void;
  onSent: (id: string) => void;
  onExisting: () => void;
}) {
  const { typography, colors } = useTheme();
  const cache = useQueryClient();
  const key = queryKeys.bookingRequests.review(userId, input);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.review(input, signal),
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const review = query.data;
  const running = useRef(false);
  const mounted = useRef(true);
  const preflight = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [showExisting, setShowExisting] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      preflight.current?.abort();
    };
  }, []);

  async function submit() {
    if (running.current || !review || review.scheduledIssue || scheduleError)
      return;
    running.current = true;
    const controller = new AbortController();
    preflight.current = controller;
    setBusy(true);
    setError(null);
    setShowExisting(false);
    try {
      const current = await api.review(input, controller.signal);
      if (controller.signal.aborted) return;
      if (
        !current ||
        current.scheduledIssue ||
        current.reviewToken !== review.reviewToken
      ) {
        cache.setQueryData(key, current);
        if (current && !current.scheduledIssue)
          setError('Your request details changed. Review them before sending.');
        return;
      }
      const result = await api.submit({
        ...input,
        reviewToken: current.reviewToken,
      });
      if (mounted.current) onSent(result.id);
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof EdgeFunctionError) {
        const { error: code, fields } = cause.response;
        if (fields?.scheduledFor) {
          setScheduleError(fields.scheduledFor);
          return;
        }
        if (fields?.clientAddressId) {
          setError(fields.clientAddressId);
          return;
        }
        if (cause.status === 409 && code === 'active_request_exists') {
          setShowExisting(true);
          setError(
            'You already have an Available Now request waiting for a reply.',
          );
          return;
        }
        if (cause.status === 409 && code === 'duplicate_request_intent') {
          setError(
            'You already requested this barber and service for that time.',
          );
          return;
        }
        if (cause.status === 409 && code === 'barber_unavailable') {
          setError(
            'This barber is no longer available for your request. Return to search to choose another.',
          );
          return;
        }
        if (cause.status === 409 && code === 'review_changed') {
          setError('Your request details changed. Review them before sending.');
          await query.refetch();
          return;
        }
      }
      setError('Could not send your request. You can try again.');
    } finally {
      preflight.current = null;
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const edge = ['right', 'bottom', 'left'] as const;
  if (review === undefined)
    return (
      <Screen edges={edge}>
        {query.isError || query.fetchStatus === 'paused' ? (
          <>
            <ErrorState
              message="Could not load your request details."
              onRetry={() => query.refetch().catch(() => undefined)}
            />
            <Button label="Edit request" variant="secondary" onPress={onEdit} />
          </>
        ) : (
          <LoadingState message="Loading your request…" />
        )}
      </Screen>
    );
  if (review === null)
    return (
      <Screen edges={edge}>
        <EmptyState
          message="This service is no longer available."
          action={{ label: 'Edit request', onPress: onEdit }}
        />
      </Screen>
    );

  const { address, cancellation } = review;
  const scheduled = input.bookingType === BOOKING_TYPE_VALUE.SCHEDULED;
  const issue = scheduleError ?? review.scheduledIssue;
  return (
    <Screen edges={edge} scroll contentContainerStyle={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <Text style={typography.editorial} accessibilityRole="header">
          Review your request
        </Text>
        <Text style={typography.subhead}>
          Check the details before you send.
        </Text>
      </View>
      <Card style={{ gap: spacing.md }}>
        <View style={{ gap: spacing.compact }}>
          <Text style={typography.caption}>
            {scheduled ? 'Scheduled' : 'Available Now'}
          </Text>
          <Text style={typography.title}>{review.serviceName}</Text>
          <Text style={typography.body}>with {review.barberName}</Text>
          <Text style={typography.price}>
            {formatAudCents(review.priceCents)}
          </Text>
        </View>
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingTop: spacing.md,
            gap: spacing.compact,
          }}
        >
          <Text style={typography.headline}>Service address</Text>
          <Text selectable style={typography.body}>
            {[address.unit, address.line1].filter(Boolean).join(' / ')}
            {'\n'}
            {address.suburb} {address.state} {address.postcode}
          </Text>
          {address.accessNotes ? (
            <Text style={typography.subhead}>{address.accessNotes}</Text>
          ) : null}
          {input.scheduledFor ? (
            <>
              <Text style={typography.headline}>Requested time</Text>
              <Text style={typography.body}>
                {new Date(input.scheduledFor).toLocaleString('en-AU', {
                  dateStyle: 'full',
                  timeStyle: 'short',
                })}
              </Text>
            </>
          ) : null}
        </View>
      </Card>
      <View style={{ gap: spacing.sm }}>
        <Text style={typography.headline} accessibilityRole="header">
          Payment and cancellation
        </Text>
        <Text style={typography.body}>
          No payment is collected for this request. When card payments are
          enabled, QuickTrimr will place a hold when you send a request and
          charge only after the barber accepts.
        </Text>
        <Text style={typography.body}>
          If you cancel before acceptance, any card hold will be released.
        </Text>
        <Text style={typography.body}>
          {cancellation.lateWindowHours !== null
            ? `After acceptance and payment, cancelling more than ${cancellation.lateWindowHours} hours before the appointment gives you a full refund. At ${cancellation.lateWindowHours} hours or less, you receive a ${cancellation.refundPct}% refund.`
            : `If you cancel after acceptance and payment, you receive a ${cancellation.refundPct}% refund.`}
        </Text>
        <Text style={typography.body}>
          If your barber cancels after payment, you receive a full refund.
        </Text>
      </View>
      <Text style={typography.subhead}>
        You cannot edit a request after you send it.
      </Text>
      {issue || error || query.isError ? (
        <Text accessibilityRole="alert" style={typography.body}>
          {issue ?? error ?? 'Could not refresh your request details.'}
        </Text>
      ) : null}
      {showExisting ? (
        <Button label="View existing request" onPress={onExisting} />
      ) : null}
      <Button
        label="Send request"
        disabled={
          busy || !!issue || showExisting || query.isError || query.isFetching
        }
        loading={busy}
        onPress={() => {
          submit().catch(() => undefined);
        }}
      />
      {query.isError ? (
        <Button
          label="Refresh details"
          variant="secondary"
          onPress={() => query.refetch().catch(() => undefined)}
        />
      ) : null}
      <Button
        label="Edit request"
        variant="secondary"
        disabled={busy}
        onPress={onEdit}
      />
    </Screen>
  );
}
