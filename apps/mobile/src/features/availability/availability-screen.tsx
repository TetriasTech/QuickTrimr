import { Host, Switch } from '@expo/ui';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { availableNowBoundsFit } from '@quicktrimr/domain';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  TextInput,
  spacing,
  useTheme,
} from '@quicktrimr/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Text, View } from 'react-native';

import {
  WorkingLocationPicker,
  type WorkingLocationCentre,
} from '@/features/locations/working-location-picker';
import { useMobileSession } from '@/features/session/session-provider';
import { EdgeFunctionError } from '@/lib/api/invoke-edge-function';
import { queryKeys } from '@/lib/query/query-keys';

import { availabilityApi } from './availability-api';
import {
  availabilityStatus,
  remainingText,
  restrictionText,
  standingLabels,
} from './availability-presentation';

import type {
  OwnAvailableNowState,
  StartAvailableNowSessionRequest,
} from '@quicktrimr/validation';

type Values = { radius: string; end: string };
export function AvailabilityScreen({ userId }: { userId: string }) {
  const { colors, typography } = useTheme();
  const { supabase } = useMobileSession();
  const api = availabilityApi(supabase, userId);
  const cache = useQueryClient();
  const key = queryKeys.availability.state(userId);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.read(signal),
    gcTime: 0,
  });
  const form = useForm<Values>({ defaultValues: { radius: '', end: '' } });
  const values = useWatch({ control: form.control });
  const hydrated = useRef(false);
  const [centre, setCentre] = useState<WorkingLocationCentre | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [notice, setNotice] = useState('');
  const [locationError, setLocationError] = useState<string | undefined>();
  useEffect(() => {
    if (!query.data || hydrated.current) return;
    hydrated.current = true;
    form.reset({
      radius: String(
        query.data.session?.radiusKm ?? query.data.config.minRadiusKm,
      ),
      end:
        query.data.session?.isActive && query.data.session.availableUntil
          ? query.data.session.availableUntil
          : new Date(
              Date.parse(query.data.serverNow) +
                query.data.config.maxHours * 3600000,
            ).toISOString(),
    });
  }, [query.data, form]);
  const change = useMutation({
    async mutationFn(action: 'start' | 'stop' | 'update') {
      setNotice('');
      form.clearErrors();
      setLocationError(undefined);
      if (action === 'stop') {
        const id = query.data?.session?.id;
        if (!id) throw new Error('No session.');
        await api.stop(id);
      } else {
        const input = {
          radiusKm: Number(values.radius),
          availableUntil: values.end ?? '',
        };
        const location: Partial<StartAvailableNowSessionRequest> =
          centre?.type === 'address'
            ? { directoryId: centre.id, locationSource: 'manual' }
            : centre?.type === 'gps'
              ? { lat: centre.lat, lng: centre.lng, locationSource: 'gps' }
              : {};
        if (action === 'update' && query.data?.session?.isActive) {
          await api.update({
            ...input,
            sessionId: query.data.session.id,
            ...(centre ? location : { keepLocation: true }),
          });
        } else await api.start({ ...input, ...location });
      }
      // A successful mutation followed by a failed read must be described as
      // unconfirmed state, not as a failed write or an optimistically enabled switch.
      setNotice('Change saved. Refreshing the server state…');
      const current = await api.read(new AbortController().signal);
      return current;
    },
    onSuccess(state) {
      cache.setQueryData(key, state);
      setNotice('');
      setCentre(null);
    },
    async onError(error) {
      if (error instanceof EdgeFunctionError) {
        const fields = error.response.fields ?? {};
        setLocationError(
          fields.directoryId ??
            fields.lat ??
            fields.lng ??
            fields.locationSource ??
            fields.keepLocation,
        );
        if (fields.radiusKm)
          form.setError('radius', { message: fields.radiusKm });
        if (fields.availableUntil)
          form.setError('end', { message: fields.availableUntil });
        setNotice(
          error.response.error === 'barber_unavailable'
            ? 'Your availability restriction changed. Check your standing above.'
            : error.response.error === 'onboarding_incomplete'
              ? 'Complete Stripe verification and payout setup before switching on.'
              : 'Could not save the change. Your entries have been kept.',
        );
      } else
        setNotice(
          'Could not confirm the change. Refresh to check the server state; your entries have been kept.',
        );
      await cache.invalidateQueries({ queryKey: key });
    },
  });
  const data = query.data;
  if (!data)
    return (
      <Screen scroll>
        {query.error ? (
          <ErrorState
            message="Check your connection and try again."
            onRetry={() => {
              query.refetch().catch(() => undefined);
            }}
          />
        ) : (
          <LoadingState message="Loading availability…" />
        )}
      </Screen>
    );
  const isActive = Boolean(data.session?.isActive);
  const fits = availableNowBoundsFit(
    Number(values.radius),
    Date.parse(values.end ?? ''),
    Date.parse(data.serverNow),
    data.config,
  );
  const canStart =
    data.onboardingEligible &&
    data.reliability.availableNowAllowed &&
    !query.isError;
  const valid =
    fits.radiusKm && fits.availableUntil && (centre !== null || isActive);
  const busy = change.isPending;
  const maximum = new Date(
    Date.parse(data.serverNow) + data.config.maxHours * 3600000,
  );
  const endDate = new Date(values.end || maximum.toISOString());
  return (
    <Screen scroll contentContainerStyle={{ gap: spacing.lg }}>
      {query.isError ? (
        <ErrorState
          message="Showing the last server state. Refresh before switching on."
          onRetry={() => {
            query.refetch().catch(() => undefined);
          }}
        />
      ) : null}
      <Card>
        <Text style={typography.headline} selectable>
          {availabilityStatus(data)}
        </Text>
        <Host seedColor={colors.accent} matchContents>
          <Switch
            label="Available Now"
            testID="available-now-toggle"
            value={isActive}
            disabled={busy || (!isActive && (!canStart || !valid))}
            onValueChange={(enabled) => {
              if (busy) return;
              change.mutate(enabled ? 'start' : 'stop');
            }}
          />
        </Host>
        <Text style={typography.body}>
          Switch on when you are ready to receive Available Now requests.
          Clients see your approximate area.
        </Text>
      </Card>
      <Card>
        <Text style={typography.headline}>Your standing</Text>
        <Text selectable style={typography.body}>
          Standing: {standingLabels[data.reliability.level]}
        </Text>
        <Text selectable style={typography.body}>
          {restrictionText(data)}
        </Text>
        {!data.reliability.requiresHumanReinstatement ? (
          <Text selectable style={typography.body}>
            {data.reliability.recoveryEligibleAt
              ? `Recovery eligibility: ${new Date(data.reliability.recoveryEligibleAt).toLocaleString()}. The server rechecks your standing.`
              : 'Recovery timing is not available yet.'}
          </Text>
        ) : null}
        {data.reliability.reviewRequired ? (
          <Text style={typography.body}>Your standing needs human review.</Text>
        ) : null}
        {!data.onboardingEligible ? (
          <Text style={typography.body}>
            Complete Stripe verification with both payments and payouts enabled
            before switching on.
          </Text>
        ) : null}
      </Card>
      {data.session ? (
        <Card>
          <SessionDetails state={data} />
        </Card>
      ) : (
        <EmptyState message="Choose a location, radius and end time, then switch on." />
      )}
      <WorkingLocationPicker
        userId={userId}
        mode="available"
        centre={centre}
        onChange={(value) => {
          setCentre(value);
          setLocationError(undefined);
        }}
        savedArea={isActive ? data.session?.approximateArea?.label : undefined}
        disabled={busy}
        error={locationError}
      />
      {isActive && !centre ? (
        <Text style={typography.body}>
          Your saved session location will be kept when you update the radius or
          end time.
        </Text>
      ) : null}
      <Text selectable style={typography.body}>
        Radius: {data.config.minRadiusKm}–{data.config.maxRadiusKm} km,
        including fractions.
      </Text>
      <Controller
        control={form.control}
        name="radius"
        render={({ field, fieldState }) => (
          <TextInput
            label="Radius (km)"
            keyboardType="decimal-pad"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            editable={!busy}
            error={
              fieldState.error?.message ??
              (!fits.radiusKm
                ? 'Enter a radius within the displayed limits.'
                : undefined)
            }
          />
        )}
      />
      <Text selectable style={typography.body}>
        End time: strictly in the future, up to {data.config.maxHours} hours
        from server time.
      </Text>
      <Text selectable style={typography.body}>
        {values.end
          ? new Date(values.end).toLocaleString()
          : 'Choose an end time'}
      </Text>
      <View style={{ gap: spacing.sm }}>
        <Button
          label="Choose end date"
          variant="secondary"
          disabled={busy}
          onPress={() => setPicker('date')}
        />
        <Button
          label="Choose end time"
          variant="secondary"
          disabled={busy}
          onPress={() => setPicker('time')}
        />
      </View>
      {picker ? (
        <DateTimePicker
          value={endDate}
          mode={picker}
          minimumDate={new Date(data.serverNow)}
          maximumDate={maximum}
          onDismiss={() => setPicker(null)}
          onValueChange={(_, date) => {
            form.setValue('end', date.toISOString(), { shouldDirty: true });
            setPicker(null);
          }}
        />
      ) : null}
      {form.formState.errors.end?.message ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {form.formState.errors.end.message}
        </Text>
      ) : null}
      {!fits.availableUntil ? (
        <Text style={{ color: colors.danger }}>
          Choose an end time within the displayed limits.
        </Text>
      ) : null}
      {isActive ? (
        <Button
          label="Update session"
          disabled={!canStart || !valid}
          loading={busy}
          onPress={() => change.mutate('update')}
        />
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" selectable style={typography.body}>
          {notice}
        </Text>
      ) : null}
      <Text
        selectable
        style={[typography.caption, { color: colors.textMuted }]}
      >
        Last checked: {new Date(data.serverNow).toLocaleString()}. Eligibility
        and expiry are decided by the server.
      </Text>
      <Button
        label="Refresh availability"
        variant="secondary"
        disabled={busy}
        loading={query.isFetching}
        onPress={() => {
          query.refetch().catch(() => undefined);
        }}
      />
    </Screen>
  );
}
function SessionDetails({ state }: { state: OwnAvailableNowState }) {
  const { typography } = useTheme();
  const s = state.session;
  if (!s) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <Text selectable style={typography.body}>
        Area: {s.approximateArea?.label ?? 'Unavailable'}
      </Text>
      <Text selectable style={typography.body}>
        Radius: {s.radiusKm ?? 'Unavailable'} km
      </Text>
      <Text style={typography.body}>
        Location:{' '}
        {s.locationSource === 'gps'
          ? 'GPS'
          : s.locationSource === 'manual'
            ? 'Manual'
            : 'Unavailable'}
      </Text>
      {s.availableUntil ? (
        <>
          <Text selectable style={typography.body}>
            {s.isActive ? 'Ends' : 'Session end time'}:{' '}
            {new Date(s.availableUntil).toLocaleString()}
          </Text>
          {s.isActive ? (
            <Text style={typography.body}>
              {remainingText(s.availableUntil, state.serverNow)}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
