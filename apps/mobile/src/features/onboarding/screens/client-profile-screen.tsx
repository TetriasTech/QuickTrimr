import { zodResolver } from '@hookform/resolvers/zod';
import {
  Avatar,
  Button,
  ErrorState,
  LoadingState,
  Screen,
  TextInput,
  colors,
  sizes,
  spacing,
  typography,
} from '@quicktrimr/ui';
import {
  completeClientProfileRequestSchema,
  type CompleteClientProfileRequest,
} from '@quicktrimr/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { PixelRatio, Text, View } from 'react-native';

import { SignOutButton } from '@/features/auth/screens/sign-out-button';
import { useMobileSession } from '@/features/session/session-provider';
import { EdgeFunctionError } from '@/lib/api/invoke-edge-function';
import { queryKeys } from '@/lib/query/query-keys';

import {
  readClientProfile,
  removeClientDraft,
  saveClientProfile,
  writeClientDraft,
} from '../client-profile';

import type { loadProfile } from '@/features/session/load-profile';

export function ClientProfileScreen({ userId }: { userId: string }) {
  const { supabase } = useMobileSession();
  const profile = useQuery({
    queryKey: queryKeys.onboarding.clientProfile(userId),
    queryFn: ({ signal }) => readClientProfile(supabase, userId, signal),
    retry: false,
  });
  if (profile.isError) {
    return (
      <Screen>
        <ErrorState
          message="Could not load your profile."
          onRetry={() => {
            profile.refetch().catch(() => undefined);
          }}
        />
        <SignOutButton />
      </Screen>
    );
  }
  if (!profile.data)
    return (
      <Screen>
        <LoadingState message="Loading your profile…" />
      </Screen>
    );
  return <ClientProfileForm userId={userId} initial={profile.data} />;
}

function ClientProfileForm({
  userId,
  initial,
}: {
  userId: string;
  initial: Awaited<ReturnType<typeof readClientProfile>>;
}) {
  const { supabase } = useMobileSession();
  const queryClient = useQueryClient();
  const { control, getValues, handleSubmit, reset, setError } =
    useForm<CompleteClientProfileRequest>({
      resolver: zodResolver(completeClientProfileRequestSchema),
      defaultValues: {
        displayName: initial.draft.displayName,
        mobile: initial.draft.mobile,
      },
    });
  const [avatarUri, setAvatarUri] = useState(initial.draft.avatarUri);
  const [saved, setSaved] = useState(initial.saved);
  const [hasAvatar, setHasAvatar] = useState(initial.hasAvatar);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const writes = useRef(Promise.resolve());

  function persist(fields = getValues(), photo = avatarUri) {
    const draft = {
      displayName: fields.displayName,
      mobile: fields.mobile,
      avatarUri: photo,
    };
    // Native writes can complete out of order when the user types quickly.
    writes.current = writes.current
      .then(() => writeClientDraft(userId, draft))
      .then(
        () => setDraftError(false),
        () => setDraftError(true),
      );
  }

  async function choosePhoto() {
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
      });
      const asset = result.assets?.[0];
      if (!asset) return;
      const image = ImageManipulator.manipulate(asset.uri);
      const pixels = PixelRatio.getPixelSizeForLayoutSize(sizes.avatarLarge);
      if (Math.max(asset.width, asset.height) > pixels) {
        image.resize(
          asset.width >= asset.height ? { width: pixels } : { height: pixels },
        );
      }
      const jpeg = await (
        await image.renderAsync()
      ).saveAsync({ format: SaveFormat.JPEG });
      setAvatarUri(jpeg.uri);
      persist(getValues(), jpeg.uri);
    } catch {
      setPhotoError('Could not use that photo. Try another image.');
    } finally {
      setPhotoBusy(false);
    }
  }

  const save = useMutation({
    mutationFn: (values: CompleteClientProfileRequest) =>
      saveClientProfile(supabase, userId, values, avatarUri),
    async onSuccess(profile) {
      reset({ displayName: profile.displayName, mobile: profile.mobile });
      setSaved(!profile.onboardingComplete);
      setHasAvatar(hasAvatar || avatarUri !== null);
      setAvatarUri(null);
      await writes.current;
      await removeClientDraft(userId).catch(() => setDraftError(true));
      queryClient.setQueryData(queryKeys.onboarding.clientProfile(userId), {
        draft: {
          displayName: profile.displayName,
          mobile: profile.mobile,
          avatarUri: null,
        },
        saved: true,
        hasAvatar: hasAvatar || avatarUri !== null,
      });
      queryClient.setQueryData<Awaited<ReturnType<typeof loadProfile>>>(
        queryKeys.session.profile(userId),
        (previous) =>
          previous && {
            ...previous,
            onboardingComplete: profile.onboardingComplete,
          },
      );
    },
    onError(error) {
      if (error instanceof EdgeFunctionError && error.status === 422) {
        for (const key of ['displayName', 'mobile'] as const) {
          const message = error.response.fields?.[key];
          if (message) setError(key, { type: 'server', message });
        }
      }
    },
  });

  if (saved) {
    return (
      <Screen scroll>
        <Text accessibilityRole="header" style={typography.title}>
          Profile saved
        </Text>
        <Text style={typography.body}>
          A service address is needed to finish setup.
        </Text>
        <Button
          label="Edit profile"
          variant="secondary"
          onPress={() => {
            save.reset();
            setSaved(false);
          }}
        />
        <SignOutButton />
      </Screen>
    );
  }

  const busy = photoBusy || save.isPending;
  const submit = handleSubmit((values) => save.mutate(values));
  return (
    <Screen
      scroll
      contentContainerStyle={{ gap: spacing.lg, padding: spacing.lg }}
    >
      <Text accessibilityRole="header" style={typography.title}>
        Set up your profile
      </Text>
      <Controller
        control={control}
        name="displayName"
        render={({ field, fieldState }) => (
          <TextInput
            label="Display name"
            value={field.value}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            autoComplete="name"
            editable={!busy}
            onChangeText={(displayName) => {
              field.onChange(displayName);
              persist({ ...getValues(), displayName });
            }}
          />
        )}
      />
      <Controller
        control={control}
        name="mobile"
        render={({ field, fieldState }) => (
          <TextInput
            label="Mobile number"
            value={field.value}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            autoComplete="tel"
            keyboardType="phone-pad"
            editable={!busy}
            onChangeText={(mobile) => {
              field.onChange(mobile);
              persist({ ...getValues(), mobile });
            }}
          />
        )}
      />
      <View style={{ gap: spacing.sm }}>
        <Text style={typography.subhead}>Profile photo (optional)</Text>
        {avatarUri && (
          <Avatar
            accessibilityLabel="Selected profile photo"
            initials=""
            source={{ uri: avatarUri }}
            size="large"
          />
        )}
        {hasAvatar && !avatarUri && (
          <Text style={typography.body}>Profile photo saved</Text>
        )}
        <Button
          label={
            avatarUri || hasAvatar ? 'Choose another photo' : 'Choose a photo'
          }
          variant="secondary"
          loading={photoBusy}
          disabled={save.isPending}
          onPress={() => {
            choosePhoto().catch(() => setPhotoError('Could not open photos.'));
          }}
        />
        {avatarUri && (
          <Button
            label="Clear selected photo"
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setAvatarUri(null);
              persist(getValues(), null);
            }}
          />
        )}
      </View>
      {photoError && (
        <Text
          accessibilityRole="alert"
          style={{ ...typography.body, color: colors.danger }}
        >
          {photoError}
        </Text>
      )}
      {draftError && (
        <Text
          accessibilityRole="alert"
          style={{ ...typography.body, color: colors.danger }}
        >
          Could not save your draft on this device. Keep the screen open to
          retain your entries.
        </Text>
      )}
      {save.isError && (
        <Text
          accessibilityRole="alert"
          style={{ ...typography.body, color: colors.danger }}
        >
          Could not save your profile. Your entries are still here.
        </Text>
      )}
      <Button
        label="Save profile"
        loading={save.isPending}
        disabled={photoBusy}
        onPress={() => {
          submit().catch(() => undefined);
        }}
      />
      {!busy && <SignOutButton />}
    </Screen>
  );
}
