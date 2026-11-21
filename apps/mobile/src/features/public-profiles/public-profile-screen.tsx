import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  colors,
  spacing,
  typography,
} from '@quicktrimr/ui';
import { formatAudCents } from '@quicktrimr/ui/presentation';
import {
  postgresUuidSchema,
  type PublicServicesCursor,
} from '@quicktrimr/validation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FlatList, Text, View } from 'react-native';

import { queryKeys } from '@/lib/query/query-keys';

import {
  publicProfileInitials,
  publicRatingLabel,
} from './public-profile-presentation';

import type { PublicProfileApi } from './public-profile-api';

export function PublicBarberProfileScreen({
  userId,
  barberId,
  selectedServiceId,
  api,
  photoBaseUrl,
  onBack,
  active = true,
}: {
  userId: string;
  barberId: string;
  selectedServiceId?: string | undefined;
  api: PublicProfileApi;
  photoBaseUrl: string;
  onBack: () => void;
  active?: boolean;
}) {
  const validId = postgresUuidSchema.safeParse(barberId).success;
  const query = useInfiniteQuery({
    queryKey: queryKeys.publicProfiles.detail(
      userId,
      barberId,
      selectedServiceId,
    ),
    queryFn: ({ pageParam, signal }) => api.page(pageParam, signal),
    initialPageParam: undefined as PublicServicesCursor | undefined,
    getNextPageParam: (page) => page.profile?.nextServicesCursor ?? undefined,
    enabled: active && validId,
  });
  // A later page can observe revoked eligibility. Its null result is authoritative.
  const profile = query.data?.pages.some((page) => page.profile === null)
    ? null
    : query.data?.pages[0]?.profile;
  if (!validId)
    return (
      <Screen>
        <EmptyState
          message="This barber profile link is invalid."
          action={{ label: 'Back', onPress: onBack }}
        />
      </Screen>
    );
  if (profile === undefined)
    return (
      <Screen>
        {query.isError ? (
          <ErrorState
            message="Could not load this barber profile."
            onRetry={() => {
              query.refetch().catch(() => undefined);
            }}
          />
        ) : query.fetchStatus === 'paused' ? (
          <ErrorState
            message="You’re offline. Reconnect to load this barber profile."
            onRetry={() => {
              query.refetch().catch(() => undefined);
            }}
          />
        ) : (
          <LoadingState message="Loading barber profile…" />
        )}
      </Screen>
    );
  if (profile === null)
    return (
      <Screen>
        <EmptyState
          message="This barber profile is unavailable. Go back to choose another barber."
          action={{ label: 'Back', onPress: onBack }}
        />
      </Screen>
    );
  const services = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.profile?.services ?? [])
        .map((service) => [service.id, service]),
    ).values(),
  ];
  const selectedService = query.data?.pages.at(-1)?.profile?.selectedService;
  const source = profile.photoUrl
    ? { uri: new URL(profile.photoUrl, photoBaseUrl).href }
    : undefined;
  return (
    <Screen
      edges={['right', 'bottom', 'left']}
      contentContainerStyle={{ flex: 1, padding: 0 }}
    >
      <FlatList
        data={services}
        keyExtractor={(service) => service.id}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
        contentInsetAdjustmentBehavior="automatic"
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => {
          query.refetch().catch(() => undefined);
        }}
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            {query.isError ? (
              <ErrorState
                message="Could not refresh all prices. Showing previously loaded details; try again for current prices."
                onRetry={() => {
                  query.refetch().catch(() => undefined);
                }}
              />
            ) : null}
            <View style={{ alignItems: 'center', gap: spacing.sm }}>
              <Avatar
                size="large"
                initials={publicProfileInitials(profile.displayName)}
                {...(source ? { source } : {})}
                accessibilityLabel={`${profile.displayName} profile photo`}
              />
              <Text selectable style={typography.title}>
                {profile.displayName}
              </Text>
              <Text selectable style={typography.body}>
                {profile.approximateArea.label}
              </Text>
              <Text selectable style={typography.caption}>
                Approximate service area
              </Text>
            </View>
            <Card>
              <Text accessibilityRole="header" style={typography.headline}>
                About
              </Text>
              <Text selectable style={typography.body}>
                {profile.bio || 'No bio added yet.'}
              </Text>
              <Text selectable style={typography.body}>
                {profile.yearsExperience}{' '}
                {profile.yearsExperience === 1 ? 'year' : 'years'} of experience
              </Text>
            </Card>
            <Card>
              <Text accessibilityRole="header" style={typography.headline}>
                Reviews
              </Text>
              <Text selectable style={typography.body}>
                {publicRatingLabel(profile)}
              </Text>
            </Card>
            {selectedServiceId ? (
              <Card variant="outlined">
                <Text style={typography.headline}>Your selected service</Text>
                {selectedService ? (
                  <>
                    <Text style={typography.body}>
                      {selectedService.displayName}
                    </Text>
                    <Text style={typography.headline}>
                      {formatAudCents(selectedService.priceCents)}
                    </Text>
                    <Text style={typography.caption}>
                      Current price. Prices can change before you send a
                      request.
                    </Text>
                  </>
                ) : (
                  <Text style={typography.body}>
                    This selected service is no longer available. Go back to
                    choose another service.
                  </Text>
                )}
              </Card>
            ) : null}
            <Text accessibilityRole="header" style={typography.headline}>
              Services & prices
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card
            variant={
              item.serviceCategoryId === selectedServiceId?.toLowerCase()
                ? 'outlined'
                : 'filled'
            }
          >
            <Text selectable style={typography.headline}>
              {item.displayName}
            </Text>
            {item.description ? (
              <Text selectable style={typography.body}>
                {item.description}
              </Text>
            ) : null}
            <Text
              selectable
              style={{
                ...typography.headline,
                color: colors.text,
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatAudCents(item.priceCents)}
            </Text>
            {item.serviceCategoryId === selectedServiceId?.toLowerCase() ? (
              <Text style={typography.caption}>Selected service</Text>
            ) : null}
          </Card>
        )}
        ListEmptyComponent={
          <EmptyState
            message="This barber has no active services listed. Go back to choose another barber."
            action={{ label: 'Back', onPress: onBack }}
          />
        }
        ListFooterComponent={
          query.hasNextPage ? (
            <Button
              label="More services"
              loading={query.isFetchingNextPage}
              onPress={() => {
                query.fetchNextPage().catch(() => undefined);
              }}
            />
          ) : null
        }
      />
    </Screen>
  );
}
