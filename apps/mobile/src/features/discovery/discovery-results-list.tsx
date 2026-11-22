import { BOOKING_TYPE_VALUE } from '@quicktrimr/shared';
import {
  Avatar,
  brandAssets,
  sizes,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  spacing,
  radius,
  useTheme,
} from '@quicktrimr/ui';
import { formatAudCents } from '@quicktrimr/ui/presentation';
import { Image } from 'expo-image';
import { memo, useCallback } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import {
  publicProfileInitials,
  publicRatingLabel,
} from '@/features/public-profiles/public-profile-presentation';
import { distanceBandLabels } from '@/lib/presentation/distance';

import type { SearchAvailableNowBarbersResponse } from '@quicktrimr/validation';
import type { ReactElement, RefObject } from 'react';
import type { ListRenderItemInfo } from 'react-native';

type Result = SearchAvailableNowBarbersResponse['results'][number];
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
  const { colors, typography } = useTheme();
  const availability =
    bookingType === BOOKING_TYPE_VALUE.AVAILABLE_NOW && result.availableUntil
      ? `Available Now until ${new Date(result.availableUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Scheduled · barber confirms the requested time';
  const rating = publicRatingLabel(result);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${result.displayName}, ${serviceName}, ${formatAudCents(result.priceCents)}. ${result.approximateArea.label}, approximate service area. ${distanceBandLabels[result.distanceBand]}. ${rating}. ${availability}.`}
      onPress={() => onSelect(result.barberId)}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <Card style={{ gap: spacing.md }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.compact,
          }}
        >
          <Avatar
            initials={publicProfileInitials(result.displayName)}
            style={{ borderRadius: radius.md }}
            {...(result.photoUrl
              ? { source: { uri: new URL(result.photoUrl, photoBaseUrl).href } }
              : {})}
            accessibilityLabel={
              result.photoUrl
                ? `${result.displayName} profile photo`
                : `${result.displayName} initials`
            }
          />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={typography.headline}>{result.displayName}</Text>
            <Text style={typography.caption}>
              {result.approximateArea.label}
            </Text>
          </View>
          <View
            style={{ alignItems: 'flex-end', gap: spacing.xs, flexShrink: 1 }}
          >
            <Text style={typography.headline}>
              {formatAudCents(result.priceCents)}
            </Text>
            <Text style={typography.caption}>{serviceName}</Text>
          </View>
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: spacing.sm,
            paddingTop: spacing.compact,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Text style={[typography.caption, { color: colors.text }]}>
            {distanceBandLabels[result.distanceBand]}
          </Text>
          <Text style={typography.caption}>· {rating}</Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
          }}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: colors.surfaceMuted,
              paddingHorizontal: spacing.compact,
              paddingVertical: spacing.sm,
              borderRadius: radius.sm,
            }}
          >
            <Text style={[typography.caption, { color: colors.accent }]}>
              {availability}
            </Text>
          </View>
          <Image
            accessible={false}
            source={brandAssets.arrowIcon}
            tintColor={colors.accent}
            style={{ width: sizes.iconMedium, height: sizes.iconMedium }}
          />
        </View>
        <Text style={typography.caption}>Approximate service area</Text>
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
  continuationError,
  onRefresh,
  onMore,
  onSelect,
  onWidenRadius,
  onChangeService,
  onTryScheduled,
  autoLoadMore = true,
  emptyMessage,
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
  continuationError: boolean;
  onRefresh: () => void;
  onMore: () => void;
  onSelect: (barberId: string) => void;
  onWidenRadius: () => void;
  onChangeService: () => void;
  onTryScheduled: () => void;
  autoLoadMore?: boolean;
  emptyMessage?: string | undefined;
}) {
  const { typography } = useTheme();
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
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            {header}
            {loading || refreshing ? (
              <LoadingState message="Updating nearby search…" />
            ) : null}
            {error && !continuationError ? (
              <ErrorState message={error} onRetry={onRefresh} />
            ) : null}
          </View>
        }
        refreshing={refreshing}
        onRefresh={complete ? onRefresh : undefined}
        onEndReached={
          autoLoadMore &&
          hasNextPage &&
          !error &&
          !refreshing &&
          !loading &&
          !fetchingNextPage
            ? onMore
            : undefined
        }
        ListEmptyComponent={
          complete && !error && !loading && !refreshing ? (
            <EmptyState
              title="Nothing nearby just yet."
              message={
                emptyMessage ??
                'No barbers matched these filters. Try another service, a wider radius or Scheduled.'
              }
              action={{
                label: 'Widen search radius',
                onPress: onWidenRadius,
                variant: 'primary',
              }}
            />
          ) : null
        }
        ListFooterComponent={
          <View style={{ gap: spacing.md }}>
            {error && continuationError ? (
              <ErrorState message={error} onRetry={onRefresh} />
            ) : null}
            {complete &&
            !error &&
            !loading &&
            !refreshing &&
            results.length === 0 ? (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: spacing.xs,
                }}
              >
                <Button
                  label="Choose another service"
                  variant="ghost"
                  size="small"
                  onPress={onChangeService}
                />
                {bookingType !== BOOKING_TYPE_VALUE.SCHEDULED ? (
                  <Button
                    label="Try Scheduled"
                    variant="ghost"
                    size="small"
                    onPress={onTryScheduled}
                  />
                ) : null}
              </View>
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
