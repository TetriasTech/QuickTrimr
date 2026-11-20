import { BOOKING_TYPE_VALUE } from '@quicktrimr/shared';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  spacing,
  typography,
} from '@quicktrimr/ui';
import { formatAudCents } from '@quicktrimr/ui/presentation';
import { memo, useCallback } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import {
  publicProfileInitials,
  publicRatingLabel,
} from '@/features/public-profiles/public-profile-presentation';

import type { SearchAvailableNowBarbersResponse } from '@quicktrimr/validation';
import type { ReactElement, RefObject } from 'react';
import type { ListRenderItemInfo } from 'react-native';

type Result = SearchAvailableNowBarbersResponse['results'][number];
const distanceLabels: Record<Result['distanceBand'], string> = {
  'under-2km': 'Under 2 km away',
  '2-5km': '2–5 km away',
  '5-10km': '5–10 km away',
  '10km+': '10 km or more away',
};
const ResultCard = memo(function ResultCard({
  result,
  serviceName,
  bookingType,
  photoBaseUrl,
  onSelect,
}: {
  result: Result;
  serviceName: string;
  bookingType: string | null;
  photoBaseUrl: string;
  onSelect: (barberId: string) => void;
}) {
  const availability =
    bookingType === BOOKING_TYPE_VALUE.AVAILABLE_NOW && result.availableUntil
      ? `Available Now until ${new Date(result.availableUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Scheduled · barber confirms the requested time';
  const rating = publicRatingLabel(result);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${result.displayName}, ${serviceName}, ${formatAudCents(result.priceCents)}. ${result.approximateArea.label}, approximate service area. ${distanceLabels[result.distanceBand]}. ${rating}. ${availability}.`}
      onPress={() => onSelect(result.barberId)}
    >
      <Card variant="outlined">
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
          }}
        >
          <Avatar
            initials={publicProfileInitials(result.displayName)}
            {...(result.photoUrl
              ? { source: { uri: new URL(result.photoUrl, photoBaseUrl).href } }
              : {})}
            accessibilityLabel={`${result.displayName} profile photo`}
          />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={typography.headline}>{result.displayName}</Text>
            <Text style={typography.body}>
              {serviceName} · {formatAudCents(result.priceCents)}
            </Text>
          </View>
        </View>
        <Text style={typography.body}>
          {result.approximateArea.label} · Approximate service area
        </Text>
        <Text style={typography.body}>
          {distanceLabels[result.distanceBand]}
        </Text>
        <Text style={typography.body}>{rating}</Text>
        <Text style={typography.caption}>{availability}</Text>
      </Card>
    </Pressable>
  );
});
const keyExtractor = (result: Result) => result.barberId;

export function DiscoveryResultsList({
  listRef,
  header,
  footer,
  results,
  serviceName,
  bookingType,
  photoBaseUrl,
  complete,
  loading,
  refreshing,
  fetchingNextPage,
  hasNextPage,
  error,
  onRefresh,
  onMore,
  onSelect,
  onWidenRadius,
  onChangeService,
  onTryScheduled,
}: {
  listRef: RefObject<FlatList<Result> | null>;
  header: ReactElement;
  footer: ReactElement;
  results: Result[];
  serviceName: string;
  bookingType: string | null;
  photoBaseUrl: string;
  complete: boolean;
  loading: boolean;
  refreshing: boolean;
  fetchingNextPage: boolean;
  hasNextPage: boolean;
  error: string | null;
  onRefresh: () => void;
  onMore: () => void;
  onSelect: (barberId: string) => void;
  onWidenRadius: () => void;
  onChangeService: () => void;
  onTryScheduled: () => void;
}) {
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Result>) => (
      <ResultCard
        result={item}
        serviceName={serviceName}
        bookingType={bookingType}
        photoBaseUrl={photoBaseUrl}
        onSelect={onSelect}
      />
    ),
    [serviceName, bookingType, photoBaseUrl, onSelect],
  );
  return (
    <Screen
      edges={['right', 'bottom', 'left']}
      contentContainerStyle={{ flex: 1, padding: 0 }}
    >
      <FlatList
        ref={listRef}
        testID="barber-results"
        data={results}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        refreshing={refreshing}
        onRefresh={complete ? onRefresh : undefined}
        onEndReached={
          hasNextPage && !error && !refreshing && !loading && !fetchingNextPage
            ? onMore
            : undefined
        }
        ListEmptyComponent={
          complete && !error && !loading && !refreshing ? (
            <EmptyState
              message="No barbers matched these filters. Try another service, a wider radius or Scheduled."
              action={{ label: 'Widen search radius', onPress: onWidenRadius }}
            />
          ) : null
        }
        ListFooterComponent={
          <View style={{ gap: spacing.md }}>
            {loading || refreshing ? (
              <LoadingState message="Updating nearby search…" />
            ) : null}
            {error ? <ErrorState message={error} onRetry={onRefresh} /> : null}
            {complete &&
            !error &&
            !loading &&
            !refreshing &&
            results.length === 0 ? (
              <>
                <Button
                  label="Choose another service"
                  variant="secondary"
                  onPress={onChangeService}
                />
                {bookingType !== BOOKING_TYPE_VALUE.SCHEDULED ? (
                  <Button
                    label="Try Scheduled"
                    variant="secondary"
                    onPress={onTryScheduled}
                  />
                ) : null}
              </>
            ) : null}
            {hasNextPage && !error ? (
              <Button
                label="Load more barbers"
                loading={fetchingNextPage}
                disabled={loading || refreshing}
                onPress={onMore}
              />
            ) : null}
            {results.length ? (
              <Text style={typography.caption}>
                Live results. Refresh after availability or prices change.
              </Text>
            ) : null}
            {footer}
          </View>
        }
      />
    </Screen>
  );
}
