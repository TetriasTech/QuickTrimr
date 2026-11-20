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
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  TextInput,
  colors,
  spacing,
  typography,
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
import { DiscoveryResultsList } from './discovery-results-list';

import type { BookingDraftValues } from '@/stores/booking-draft-store';
import type {
  DiscoveryFilters,
  SearchAvailableNowBarbersRequest,
  SearchAvailableNowBarbersResponse,
} from '@quicktrimr/validation';

function radiusIssue(radius: number, inputs: DiscoveryFilters) {
  return discoveryRadiusIssue(radius, inputs.radiusKm);
}
export function DiscoveryFiltersScreen({
  userId,
  onManageAddresses,
  onSelectBarber,
  photoBaseUrl,
}: {
  userId: string;
  photoBaseUrl: string;
  onManageAddresses: () => void;
  onSelectBarber: (barberId: string, serviceCategoryId: string) => void;
}) {
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
  const header =
    filtersOpen || !complete ? (
      <View style={{ gap: spacing.lg }}>
        <Text style={typography.body}>
          Choose where and when you would like a barber to visit.
        </Text>
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
        <Card>
          <Text style={typography.headline}>Booking mode</Text>
          <Host matchContents>
            <Picker
              testID="booking-mode"
              selectedValue={draft.selectedBookingType ?? ''}
              onValueChange={(value) => {
                if (
                  value === BOOKING_TYPE_VALUE.AVAILABLE_NOW ||
                  value === BOOKING_TYPE_VALUE.SCHEDULED
                ) {
                  change({
                    selectedBookingType: value,
                    ...(value === BOOKING_TYPE_VALUE.AVAILABLE_NOW
                      ? { scheduledFor: null }
                      : {}),
                  });
                  setPicker(null);
                }
              }}
            >
              <Picker.Item value="" label="Choose booking mode" />
              <Picker.Item
                value={BOOKING_TYPE_VALUE.AVAILABLE_NOW}
                label="Available Now"
              />
              <Picker.Item
                value={BOOKING_TYPE_VALUE.SCHEDULED}
                label="Scheduled"
              />
            </Picker>
          </Host>
        </Card>
        <Card>
          <Text style={typography.headline}>Service</Text>
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
              <Host matchContents>
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
        </Card>
        <Card>
          <Text style={typography.headline}>Service address</Text>
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
            variant="secondary"
            onPress={() => setAddressPicker('current')}
          />
          <Text style={typography.caption}>
            Current location suggests addresses for you to confirm and save. You
            can enter an address if location access is off.
          </Text>
        </Card>
        <Card>
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
                      Number.isFinite(value) && form.getValues('radius').trim()
                        ? value
                        : null,
                  });
                }}
                error={
                  fieldState.error?.message ??
                  radiusError ??
                  fieldError?.radiusKm
                }
              />
            )}
          />
          <Text style={typography.caption}>
            Choose {data.radiusKm.min}–{data.radiusKm.max} km. Fractions are
            allowed.
          </Text>
        </Card>
        {draft.selectedBookingType === BOOKING_TYPE_VALUE.SCHEDULED ? (
          <Card>
            <Text style={typography.headline}>Requested date and time</Text>
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
          </Card>
        ) : null}
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
          label="Show barbers"
          disabled={!complete || inputs.isError || catalogue.isError}
          onPress={() => {
            setFiltersOpen(false);
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
          }}
        />
      </View>
    ) : (
      <Card>
        <Text style={typography.headline}>
          Barbers near your service address
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
        <Button
          label="Change filters"
          variant="secondary"
          onPress={() => setFiltersOpen(true)}
        />
      </Card>
    );
  return (
    <DiscoveryResultsList
      listRef={listRef}
      header={header}
      footer={
        <>
          <Button
            label="Refresh search"
            disabled={!complete || inputs.isError || catalogue.isError}
            loading={search.isFetching || isRestarting}
            onPress={refresh}
          />
          <Button
            label="Service addresses"
            variant="ghost"
            onPress={onManageAddresses}
          />
          <SignOutButton />
        </>
      }
      results={results}
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
      hasNextPage={complete && !!search.hasNextPage}
      error={
        search.fetchStatus === 'paused'
          ? 'You’re offline. Reconnect and refresh these results.'
          : search.error
            ? fieldError
              ? Object.values(fieldError).join(' ')
              : 'Could not update nearby search. Your filters are kept; refresh to restart results.'
            : null
      }
      onRefresh={refresh}
      onMore={() => {
        if (!restarting.current && search.hasNextPage && !search.isFetching)
          search.fetchNextPage({ cancelRefetch: false }).catch(() => undefined);
      }}
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
