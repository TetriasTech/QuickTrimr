import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  spacing,
  useTheme,
} from '@quicktrimr/ui';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useMobileSession } from '@/features/session/session-provider';
import { queryKeys } from '@/lib/query/query-keys';

import { ClientAddressForm } from './client-address-form';
import {
  clientAddressOperation,
  formatClientAddress,
} from './client-addresses';

import type { SavedClientAddress } from '@quicktrimr/validation';
import type { ReactNode } from 'react';

type Form = { address: SavedClientAddress | null };

export function SavedAddressList({
  addresses,
  renderActions,
}: {
  addresses: readonly SavedClientAddress[];
  renderActions: (address: SavedClientAddress) => ReactNode;
}) {
  const { typography } = useTheme();
  return addresses.map((address) => (
    <Card key={address.id}>
      <Text style={typography.subhead}>{address.label}</Text>
      <Text style={typography.body}>{formatClientAddress(address)}</Text>
      {renderActions(address)}
    </Card>
  ));
}

export function ClientAddressesScreen({
  userId,
  onBack,
  onSelect,
  startWithCurrentLocation = false,
}: {
  userId: string;
  onBack: () => void;
  onSelect?: (addressId: string) => void;
  startWithCurrentLocation?: boolean;
}) {
  const { typography } = useTheme();
  const { supabase } = useMobileSession();
  const cache = useQueryClient();
  const [form, setForm] = useState<Form | undefined>(
    startWithCurrentLocation ? { address: null } : undefined,
  );
  const [useLocation, setUseLocation] = useState(startWithCurrentLocation);
  const [archiveTarget, setArchiveTarget] = useState<SavedClientAddress>();
  const ownAddresses = queryKeys.addresses.list(userId);
  const addresses = useInfiniteQuery({
    queryKey: ownAddresses,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      clientAddressOperation<'list'>(
        supabase,
        userId,
        pageParam
          ? { operation: 'list', after: pageParam }
          : { operation: 'list' },
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });

  function refresh(onboardingComplete: boolean) {
    cache.setQueryData<{ onboardingComplete: boolean }>(
      queryKeys.session.profile(userId),
      (profile) => profile && { ...profile, onboardingComplete },
    );
    cache.invalidateQueries({ queryKey: ownAddresses }).catch(() => undefined);
  }

  const archive = useMutation({
    mutationFn: (id: string) =>
      clientAddressOperation<'archive'>(supabase, userId, {
        operation: 'archive',
        id,
      }),
    onSuccess(result) {
      refresh(result.onboardingComplete);
    },
  });

  if (form)
    return (
      <ClientAddressForm
        userId={userId}
        address={form.address}
        onBack={() => {
          setUseLocation(false);
          setForm(undefined);
        }}
        initialUseLocation={useLocation}
        onSaved={(complete, saved) => {
          setUseLocation(false);
          setForm(undefined);
          refresh(complete);
          onSelect?.(saved.id);
        }}
      />
    );

  const rows = addresses.data?.pages.flatMap((page) => page.addresses) ?? [];
  const add = () => {
    setUseLocation(false);
    setForm({ address: null });
  };
  return (
    <Screen
      scroll
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <Text accessibilityRole="header" style={typography.title}>
        Service addresses
      </Text>
      {addresses.isPending && (
        <LoadingState message="Loading your addresses…" />
      )}
      {addresses.isError && (
        <ErrorState
          message="Could not load your addresses."
          onRetry={() => {
            addresses.refetch().catch(() => undefined);
          }}
        />
      )}
      {addresses.isSuccess && !rows.length && (
        <EmptyState
          message="Add your first service address."
          action={{ label: 'Add an address', onPress: add, variant: 'primary' }}
        />
      )}
      {!!rows.length && (
        <>
          <Button
            label="Add an address"
            onPress={add}
            disabled={archive.isPending}
          />
          <SavedAddressList
            addresses={rows}
            renderActions={(address) => (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: spacing.sm,
                }}
              >
                {onSelect ? (
                  <Button
                    label="Use this address"
                    accessibilityLabel={`Use ${address.label}`}
                    onPress={() => onSelect(address.id)}
                  />
                ) : null}
                <Button
                  variant="secondary"
                  label="Edit"
                  accessibilityLabel={`Edit ${address.label}`}
                  disabled={archive.isPending}
                  onPress={() => setForm({ address })}
                />
                <Button
                  variant="ghost"
                  label="Archive"
                  accessibilityLabel={`Archive ${address.label}`}
                  disabled={archive.isPending}
                  onPress={() => setArchiveTarget(address)}
                />
              </View>
            )}
          />
        </>
      )}
      {archive.isError && (
        <Text style={typography.body} accessibilityRole="alert">
          Could not archive the address. Try again.
        </Text>
      )}
      {addresses.hasNextPage && (
        <Button
          label="Load more addresses"
          variant="secondary"
          loading={addresses.isFetchingNextPage}
          onPress={() => {
            addresses.fetchNextPage().catch(() => undefined);
          }}
        />
      )}
      <Button label="Back" variant="ghost" onPress={onBack} />
      <ConfirmDialog
        visible={Boolean(archiveTarget)}
        title="Archive this address?"
        consequence="It will be removed from your saved addresses. Existing bookings keep their address."
        confirmLabel="Archive address"
        destructive
        onCancel={() => setArchiveTarget(undefined)}
        onConfirm={() => {
          if (archiveTarget) archive.mutate(archiveTarget.id);
          setArchiveTarget(undefined);
        }}
      />
    </Screen>
  );
}
