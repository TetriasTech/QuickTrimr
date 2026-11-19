import { Button, TextInput, colors, spacing, typography } from '@quicktrimr/ui';
import { minimumAddressSearchLength } from '@quicktrimr/validation';
import { skipToken, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { formatClientAddress } from '@/features/addresses/client-addresses';
import { searchBarberServiceAreas } from '@/features/onboarding/barber-profile';
import { useMobileSession } from '@/features/session/session-provider';
import { queryKeys } from '@/lib/query/query-keys';

import { currentWorkingPoint } from './current-working-point';

export type WorkingLocationCentre =
  | { type: 'address'; id: string; label: string }
  | { type: 'gps'; lat: number; lng: number };

type GpsCentre = Extract<WorkingLocationCentre, { type: 'gps' }>;

export function WorkingLocationPicker({
  userId,
  mode = 'scheduled',
  centre,
  onChange,
  savedArea,
  disabled,
  error,
}: {
  userId: string;
  mode?: 'scheduled' | 'available';
  centre: WorkingLocationCentre | null;
  onChange: (centre: WorkingLocationCentre | null) => void;
  savedArea: string | undefined;
  disabled: boolean;
  error: string | undefined;
}) {
  const available = mode === 'available';
  const { supabase } = useMobileSession();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [pendingGps, setPendingGps] = useState<GpsCentre | null>(null);
  const [notice, setNotice] = useState('');
  const trimmed = text.trim();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(trimmed), 300);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const searching = !centre && trimmed.length >= minimumAddressSearchLength;
  const candidates = useQuery({
    queryKey: queryKeys.onboarding.barberAreaLookup(userId, query),
    queryFn:
      searching && query === trimmed
        ? ({ signal }) =>
            searchBarberServiceAreas(supabase, userId, query, signal)
        : skipToken,
    retry: false,
    gcTime: 0,
  });

  const locate = useMutation({
    mutationFn: currentWorkingPoint,
    onSuccess(current) {
      setPendingGps(current);
      if (!current)
        setNotice('Location access is off. Search for an address instead.');
    },
    onError() {
      setNotice(
        'Could not get your location. Try again or search for an address.',
      );
    },
  });
  const selection =
    centre?.type === 'address' ? centre.label : 'Current location confirmed';
  const busy = disabled || locate.isPending;

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={typography.headline}>
        {available ? 'Available Now location' : 'Scheduled service area'}
      </Text>
      <Text style={[typography.body, { color: colors.textMuted }]}>
        {available
          ? 'Choose where you are working now. Clients see the suburb or locality.'
          : 'Choose where you start travelling for scheduled bookings. Clients see the suburb or locality.'}
      </Text>
      {savedArea && !centre ? (
        <Text style={typography.body}>Saved area: {savedArea}</Text>
      ) : null}
      {centre ? (
        <>
          <Text style={typography.body}>{selection}</Text>
          <Button
            label={available ? 'Change location' : 'Change centre'}
            variant="secondary"
            disabled={busy}
            onPress={() => {
              onChange(null);
              setText('');
            }}
          />
        </>
      ) : (
        <>
          <TextInput
            label="Search an Australian address"
            value={text}
            editable={!busy}
            onChangeText={setText}
          />
          {searching && (query !== trimmed || candidates.isFetching) ? (
            <Text accessibilityLiveRegion="polite" style={typography.body}>
              Searching addresses…
            </Text>
          ) : null}
          {searching && query === trimmed && candidates.isError ? (
            <Button
              label="Retry address search"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                candidates.refetch().catch(() => undefined);
              }}
            />
          ) : null}
          {searching && query === trimmed && candidates.data?.length === 0 ? (
            <Text style={typography.body}>
              No matching addresses. Try adding the suburb or postcode.
            </Text>
          ) : null}
          {searching && query === trimmed
            ? candidates.data?.map((candidate) => {
                const label = formatClientAddress(candidate);
                return (
                  <Button
                    key={candidate.directoryId}
                    label={label}
                    variant="secondary"
                    disabled={busy}
                    onPress={() => {
                      setPendingGps(null);
                      setNotice('');
                      setText('');
                      onChange({
                        type: 'address',
                        id: candidate.directoryId,
                        label,
                      });
                    }}
                  />
                );
              })
            : null}
          {pendingGps ? (
            <>
              <Text style={typography.body}>
                {available
                  ? 'Use this location for your Available Now session?'
                  : 'Use this location as your private service-area centre?'}
              </Text>
              <Button
                label="Confirm current location"
                disabled={busy}
                onPress={() => {
                  onChange(pendingGps);
                  setPendingGps(null);
                }}
              />
              <Button
                label="Cancel location selection"
                variant="secondary"
                disabled={busy}
                onPress={() => setPendingGps(null)}
              />
            </>
          ) : (
            <Button
              label="Use current location"
              variant="secondary"
              disabled={disabled}
              loading={locate.isPending}
              onPress={() => {
                setNotice('');
                locate.mutate();
              }}
            />
          )}
        </>
      )}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={typography.body}>
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Address search uses G-NAF © Geoscape Australia, licensed by the
        Commonwealth of Australia under the Open G-NAF User Licence.
      </Text>
    </View>
  );
}
