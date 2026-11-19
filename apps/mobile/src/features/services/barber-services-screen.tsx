import { Host, Switch } from '@expo/ui';
import {
  audPriceText,
  parseAudPrice,
  servicePriceFits,
} from '@quicktrimr/domain';
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
import {
  upsertBarberServiceRequestSchema,
  type BarberServiceCatalogueEntry,
} from '@quicktrimr/validation';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  Controller,
  FormProvider,
  useForm,
  useFormContext,
  useWatch,
} from 'react-hook-form';
import { FlatList, Text, View } from 'react-native';

import { useMobileSession } from '@/features/session/session-provider';
import { EdgeFunctionError } from '@/lib/api/invoke-edge-function';
import { queryKeys } from '@/lib/query/query-keys';

import {
  barberServicesApi,
  SERVICE_CATALOGUE_PAGE_SIZE,
} from './barber-services-api';

type Values = { enabled: boolean; priceText: string };
type Fields = { services: Record<string, Values> };
type Service = BarberServiceCatalogueEntry['services'][number];
type Save = { category: BarberServiceCatalogueEntry; values: Values };
const valuesFor = (service?: Service): Values => ({
  enabled: Boolean(service && service.archivedAt === null),
  priceText: service ? audPriceText(service.priceCents) : '',
});
const eligibilityCopy =
  'Enable and price at least one service before you can appear in search. Stripe setup and other eligibility checks also apply.';

export function BarberServicesScreen({ userId }: { userId: string }) {
  const { supabase } = useMobileSession();
  const cache = useQueryClient();
  const api = barberServicesApi(supabase, userId);
  const key = queryKeys.onboarding.barberServices(userId);
  // One form retains drafts when virtualized category rows scroll off screen.
  const form = useForm<Fields>({
    defaultValues: { services: {} },
    shouldUnregister: false,
  });
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.page(pageParam, signal),
    getNextPageParam: (page, pages) =>
      page.length === SERVICE_CATALOGUE_PAGE_SIZE
        ? pages.length * SERVICE_CATALOGUE_PAGE_SIZE
        : undefined,
    gcTime: 0,
  });
  const save = useMutation({
    async mutationFn({ category, values }: Save) {
      if (values.enabled) {
        const priceCents = parseAudPrice(values.priceText);
        if (priceCents === null || !servicePriceFits(priceCents, category))
          throw new Error('Invalid price.');
        return api.upsert(
          upsertBarberServiceRequestSchema.parse({
            serviceCategoryId: category.id,
            priceCents,
            enabled: true,
          }),
        );
      }
      const service = category.services[0];
      if (!service) throw new Error('No service to archive.');
      const archived = await api.archive(service.id);
      return { ...service, archivedAt: archived.archivedAt, enabled: false };
    },
    onSuccess(service, { category }) {
      form.resetField(`services.${category.id}.priceText`, {
        defaultValue: audPriceText(service.priceCents),
      });
      form.resetField(`services.${category.id}.enabled`, {
        defaultValue: service.enabled,
      });
      form.clearErrors(`services.${category.id}`);
      cache.setQueryData<InfiniteData<BarberServiceCatalogueEntry[]>>(
        key,
        (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) =>
                  page.map((row) =>
                    row.id === category.id
                      ? {
                          ...row,
                          services: [
                            {
                              id: service.id,
                              serviceCategoryId: service.serviceCategoryId,
                              priceCents: service.priceCents,
                              archivedAt: service.archivedAt,
                            },
                          ],
                        }
                      : row,
                  ),
                ),
              }
            : old,
      );
    },
    onError(error, { category }) {
      if (
        error instanceof EdgeFunctionError &&
        error.response.fields?.priceCents
      )
        form.setError(`services.${category.id}.priceText`, {
          message: error.response.fields.priceCents,
        });
      // Refresh changed category bounds without resetting the barber's draft.
      if (error instanceof EdgeFunctionError && error.status === 422)
        cache.invalidateQueries({ queryKey: key }).catch(() => undefined);
    },
  });
  function submit(category: BarberServiceCatalogueEntry) {
    if (save.isPending) return;
    const values = form.getValues(`services.${category.id}`);
    form.clearErrors(`services.${category.id}`);
    if (values.enabled) {
      const cents = parseAudPrice(values.priceText);
      const message =
        cents === null
          ? 'Enter dollars and cents, for example 45.50.'
          : !servicePriceFits(cents, category)
            ? `Enter a price between A$${audPriceText(category.minPriceCents)} and A$${audPriceText(category.maxPriceCents)}.`
            : null;
      if (message) {
        form.setError(`services.${category.id}.priceText`, { message });
        return;
      }
    }
    save.mutate({ category, values });
  }
  if (query.data === undefined)
    return (
      <Screen>
        {query.isError || query.fetchStatus === 'paused' ? (
          <ErrorState
            message={
              query.fetchStatus === 'paused'
                ? 'Connect to the internet to load services.'
                : 'Could not load services and prices.'
            }
            onRetry={() => {
              query.refetch().catch(() => undefined);
            }}
          />
        ) : (
          <LoadingState message="Loading services and prices…" />
        )}
      </Screen>
    );
  const categories = [
    ...new Map(query.data.pages.flat().map((c) => [c.id, c])).values(),
  ];
  return (
    <FormProvider {...form}>
      <Screen
        edges={['left', 'right', 'bottom']}
        contentContainerStyle={{ flex: 1, padding: 0 }}
      >
        <FlatList
          data={categories}
          keyExtractor={(category) => category.id}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => {
            query.refetch().catch(() => undefined);
          }}
          ListHeaderComponent={
            <View style={{ gap: spacing.md }}>
              <Text selectable style={typography.body}>
                Choose the services you offer and set your price in Australian
                dollars.
              </Text>
              <Text selectable style={typography.body}>
                Price changes do not affect existing bookings.
              </Text>
              <Text
                selectable
                style={[typography.caption, { color: colors.textMuted }]}
              >
                {eligibilityCopy}
              </Text>
              {query.isError ? (
                <ErrorState
                  message="Could not refresh services. Your edits are still here."
                  onRetry={() => {
                    query.refetch().catch(() => undefined);
                  }}
                />
              ) : null}
              {categories.length > 0 &&
              !query.hasNextPage &&
              !categories.some((c) => c.services[0]?.archivedAt === null) ? (
                <EmptyState message="No services enabled yet. Choose a service below and save your price." />
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <ServiceRow
              category={item}
              busy={save.isPending}
              saving={save.isPending && save.variables.category.id === item.id}
              onSave={() => submit(item)}
              saveError={save.isError && save.variables.category.id === item.id}
              saved={save.isSuccess && save.variables.category.id === item.id}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              message="No service categories are available yet. Services must be priced before you can appear in search."
              action={{
                label: 'Refresh services',
                onPress: () => {
                  query.refetch().catch(() => undefined);
                },
              }}
            />
          }
          ListFooterComponent={
            query.hasNextPage ? (
              <Button
                label="More services"
                variant="secondary"
                loading={query.isFetchingNextPage}
                disabled={query.isFetchingNextPage}
                onPress={() => {
                  query.fetchNextPage().catch(() => undefined);
                }}
              />
            ) : null
          }
        />
      </Screen>
    </FormProvider>
  );
}

function ServiceRow({
  category,
  busy,
  saving,
  onSave,
  saveError,
  saved,
}: {
  category: BarberServiceCatalogueEntry;
  busy: boolean;
  saving: boolean;
  onSave: () => void;
  saveError: boolean;
  saved: boolean;
}) {
  const { control } = useFormContext<Fields>();
  const original = valuesFor(category.services[0]);
  const enabledName = `services.${category.id}.enabled` as const;
  const priceName = `services.${category.id}.priceText` as const;
  const enabled = useWatch({
    control,
    name: enabledName,
    defaultValue: original.enabled,
  });
  const priceText = useWatch({
    control,
    name: priceName,
    defaultValue: original.priceText,
  });
  const dirty =
    enabled !== original.enabled || priceText !== original.priceText;
  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <Text selectable style={typography.headline}>
          {category.displayName}
        </Text>
        {category.description ? (
          <Text selectable style={typography.body}>
            {category.description}
          </Text>
        ) : null}
        <Controller
          name={enabledName}
          control={control}
          defaultValue={original.enabled}
          render={({ field }) => (
            <Host matchContents>
              <Switch
                label={`Offer ${category.displayName}`}
                value={field.value}
                disabled={busy}
                onValueChange={field.onChange}
              />
            </Host>
          )}
        />
        <Text
          selectable
          style={[typography.caption, { color: colors.textMuted }]}
        >
          Allowed: A${audPriceText(category.minPriceCents)}–A$
          {audPriceText(category.maxPriceCents)}
        </Text>
        <Controller
          name={priceName}
          control={control}
          defaultValue={original.priceText}
          render={({ field, fieldState }) => (
            <TextInput
              label={`${category.displayName} price (A$)`}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              editable={enabled && !busy}
              keyboardType="decimal-pad"
              placeholder="Enter your price"
              error={fieldState.error?.message}
            />
          )}
        />
        <Button
          label={
            enabled
              ? `Save ${category.displayName} price`
              : `Disable ${category.displayName}`
          }
          disabled={busy || !dirty || (!enabled && !category.services[0])}
          loading={saving}
          onPress={onSave}
        />
        {dirty ? (
          <Text selectable style={typography.caption}>
            Save to apply your changes.
          </Text>
        ) : null}
        {saveError ? (
          <Text
            selectable
            accessibilityRole="alert"
            style={{ color: colors.danger }}
          >
            Could not save this service. Your price is still here; check it and
            try again.
          </Text>
        ) : null}
        {saved && !dirty ? (
          <Text
            selectable
            accessibilityLiveRegion="polite"
            style={typography.caption}
          >
            Service saved.
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
