import { Host, Picker } from '@expo/ui';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  scheduledTimeIssue,
  schedulingWindow,
  discoveryRadiusIssue,
} from '@quicktrimr/domain';
import { BOOKING_TYPE_VALUE } from '@quicktrimr/shared';
import {
  Button,
  radius,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  TextInput,
  spacing,
  useTheme,
} from '@quicktrimr/ui';
import { discoveryRadiusFormSchema } from '@quicktrimr/validation';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { FlatList, Text, View } from 'react-native';

import { ClientAddressesScreen } from '@/features/addresses/client-addresses-screen';
import { SignOutButton } from '@/features/auth/screens/sign-out-button';
import { SERVICE_CATALOGUE_PAGE_SIZE } from '@/features/services/service-catalogue';
import { useMobileSession } from '@/features/session/session-provider';
import { EdgeFunctionError } from '@/lib/api/invoke-edge-function';
import { queryKeys } from '@/lib/query/query-keys';
import { useBookingDraftStore } from '@/stores/booking-draft-store';

import { discoveryApi } from './discovery-api';
import { DiscoveryMapScreen } from './discovery-map-screen';
import { DiscoveryResultsList } from './discovery-results-list';

import type { BookingDraftValues } from '@/stores/booking-draft-store';
import type {
  DiscoveryFilters,
  SearchAvailableNowBarbersRequest,
  SearchAvailableNowBarbersResponse,
} from '@quicktrimr/validation';
import type { ReactNode } from 'react';

function radiusIssue(radius: number, inputs: DiscoveryFilters) {
  return discoveryRadiusIssue(radius, inputs.radiusKm);
}
export function DiscoveryFiltersScreen({
  userId,
  onManageAddresses,
  onViewLatestRequest,
  onSelectBarber,
  photoBaseUrl,
}: {
  userId: string;
  photoBaseUrl: string;
  onManageAddresses: () => void;
  onViewLatestRequest?: () => void;
  onSelectBarber: (barberId: string, serviceCategoryId: string) => void;
}) {
  const { colors, typography } = useTheme();
  const { supabase } = useMobileSession(),
    cache = useQueryClient(),
    draft = useBookingDraftStore();
  const api = useMemo(() => discoveryApi(supabase, userId), [supabase, userId]);
  const listRef =
    useRef<FlatList<SearchAvailableNowBarbersResponse['results'][number]>>(
      null,
    );
  const restarting = useRef(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const { selectedServiceCategoryId, patchDraft } = draft;
  const selectBarber = useCallback(
    (barberId: string) => {
      if (!selectedServiceCategoryId) return;
      patchDraft({ selectedBarberId: barberId });
      onSelectBarber(barberId, selectedServiceCategoryId);
    },
    [selectedServiceCategoryId, patchDraft, onSelectBarber],
  );
  const [addressPicker, setAddressPicker] = useState<'list' | 'current' | null>(
    null,
  );
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [areaId, setAreaId] = useState<string | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const form = useForm<{ radius: string }>({
    resolver: zodResolver(discoveryRadiusFormSchema),
    mode: 'onBlur',
    defaultValues: {
      radius: draft.radiusKm === null ? '' : String(draft.radiusKm),
    },
  });
  const radiusText = useWatch({ control: form.control, name: 'radius' });
  const key = queryKeys.discovery.inputs(userId, draft.selectedAddressId);
  const inputs = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.inputs(draft.selectedAddressId, signal),
    retry: false,
    gcTime: 0,
  });
  const catalogue = useInfiniteQuery({
    queryKey: queryKeys.discovery.categories(userId),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.categories(pageParam, signal),
    getNextPageParam: (last, pages) =>
      last.length === SERVICE_CATALOGUE_PAGE_SIZE
        ? pages.length * SERVICE_CATALOGUE_PAGE_SIZE
        : undefined,
    retry: false,
  });
  const categories = catalogue.data?.pages.flat() ?? [];
  const data = inputs.data;
  const inputAddressError =
    inputs.error instanceof EdgeFunctionError
      ? inputs.error.response.fields?.addressId
      : undefined;
  // Display-only estimate between authoritative reads; each search gets fresh server time.
  const serverNow = data
    ? Date.parse(data.serverNow) +
      Math.max(0, Date.now() - inputs.dataUpdatedAt)
    : NaN;
  const scheduleIssue =
    draft.selectedBookingType === BOOKING_TYPE_VALUE.SCHEDULED && data
      ? scheduledTimeIssue(
          Date.parse(draft.scheduledFor ?? ''),
          serverNow,
          data.scheduling,
        )
      : null;
  const radiusError = data ? radiusIssue(Number(radiusText), data) : undefined;
  const categoryValid = categories.some(
    (c) => c.id === draft.selectedServiceCategoryId,
  );
  const complete = !!(
    !inputs.isError &&
    !catalogue.isError &&
    data?.address &&
    draft.selectedBookingType &&
    categoryValid &&
    draft.radiusKm !== null &&
    Number(radiusText) === draft.radiusKm &&
    !radiusError &&
    !scheduleIssue
  );
  function change(values: Partial<BookingDraftValues>) {
    setAreaId(null);
    cache
      .invalidateQueries({
        queryKey: queryKeys.discovery.all,
        refetchType: 'none',
      })
      .catch(() => undefined);
    draft.patchDraft({ ...values, selectedBarberId: null });
  }
  const filterKey = {
    userId,
    addressId: draft.selectedAddressId,
    bookingType: draft.selectedBookingType,
    serviceCategoryId: draft.selectedServiceCategoryId,
    radiusKm: draft.radiusKm,
    scheduledFor:
      draft.selectedBookingType === BOOKING_TYPE_VALUE.SCHEDULED
        ? draft.scheduledFor
        : null,
  };
  const search = useInfiniteQuery({
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: SearchAvailableNowBarbersResponse) =>
      page.nextCursor ?? undefined,
    queryKey: queryKeys.discovery.results(filterKey),
    enabled:
      complete && !inputs.isError && !catalogue.isError && !addressPicker,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal, pageParam }) => {
      const fresh = await api.inputs(draft.selectedAddressId, signal);
      cache.setQueryData(key, fresh);
      const issue =
        draft.selectedBookingType === BOOKING_TYPE_VALUE.SCHEDULED
          ? scheduledTimeIssue(
              Date.parse(draft.scheduledFor ?? ''),
              Date.parse(fresh.serverNow),
              fresh.scheduling,
            )
          : null;
      const radius = radiusIssue(draft.radiusKm ?? NaN, fresh);
      if (!fresh.address || issue || radius)
        throw new EdgeFunctionError(422, {
          error: 'validation_failed',
          fields: {
            ...(!fresh.address
              ? { addressId: 'Choose an active saved address.' }
              : {}),
            ...(issue ? { scheduledFor: issue } : {}),
            ...(radius ? { radiusKm: radius } : {}),
          },
        });
      const request: SearchAvailableNowBarbersRequest = {
        bookingType: draft.selectedBookingType!,
        serviceCategoryId: draft.selectedServiceCategoryId!,
        ...fresh.address.point,
        radiusKm: draft.radiusKm!,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(draft.selectedBookingType === BOOKING_TYPE_VALUE.SCHEDULED
          ? { scheduledFor: draft.scheduledFor! }
          : {}),
      };
      return api.search(request, signal);
    },
  });
  const results = useMemo(
    () =>
      complete
        ? [
            ...new Map(
              search.data?.pages
                .flatMap((page) => page.results)
                .map((item) => [item.barberId, item]),
            ).values(),
          ]
        : [],
    [complete, search.data],
  );
  async function restart() {
    if (restarting.current || !complete) return;
    restarting.current = true;
    setIsRestarting(true);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    try {
      // Discard the old cursor chain; v5 would otherwise refetch every loaded page.
      await cache.cancelQueries({
        queryKey: queryKeys.discovery.results(filterKey),
        exact: true,
      });
      cache.setQueryData<{
        pages: SearchAvailableNowBarbersResponse[];
        pageParams: (string | undefined)[];
      }>(queryKeys.discovery.results(filterKey), (old) =>
        old
          ? { pages: old.pages.slice(0, 1), pageParams: [undefined] }
          : undefined,
      );
      await search.refetch();
    } finally {
      restarting.current = false;
      setIsRestarting(false);
    }
  }
  const refresh = () => {
    restart().catch(() => undefined);
  };
  function edit(values: Partial<BookingDraftValues>) {
    setFiltersOpen(true);
    change(values);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }
  if (addressPicker)
    return (
      <ClientAddressesScreen
        userId={userId}
        startWithCurrentLocation={addressPicker === 'current'}
        onBack={() => setAddressPicker(null)}
        onSelect={(addressId) => {
          change({ selectedAddressId: addressId });
          setAddressPicker(null);
        }}
      />
    );
  if (!data)
    return (
      <Screen scroll>
        {inputs.error ? (
          <ErrorState
            message={
              inputAddressError ??
              'Could not load search settings. Check your connection and retry.'
            }
            onRetry={() => {
              inputs.refetch().catch(() => undefined);
            }}
          />
        ) : (
          <LoadingState message="Loading search settings…" />
        )}
        <Button
          label="Choose service address"
          onPress={() => setAddressPicker('list')}
        />
        <Button label="Service addresses" onPress={onManageAddresses} />
      </Screen>
    );
  const window = schedulingWindow(serverNow, data.scheduling);
  const selectedDate = new Date(draft.scheduledFor ?? window.minimum);
  const fieldError =
    search.error instanceof EdgeFunctionError
      ? search.error.response.fields
      : undefined;
  const serviceName =
    categories.find((c) => c.id === draft.selectedServiceCategoryId)
      ?.displayName ?? '';
  const searchError =
    search.fetchStatus === 'paused'
      ? 'You’re offline. Reconnect and refresh these results.'
      : search.error
        ? fieldError
          ? Object.values(fieldError).join(' ')
          : 'Could not update nearby search. Your filters are kept; refresh to restart results.'
        : null;
  const loadMore = () => {
    if (!restarting.current && search.hasNextPage && !search.isFetching)
      search.fetchNextPage({ cancelRefetch: false }).catch(() => undefined);
  };
  if (view === 'map' && !filtersOpen && complete && data.address)
    return (
      <DiscoveryMapScreen
        key={JSON.stringify(filterKey)}
        point={data.address.point}
        results={results}
        refreshIntervalMs={data.map.refreshIntervalMs}
        serviceName={serviceName}
        loading={search.isPending && search.fetchStatus !== 'paused'}
        refreshing={
          isRestarting || (search.isRefetching && !search.isFetchingNextPage)
        }
        error={searchError}
        hasNextPage={!!search.hasNextPage}
        fetchingNextPage={search.isFetchingNextPage}
        onRefresh={restart}
        onMore={loadMore}
        onSelectArea={(id) => {
          setAreaId(id);
          setView('list');
        }}
        onList={() => {
          setAreaId(null);
          setView('list');
        }}
        onFilters={() => setFiltersOpen(true)}
      />
    );
  const header =
    filtersOpen || !complete ? (
      <View style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
          <Text style={typography.eyebrow}>GOOD GROOMING. YOUR PLACE.</Text>
          <Text accessibilityRole="header" style={typography.display}>
            Your next great cut.
          </Text>
          <Text style={typography.subhead}>
            Find a barber who fits your day.
          </Text>
        </View>
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.inset,
          }}
        >
          {inputs.isError ? (
            <ErrorState
              message={
                inputAddressError ??
                'Could not refresh search settings. Your selections are kept; refresh before searching.'
              }
              onRetry={() => {
                inputs.refetch().catch(() => undefined);
              }}
            />
          ) : null}
          <FilterSection label="01 / WHEN">
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {[
                {
                  value: BOOKING_TYPE_VALUE.AVAILABLE_NOW,
                  label: 'Available Now',
                },
                { value: BOOKING_TYPE_VALUE.SCHEDULED, label: 'Scheduled' },
              ].map((option) => (
                <Button
                  key={option.value}
                  label={option.label}
                  testID={`booking-mode-${option.value}`}
                  style={{ flex: 1, paddingHorizontal: spacing.sm }}
                  variant={
                    draft.selectedBookingType === option.value
                      ? 'primary'
                      : 'secondary'
                  }
                  accessibilityState={{
                    selected: draft.selectedBookingType === option.value,
                  }}
                  onPress={() => {
                    change({
                      selectedBookingType: option.value,
                      ...(option.value === BOOKING_TYPE_VALUE.AVAILABLE_NOW
                        ? { scheduledFor: null }
                        : {}),
                    });
                    setPicker(null);
                  }}
                />
              ))}
            </View>
          </FilterSection>
          <FilterSection label="02 / YOUR SERVICE">
            {!catalogue.data ? (
              <>
                {catalogue.error ? (
                  <ErrorState
                    message="Could not load services."
                    onRetry={() => {
                      catalogue.refetch().catch(() => undefined);
                    }}
                  />
                ) : (
                  <LoadingState message="Loading services…" />
                )}
              </>
            ) : !categories.length ? (
              <EmptyState
                message="No services are listed yet. Try refreshing later."
                action={{
                  label: 'Refresh services',
                  onPress: () => {
                    catalogue.refetch().catch(() => undefined);
                  },
                }}
              />
            ) : (
              <>
                <Host seedColor={colors.accent} matchContents>
                  <Picker
                    testID="service-category"
                    selectedValue={draft.selectedServiceCategoryId ?? ''}
                    onValueChange={(id) =>
                      change({ selectedServiceCategoryId: String(id) || null })
                    }
                  >
                    <Picker.Item value="" label="Choose a service" />
                    {categories.map((c) => (
                      <Picker.Item
                        key={c.id}
                        value={c.id}
                        label={c.displayName}
                      />
                    ))}
                  </Picker>
                </Host>
                {!categoryValid && draft.selectedServiceCategoryId ? (
                  <Text accessibilityRole="alert">
                    Choose a currently listed service, or load more services.
                  </Text>
                ) : null}
                {catalogue.hasNextPage ? (
                  <Button
                    label="Load more services"
                    loading={catalogue.isFetchingNextPage}
                    onPress={() => {
                      catalogue.fetchNextPage().catch(() => undefined);
                    }}
                  />
                ) : null}
                {catalogue.isError ? (
                  <ErrorState
                    message="Could not refresh services. Your selection is kept."
                    onRetry={() => {
                      catalogue.refetch().catch(() => undefined);
                    }}
                  />
                ) : null}
              </>
            )}
          </FilterSection>
          <FilterSection label="03 / YOUR PLACE">
            <Text selectable style={typography.body}>
              {data.address?.label ??
                'Choose where the service should take place.'}
            </Text>
            <Button
              label="Choose service address"
              variant="secondary"
              onPress={() => setAddressPicker('list')}
            />
            <Button
              label="Use current location"
              variant="ghost"
              onPress={() => setAddressPicker('current')}
            />
            <Text style={typography.caption}>
              Confirm and save an address before searching. You can also enter
              it manually.
            </Text>
          </FilterSection>
          <FilterSection>
            <Controller
              control={form.control}
              name="radius"
              render={({ field, fieldState }) => (
                <TextInput
                  label="Search radius (km)"
                  keyboardType="decimal-pad"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={() => {
                    field.onBlur();
                    const value = Number(form.getValues('radius'));
                    change({
                      radiusKm:
                        Number.isFinite(value) &&
                        form.getValues('radius').trim()
                          ? value
                          : null,
                    });
                  }}
                  error={
                    fieldState.error?.message ??
                    (fieldState.isTouched || field.value.trim()
                      ? radiusError
                      : undefined) ??
                    fieldError?.radiusKm
                  }
                />
              )}
            />
            <Text style={typography.caption}>
              Choose {data.radiusKm.min}–{data.radiusKm.max} km. Fractions are
              allowed.
            </Text>
          </FilterSection>
          {draft.selectedBookingType === BOOKING_TYPE_VALUE.SCHEDULED ? (
            <FilterSection label="REQUESTED DATE & TIME">
              <Text selectable style={typography.body}>
                {draft.scheduledFor
                  ? new Date(draft.scheduledFor).toLocaleString()
                  : 'Choose a requested date and time.'}
              </Text>
              <Text style={typography.caption}>
                This is a requested time. The barber confirms availability by
                accepting your request.
              </Text>
              <Button
                label="Choose requested date"
                variant="secondary"
                onPress={() => setPicker('date')}
              />
              <Button
                label="Choose requested time"
                variant="secondary"
                onPress={() => setPicker('time')}
              />
              {picker ? (
                <DateTimePicker
                  testID="requested-picker"
                  mode={picker}
                  value={selectedDate}
                  minimumDate={new Date(window.minimum)}
                  maximumDate={new Date(window.maximum)}
                  onDismiss={() => setPicker(null)}
                  onValueChange={(_event, date) => {
                    change({ scheduledFor: date.toISOString() });
                    setPicker(null);
                  }}
                />
              ) : null}
              {(scheduleIssue ?? fieldError?.scheduledFor) ? (
                <Text
                  selectable
                  accessibilityRole="alert"
                  style={{ color: colors.danger }}
                >
                  {scheduleIssue ?? fieldError?.scheduledFor}
                </Text>
              ) : null}
              {scheduleIssue ? (
                <Button
                  label="Try Available Now"
                  variant="secondary"
                  onPress={() => {
                    change({
                      selectedBookingType: BOOKING_TYPE_VALUE.AVAILABLE_NOW,
                      scheduledFor: null,
                    });
                    setPicker(null);
                  }}
                />
              ) : null}
            </FilterSection>
          ) : null}
        </View>
        {!complete ? (
          <Text accessibilityLiveRegion="polite" style={typography.body}>
            Choose a booking mode, listed service, active address and valid
            radius
            {draft.selectedBookingType === BOOKING_TYPE_VALUE.SCHEDULED
              ? ' and requested time'
              : ''}{' '}
            to search.
          </Text>
        ) : null}
        <Button
          size="large"
          label="Show barbers"
          disabled={!complete || inputs.isError || catalogue.isError}
          onPress={() => {
            setFiltersOpen(false);
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
          }}
        />
      </View>
    ) : (
      <View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
        <Text style={typography.eyebrow}>A CUT ABOVE, CLOSE BY</Text>
        <Text accessibilityRole="header" style={typography.display}>
          Barbers for you.
        </Text>
        <Text style={typography.body}>
          {
            categories.find((c) => c.id === draft.selectedServiceCategoryId)
              ?.displayName
          }{' '}
          · {draft.radiusKm} km search radius
        </Text>
        <Text style={typography.caption}>
          {draft.selectedBookingType === BOOKING_TYPE_VALUE.AVAILABLE_NOW
            ? 'Available Now'
            : `Requested ${new Date(draft.scheduledFor!).toLocaleString()}`}
        </Text>
        {areaId ? (
          <Text style={typography.subhead}>
            Showing loaded matches in{' '}
            {results.find((r) => r.approximateArea.id === areaId)
              ?.approximateArea.label ?? 'the selected area'}
            .
          </Text>
        ) : null}
        <Button
          label={areaId ? 'Back to map' : 'View map'}
          variant="secondary"
          onPress={() => {
            setAreaId(null);
            setView('map');
          }}
        />
        {areaId ? (
          <Button
            label="Show all loaded results"
            variant="ghost"
            size="small"
            onPress={() => setAreaId(null)}
          />
        ) : null}
        <Button
          label="Change filters"
          size="small"
          style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }}
          variant="ghost"
          onPress={() => setFiltersOpen(true)}
        />
      </View>
    );
  return (
    <DiscoveryResultsList
      listRef={listRef}
      header={header}
      footer={
        <>
          <Button
            label="Refresh search"
            variant="ghost"
            size="small"
            disabled={!complete || inputs.isError || catalogue.isError}
            loading={search.isFetching || isRestarting}
            onPress={refresh}
          />
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: spacing.xs,
            }}
          >
            <Button
              label="Service addresses"
              size="small"
              variant="ghost"
              onPress={onManageAddresses}
            />
            {onViewLatestRequest ? (
              <Button
                label="Latest request"
                variant="secondary"
                onPress={onViewLatestRequest}
              />
            ) : null}
            <SignOutButton />
          </View>
        </>
      }
      results={
        areaId
          ? results.filter((r) => r.approximateArea.id === areaId)
          : results
      }
      autoLoadMore={areaId === null}
      emptyMessage={
        areaId
          ? 'No loaded matches remain in this area. Return to the map, refresh or load more results.'
          : undefined
      }
      serviceName={
        categories.find((c) => c.id === draft.selectedServiceCategoryId)
          ?.displayName ?? ''
      }
      bookingType={draft.selectedBookingType}
      photoBaseUrl={photoBaseUrl}
      complete={complete}
      loading={complete && search.isPending && search.fetchStatus !== 'paused'}
      refreshing={
        isRestarting || (search.isRefetching && !search.isFetchingNextPage)
      }
      fetchingNextPage={search.isFetchingNextPage}
      continuationError={search.isFetchNextPageError}
      hasNextPage={complete && !!search.hasNextPage}
      error={searchError}
      onRefresh={refresh}
      onMore={loadMore}
      onSelect={selectBarber}
      onWidenRadius={() => {
        form.setValue('radius', '');
        edit({ radiusKm: null });
      }}
      onChangeService={() => edit({ selectedServiceCategoryId: null })}
      onTryScheduled={() =>
        edit({
          selectedBookingType: BOOKING_TYPE_VALUE.SCHEDULED,
          scheduledFor: null,
        })
      }
    />
  );
}

function FilterSection({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const { colors, typography } = useTheme();
  return (
    <View
      style={{
        gap: spacing.compact,
        paddingVertical: spacing.inset,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      {label ? <Text style={typography.eyebrow}>{label}</Text> : null}
      {children}
    </View>
  );
}
