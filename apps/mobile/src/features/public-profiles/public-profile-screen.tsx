import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  spacing,
  radius,
  brand,
  useTheme,
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
  const { colors, typography } = useTheme();
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
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
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
            <View
              style={{
                backgroundColor: brand.palette.forest,
                borderRadius: radius.lg,
                padding: spacing.lg,
                gap: spacing.lg,
              }}
            >
              <Text
                style={[typography.eyebrow, { color: brand.palette.citrus }]}
              >
                MEET YOUR BARBER
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                }}
              >
                <Avatar
                  size="large"
                  initials={publicProfileInitials(profile.displayName)}
                  style={{ borderRadius: radius.md }}
                  {...(source ? { source } : {})}
                  accessibilityLabel={
                    source
                      ? `${profile.displayName} profile photo`
                      : `${profile.displayName} initials`
                  }
                />
                <View style={{ flex: 1, gap: spacing.sm }}>
                  <Text
                    selectable
                    accessibilityRole="header"
                    style={[typography.title, { color: brand.palette.ivory }]}
                  >
                    {profile.displayName}
                  </Text>
                  <Text
                    selectable
                    style={[typography.subhead, { color: brand.palette.sage }]}
                  >
                    {profile.approximateArea.label}
                  </Text>
                </View>
              </View>
              <Text style={[typography.caption, { color: brand.palette.sage }]}>
                Approximate service area
              </Text>
            </View>
            <View style={{ gap: spacing.compact, paddingVertical: spacing.md }}>
              <Text accessibilityRole="header" style={typography.editorial}>
                Behind the craft.
              </Text>
              <Text selectable style={typography.body}>
                {profile.bio || 'No bio added yet.'}
              </Text>
              <Text selectable style={typography.subhead}>
                {profile.yearsExperience}{' '}
                {profile.yearsExperience === 1 ? 'year' : 'years'} of experience
              </Text>
              <View
                style={{
                  paddingTop: spacing.md,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <Text selectable style={typography.subhead}>
                  {publicRatingLabel(profile)}
                </Text>
              </View>
            </View>
            {selectedServiceId ? (
              <Card
                style={{
                  backgroundColor: colors.surfaceMuted,
                  gap: spacing.compact,
                }}
              >
                <Text style={typography.eyebrow}>YOUR SELECTED SERVICE</Text>
                {selectedService ? (
                  <>
                    <Text style={typography.body}>
                      {selectedService.displayName}
                    </Text>
                    <Text style={typography.price}>
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
            <Text
              accessibilityRole="header"
              style={[typography.editorial, { marginTop: spacing.md }]}
            >
              The service menu.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={{
              paddingVertical: spacing.md,
              gap: spacing.sm,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: spacing.md,
              }}
            >
              <Text selectable style={[typography.headline, { flex: 1 }]}>
                {item.displayName}
              </Text>
              <Text
                selectable
                style={[typography.headline, { fontVariant: ['tabular-nums'] }]}
              >
                {formatAudCents(item.priceCents)}
              </Text>
            </View>
            {item.description ? (
              <Text selectable style={typography.subhead}>
                {item.description}
              </Text>
            ) : null}
            {item.serviceCategoryId === selectedServiceId?.toLowerCase() ? (
              <Text style={[typography.caption, { color: colors.accent }]}>
                Selected service
              </Text>
            ) : null}
          </View>
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
