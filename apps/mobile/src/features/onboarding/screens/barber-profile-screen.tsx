import { zodResolver } from '@hookform/resolvers/zod';
import { barberPhotoLimits, barberServiceRadiusKm } from '@quicktrimr/shared';
import {
  Avatar,
  Button,
  ErrorState,
  LoadingState,
  Screen,
  TextInput,
  spacing,
  useTheme,
} from '@quicktrimr/ui';
import {
  barberProfileFormSchema,
  type BarberProfileFields,
  type BarberProfileFormInput,
  type CompleteBarberProfileResponse,
} from '@quicktrimr/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Text, View } from 'react-native';

import { SignOutButton } from '@/features/auth/screens/sign-out-button';
import { ConnectCard } from '@/features/connect/connect-card';
import { useMobileSession } from '@/features/session/session-provider';
import { EdgeFunctionError } from '@/lib/api/invoke-edge-function';
import { mobileEnv } from '@/lib/env';
import { queryKeys } from '@/lib/query/query-keys';

import {
  readBarberProfile,
  saveBarberProfile,
  uploadBarberPhoto,
} from '../barber-profile';
import { pickProfileJpeg } from '../pick-profile-jpeg';

import {
  BarberServiceAreaPicker,
  type ServiceAreaCentre,
} from './barber-service-area-picker';

const fields = [
  { name: 'displayName', label: 'Display name', autoComplete: 'name' },
  {
    name: 'bio',
    label: 'Bio',
    multiline: true,
    placeholder: 'Introduce yourself and your work',
  },
  {
    name: 'yearsExperience',
    label: 'Years of experience',
    keyboardType: 'number-pad',
  },
] as const;

function profileDefaults(
  profile: CompleteBarberProfileResponse | null,
): BarberProfileFormInput {
  return {
    displayName: profile?.displayName ?? '',
    bio: profile?.bio ?? '',
    yearsExperience: profile ? String(profile.yearsExperience) : '',
    serviceRadiusKm: profile ? String(profile.serviceRadiusKm) : '',
  };
}

export function BarberProfileScreen({ userId }: { userId: string }) {
  const { supabase } = useMobileSession();
  const profile = useQuery({
    queryKey: queryKeys.onboarding.barberProfile(userId),
    queryFn: ({ signal }) => readBarberProfile(supabase, userId, signal),
    retry: false,
    gcTime: 0,
  });
  if (!profile.data) {
    return (
      <Screen>
        {profile.isError ? (
          <>
            <ErrorState
              message="Could not load your profile."
              onRetry={() => {
                profile.refetch().catch(() => undefined);
              }}
            />
            <SignOutButton />
          </>
        ) : (
          <LoadingState message="Loading your barber profile…" />
        )}
      </Screen>
    );
  }
  return <BarberProfileForm userId={userId} profile={profile.data.profile} />;
}

function BarberProfileForm({
  userId,
  profile,
}: {
  userId: string;
  profile: CompleteBarberProfileResponse | null;
}) {
  const { colors, typography } = useTheme();
  const { supabase } = useMobileSession();
  const cache = useQueryClient();
  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { isDirty },
  } = useForm<BarberProfileFormInput, unknown, BarberProfileFields>({
    resolver: zodResolver(barberProfileFormSchema),
    defaultValues: profileDefaults(profile),
  });
  const name = useWatch({ control, name: 'displayName' });
  const [centre, setCentre] = useState<ServiceAreaCentre | null>(null);
  const [photo, setPhoto] = useState<{ uri: string; id?: string } | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [areaError, setAreaError] = useState('');
  const [saved, setSaved] = useState(false);
  const pickPhoto = useMutation({
    mutationFn: () => pickProfileJpeg(barberPhotoLimits.maxPixelsPerSide),
    onSuccess(uri) {
      if (uri) setPhoto({ uri });
    },
    onError() {
      setPhotoError('Could not use that photo. Try another image.');
    },
  });
  const save = useMutation({
    async mutationFn(values: BarberProfileFields) {
      await cache.cancelQueries({
        queryKey: queryKeys.onboarding.barberProfile(userId),
      });
      let photoId = photo?.id;
      if (photo && !photoId) {
        try {
          photoId = await uploadBarberPhoto(supabase, userId, photo.uri);
          setPhoto({ ...photo, id: photoId });
        } catch (error) {
          setPhotoError(
            error instanceof EdgeFunctionError && error.response.fields?.photo
              ? error.response.fields.photo
              : 'Could not upload your photo. Your form is still here.',
          );
          throw error;
        }
      }
      return saveBarberProfile(supabase, userId, {
        ...values,
        ...(centre?.type === 'address' && {
          serviceAreaDirectoryId: centre.id,
        }),
        ...(centre?.type === 'gps' && {
          serviceAreaLat: centre.lat,
          serviceAreaLng: centre.lng,
        }),
        ...(photoId && { photoId }),
      });
    },
    onSuccess(result) {
      setPhoto(null);
      setCentre(null);
      reset(profileDefaults(result));
      setSaved(true);
      cache.setQueryData(queryKeys.onboarding.barberProfile(userId), {
        profile: result,
      });
    },
    onError(error) {
      if (!(error instanceof EdgeFunctionError)) return;
      const errors = error.response.fields;
      if (!errors) return;
      for (const field of [
        'displayName',
        'bio',
        'yearsExperience',
        'serviceRadiusKm',
      ] as const)
        if (errors[field]) setError(field, { message: errors[field] });
      if (errors.serviceAreaDirectoryId)
        setAreaError(errors.serviceAreaDirectoryId);
      if (errors.photo) {
        setPhotoError(errors.photo);
        if (photo) setPhoto({ uri: photo.uri });
      }
    },
  });
  const busy = save.isPending || pickPhoto.isPending;
  const photoUri =
    photo?.uri ??
    (profile?.photoUrl
      ? new URL(profile.photoUrl, mobileEnv.supabaseUrl).href
      : undefined);

  function chooseCentre(value: ServiceAreaCentre | null) {
    setCentre(value);
    setAreaError('');
    setSaved(false);
  }

  return (
    <Screen scroll contentContainerStyle={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.xs }}>
        <Text style={typography.title}>Barber profile</Text>
        {profile ? (
          <Text style={typography.body}>
            Public area: {profile.approximateArea.label}
          </Text>
        ) : (
          <Text style={typography.body}>
            Add your profile and choose a Scheduled service area.
          </Text>
        )}
      </View>
      <View style={{ gap: spacing.sm }}>
        <Avatar
          accessibilityLabel="Profile photo"
          initials={name.trim().slice(0, 2).toUpperCase() || 'QT'}
          size="large"
          {...(photoUri ? { source: { uri: photoUri } } : {})}
        />
        <Button
          label={photoUri ? 'Change profile photo' : 'Choose profile photo'}
          variant="secondary"
          disabled={busy}
          loading={pickPhoto.isPending}
          onPress={() => {
            setPhotoError('');
            setSaved(false);
            pickPhoto.mutate();
          }}
        />
        {photoError ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger }}>
            {photoError}
          </Text>
        ) : null}
      </View>
      {fields.map(({ name: fieldName, ...props }) => (
        <Controller
          key={fieldName}
          control={control}
          name={fieldName}
          render={({ field, fieldState }) => (
            <TextInput
              {...props}
              value={field.value}
              editable={!busy}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
      ))}
      <BarberServiceAreaPicker
        key={profile?.approximateArea.id ?? 'new'}
        userId={userId}
        centre={centre}
        onChange={chooseCentre}
        savedArea={profile?.approximateArea.label}
        disabled={busy}
        error={areaError}
      />
      <Controller
        control={control}
        name="serviceRadiusKm"
        render={({ field, fieldState }) => (
          <TextInput
            label="Travel radius (km)"
            placeholder={`${barberServiceRadiusKm.min}–${barberServiceRadiusKm.max} km`}
            value={field.value}
            keyboardType="decimal-pad"
            editable={!busy}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Button
        label="Save barber profile"
        loading={save.isPending}
        disabled={busy}
        onPress={() => {
          handleSubmit((values) => {
            setPhotoError('');
            setAreaError('');
            setSaved(false);
            if (!centre && !profile) {
              setAreaError(
                'Choose an address or confirm your current location.',
              );
              return;
            }
            save.mutate(values);
          })().catch(() => undefined);
        }}
      />
      {saved && !isDirty ? (
        <Text accessibilityLiveRegion="polite" style={typography.body}>
          Profile saved.
        </Text>
      ) : null}
      {save.isError && !photoError && !areaError ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          Could not save your profile. Try again.
        </Text>
      ) : null}
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Public areas use the Australian Bureau of Statistics Suburbs and
        Localities dataset, CC BY 4.0.
      </Text>
      <ConnectCard />
      <Button
        label="Available Now"
        onPress={() => router.push('/available-now')}
      />
      <Button
        label="Services & prices"
        variant="secondary"
        onPress={() => router.push('/barber-services')}
      />
      <SignOutButton />
    </Screen>
  );
}
