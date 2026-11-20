import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  ErrorState,
  LoadingState,
  Screen,
  TextInput,
  colors,
  spacing,
  typography,
} from '@quicktrimr/ui';
import {
  clientAddressFieldsSchema,
  minimumAddressSearchLength,
  type ClientAddressFields,
  type ClientAddressCandidate,
  type SavedClientAddress,
} from '@quicktrimr/validation';
import { skipToken, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Text, View } from 'react-native';

import { currentWorkingPoint } from '@/features/locations/current-working-point';
import { useMobileSession } from '@/features/session/session-provider';
import { EdgeFunctionError } from '@/lib/api/invoke-edge-function';
import { queryKeys } from '@/lib/query/query-keys';

import {
  clientAddressOperation,
  formatClientAddress,
} from './client-addresses';

const addressFields = [
  { name: 'label', label: 'Address label', placeholder: 'Home' },
  { name: 'line1', label: 'Street address', placeholder: '12 Smith Street' },
  { name: 'unit', label: 'Unit or apartment (optional)', placeholder: '4B' },
  { name: 'suburb', label: 'Suburb or locality' },
  {
    name: 'state',
    label: 'State or territory',
    placeholder: 'NSW',
    maxLength: 3,
  },
  {
    name: 'postcode',
    label: 'Postcode',
    keyboardType: 'number-pad',
    maxLength: 4,
  },
  {
    name: 'accessNotes',
    label: 'Access notes (optional)',
    placeholder: 'Use the side entrance',
    multiline: true,
  },
] as const;

export function ClientAddressForm({
  userId,
  address,
  onBack,
  onSaved,
  initialUseLocation = false,
}: {
  userId: string;
  address: SavedClientAddress | null;
  onBack: () => void;
  onSaved: (onboardingComplete: boolean, saved: SavedClientAddress) => void;
  initialUseLocation?: boolean;
}) {
  const { supabase } = useMobileSession();
  const [showFields, setShowFields] = useState(address !== null);
  const [selected, setSelected] = useState<ClientAddressCandidate>();
  const [text, setText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [locationNotice, setLocationNotice] = useState('');

  const { control, reset, handleSubmit, setError, getValues } =
    useForm<ClientAddressFields>({
      resolver: zodResolver(clientAddressFieldsSchema),
      defaultValues: {
        label: address?.label ?? '',
        line1: address?.line1 ?? '',
        unit: address?.unit ?? '',
        suburb: address?.suburb ?? '',
        ...(address && { state: address.state }),
        postcode: address?.postcode ?? '',
        accessNotes: address?.accessNotes ?? '',
      },
    });

  useEffect(() => {
    const debounce = setTimeout(() => setSearchText(text.trim()), 300);
    return () => clearTimeout(debounce);
  }, [text]);

  const search = useQuery({
    queryKey: queryKeys.addresses.search(userId, searchText),
    queryFn:
      !showFields && searchText.length >= minimumAddressSearchLength
        ? ({ signal }) =>
            clientAddressOperation<'search'>(
              supabase,
              userId,
              { operation: 'search', query: searchText },
              signal,
            )
        : skipToken,
    retry: false,
    gcTime: 0,
  });

  const locate = useMutation({
    async mutationFn() {
      const point = await currentWorkingPoint();
      if (!point) return null;
      return clientAddressOperation<'nearby'>(supabase, userId, {
        operation: 'nearby',
        lat: point.lat,
        lng: point.lng,
      });
    },
    onSuccess(result) {
      if (!result)
        setLocationNotice(
          'Location access is off. You can still enter the address manually.',
        );
    },
    onError() {
      setLocationNotice(
        'Could not find your location. You can still enter the address manually.',
      );
    },
  });

  const didLocate = useRef(false);
  useEffect(() => {
    if (initialUseLocation && !didLocate.current) {
      didLocate.current = true;
      locate.mutate();
    }
  }, [initialUseLocation, locate]);

  const save = useMutation({
    mutationFn: (fields: ClientAddressFields) =>
      clientAddressOperation<'create' | 'update'>(supabase, userId, {
        ...(address
          ? { operation: 'update', id: address.id }
          : { operation: 'create' }),
        address: fields,
        ...(selected && { directoryId: selected.directoryId }),
      }),
    onSuccess(result) {
      onSaved(result.onboardingComplete, result.address);
    },
    onError(error) {
      if (error instanceof EdgeFunctionError && error.status === 422) {
        for (const { name } of addressFields) {
          const message = error.response.fields?.[name];
          if (message) setError(name, { type: 'server', message });
        }
      }
    },
  });

  function chooseCandidate(candidate: ClientAddressCandidate) {
    const { line1, unit, suburb, state, postcode } = candidate;
    reset({ ...getValues(), line1, unit, suburb, state, postcode });
    setSelected(candidate);
    setShowFields(true);
  }

  const hasCurrentSearch =
    text.trim() === searchText &&
    searchText.length >= minimumAddressSearchLength;
  const searchResult = hasCurrentSearch ? search.data : undefined;
  const nearbyResult = locate.data;
  const candidates = locate.isPending
    ? []
    : searchResult
      ? searchResult.candidates
      : !hasCurrentSearch && nearbyResult
        ? nearbyResult.candidates
        : [];
  const submit = handleSubmit((fields) => save.mutate(fields));

  return (
    <Screen
      scroll
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <Text accessibilityRole="header" style={typography.title}>
        {address ? 'Edit address' : 'Add an address'}
      </Text>
      {showFields ? (
        <>
          <Button
            variant="secondary"
            label="Search for an address"
            disabled={save.isPending}
            onPress={() => setShowFields(false)}
          />
          {addressFields.map((item) => {
            const { name, ...props } = item;
            return (
              <Controller
                key={name}
                control={control}
                name={name}
                render={({ field, fieldState }) => (
                  <TextInput
                    {...props}
                    value={field.value ?? ''}
                    onBlur={field.onBlur}
                    onChangeText={(value) => {
                      if (
                        [
                          'line1',
                          'unit',
                          'suburb',
                          'state',
                          'postcode',
                        ].includes(name)
                      )
                        setSelected(undefined);
                      field.onChange(
                        name === 'state' ? value.toUpperCase() : value,
                      );
                    }}
                    error={fieldState.error?.message}
                    editable={!save.isPending}
                  />
                )}
              />
            );
          })}
          {save.isError &&
            !(
              save.error instanceof EdgeFunctionError &&
              save.error.status === 422 &&
              !save.error.response.fields?._request
            ) && (
              <Text
                accessibilityRole="alert"
                style={[typography.body, { color: colors.danger }]}
              >
                {save.error instanceof EdgeFunctionError &&
                save.error.status === 409
                  ? 'This address was archived. Go back to refresh your saved addresses.'
                  : 'Could not save the address. Your entries are still here.'}
              </Text>
            )}
          <Button
            label="Save address"
            loading={save.isPending}
            onPress={() => {
              submit().catch(() => undefined);
            }}
          />
        </>
      ) : (
        <>
          <TextInput
            label="Search Australian addresses"
            value={text}
            editable={!locate.isPending}
            onChangeText={(value) => {
              locate.reset();
              setLocationNotice('');
              setText(value);
            }}
          />
          <Button
            variant="secondary"
            label="Use current location"
            loading={locate.isPending}
            onPress={() => {
              setText('');
              setSearchText('');
              setLocationNotice('');
              locate.mutate();
            }}
          />
          <Button
            variant="ghost"
            label="Enter address manually"
            onPress={() => setShowFields(true)}
          />
          {hasCurrentSearch && search.isFetching && (
            <LoadingState message="Searching addresses…" />
          )}
          {hasCurrentSearch && search.isError && (
            <ErrorState
              message="Could not search addresses. Try again or enter the address manually."
              onRetry={() => {
                search.refetch().catch(() => undefined);
              }}
            />
          )}
          {locationNotice && (
            <Text accessibilityRole="alert" style={typography.body}>
              {locationNotice}
            </Text>
          )}
          {((hasCurrentSearch && search.isSuccess) ||
            (!hasCurrentSearch && nearbyResult)) &&
            !candidates.length && (
              <Text style={typography.body}>
                No addresses found. Try a different search or enter it manually.
              </Text>
            )}
          <View style={{ gap: spacing.sm }}>
            {candidates.map((candidate) => (
              <Button
                key={candidate.directoryId}
                variant="secondary"
                label={formatClientAddress(candidate)}
                onPress={() => chooseCandidate(candidate)}
              />
            ))}
          </View>
        </>
      )}
      <Text style={typography.caption}>
        Incorporates or developed using G-NAF © Geoscape Australia, licensed by
        the Commonwealth of Australia under the Open Geo-coded National Address
        File End User Licence Agreement.
      </Text>
      <Button
        variant="ghost"
        label="Back to addresses"
        disabled={save.isPending}
        onPress={onBack}
      />
    </Screen>
  );
}
