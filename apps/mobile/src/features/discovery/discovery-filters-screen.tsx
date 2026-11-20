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
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Text } from 'react-native';

import { ClientAddressesScreen } from '@/features/addresses/client-addresses-screen';
import { SignOutButton } from '@/features/auth/screens/sign-out-button';
import { SERVICE_CATALOGUE_PAGE_SIZE } from '@/features/services/service-catalogue';
import { useMobileSession } from '@/features/session/session-provider';
import { EdgeFunctionError } from '@/lib/api/invoke-edge-function';
import { queryKeys } from '@/lib/query/query-keys';
import { useBookingDraftStore } from '@/stores/booking-draft-store';

import { discoveryApi } from './discovery-api';

import type { BookingDraftValues } from '@/stores/booking-draft-store';
import type {
  DiscoveryFilters,
  SearchAvailableNowBarbersRequest,
} from '@quicktrimr/validation';

function radiusIssue(radius: number, inputs: DiscoveryFilters) {
  return discoveryRadiusIssue(radius, inputs.radiusKm);
}
export function DiscoveryFiltersScreen({
  userId,
  onManageAddresses,
}: {
  userId: string;
  onManageAddresses: () => void;
}) {
  const { supabase } = useMobileSession(),
    cache = useQueryClient(),
    draft = useBookingDraftStore();
  const api = discoveryApi(supabase, userId);
  const [addressPicker, setAddressPicker] = useState<'list' | 'current' | null>(
    null,
  );
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
  const search = useQuery({
    queryKey: queryKeys.discovery.results(filterKey),
    enabled:
      complete && !inputs.isError && !catalogue.isError && !addressPicker,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
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
        ...(draft.selectedBookingType === BOOKING_TYPE_VALUE.SCHEDULED
          ? { scheduledFor: draft.scheduledFor! }
          : {}),
      };
      return api.search(request, signal);
    },
  });
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
  return (
    <Screen
      scroll
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: spacing.lg }}
    >
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
                  <Picker.Item key={c.id} value={c.id} label={c.displayName} />
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
          {data.address?.label ?? 'Choose where the service should take place.'}
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
                fieldState.error?.message ?? radiusError ?? fieldError?.radiusKm
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
          Choose a booking mode, listed service, active address and valid radius
          {draft.selectedBookingType === BOOKING_TYPE_VALUE.SCHEDULED
            ? ' and requested time'
            : ''}{' '}
          to search.
        </Text>
      ) : null}
      {search.isFetching ? (
        <LoadingState message="Updating nearby search…" />
      ) : null}
      {search.error ? (
        <ErrorState
          message={
            fieldError
              ? Object.values(fieldError).join(' ')
              : 'Could not update nearby search. Your filters are kept.'
          }
          onRetry={() => {
            inputs
              .refetch()
              .then(() => search.refetch())
              .catch(() => undefined);
          }}
        />
      ) : null}
      {complete && !search.isFetching && !search.error && search.data ? (
        <>
          {search.data.results.length ? (
            <Text style={typography.body}>
              Nearby search updated for your selected filters.
            </Text>
          ) : (
            <EmptyState
              message="No barbers matched these filters. Try another service, a wider radius or Scheduled."
              action={{
                label: 'Try search again',
                onPress: () => {
                  search.refetch().catch(() => undefined);
                },
              }}
            />
          )}
        </>
      ) : null}
      <Button
        label="Refresh search"
        disabled={!complete || inputs.isError || catalogue.isError}
        loading={search.isFetching}
        onPress={() => {
          search.refetch().catch(() => undefined);
        }}
      />
      <Button
        label="Service addresses"
        variant="ghost"
        onPress={onManageAddresses}
      />
      <SignOutButton />
    </Screen>
  );
}
