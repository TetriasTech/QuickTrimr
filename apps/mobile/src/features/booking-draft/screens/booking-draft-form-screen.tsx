import { zodResolver } from '@hookform/resolvers/zod';
import { BOOKING_TYPE_VALUE } from '@quicktrimr/shared';
import {
  createBookingRequestRequestSchema,
  type CreateBookingRequestRequest,
} from '@quicktrimr/validation';
import { Button, Card, Screen, TextInput, useTheme } from '@quicktrimr/ui';
import { Controller, useForm } from 'react-hook-form';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useBookingDraftStore } from '@/stores/booking-draft-store';

const exampleRequest = {
  barberId: '44444444-4444-4444-8444-444444444444',
  clientAddressId: '66666666-6666-4666-8666-666666666666',
  serviceCategoryId: '55555555-5555-4555-8555-555555555555',
} as const;

export function BookingDraftFormScreen() {
  const { colors, spacing, typography } = useTheme();
  const draft = useBookingDraftStore();
  const [feedback, setFeedback] = useState('Nothing has been submitted to the server.');
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    setValue,
    watch,
  } = useForm<CreateBookingRequestRequest>({
    defaultValues: {
      barberId: draft.selectedBarberId ?? '',
      bookingType: draft.selectedBookingType ?? BOOKING_TYPE_VALUE.AVAILABLE_NOW,
      clientAddressId: draft.selectedAddressId ?? '',
      serviceCategoryId: draft.selectedServiceCategoryId ?? '',
    },
    resolver: zodResolver(createBookingRequestRequestSchema),
  });

  const bookingType = watch('bookingType');

  const saveDraft = handleSubmit(
    (values) => {
      draft.replaceDraft({
        selectedAddressId: values.clientAddressId,
        selectedBarberId: values.barberId,
        selectedBookingType: values.bookingType,
        selectedServiceCategoryId: values.serviceCategoryId,
      });
      setFeedback('Validated selections saved locally. No booking request was sent.');
    },
    () => setFeedback('Draft not saved. Fix the highlighted fields and try again.'),
  );

  const loadExample = () => {
    setValue('barberId', exampleRequest.barberId, { shouldValidate: true });
    setValue('serviceCategoryId', exampleRequest.serviceCategoryId, {
      shouldValidate: true,
    });
    setValue('clientAddressId', exampleRequest.clientAddressId, {
      shouldValidate: true,
    });
    setValue('bookingType', BOOKING_TYPE_VALUE.AVAILABLE_NOW, {
      shouldValidate: true,
    });
    setFeedback('Example values loaded. Save to put them in the local draft store.');
  };

  return (
    <Screen edges={['right', 'bottom', 'left']} scroll>
      <Text style={typography.title}>Booking draft form</Text>
      <Text selectable style={typography.subhead}>
        This Phase 0 screen demonstrates React Hook Form, the shared booking-request
        schema, and local draft state. It does not call the backend.
      </Text>

      <Card>
        <Text style={typography.headline}>Booking mode</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            label="Available now"
            onPress={() => {
              setValue('bookingType', BOOKING_TYPE_VALUE.AVAILABLE_NOW, {
                shouldValidate: true,
              });
              setValue('scheduledFor', undefined, { shouldValidate: true });
            }}
            style={{ flex: 1 }}
            variant={
              bookingType === BOOKING_TYPE_VALUE.AVAILABLE_NOW ? 'primary' : 'secondary'
            }
          />
          <Button
            label="Scheduled"
            onPress={() =>
              setValue('bookingType', BOOKING_TYPE_VALUE.SCHEDULED, {
                shouldValidate: true,
              })
            }
            style={{ flex: 1 }}
            variant={bookingType === BOOKING_TYPE_VALUE.SCHEDULED ? 'primary' : 'secondary'}
          />
        </View>
        {errors.bookingType ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger }}>
            {errors.bookingType.message}
          </Text>
        ) : null}
      </Card>

      <Card>
        <Controller
          control={control}
          name="barberId"
          render={({ field }) => (
            <TextInput
              autoCapitalize="none"
              error={errors.barberId?.message}
              label="Selected barber ID"
              onBlur={field.onBlur}
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <Controller
          control={control}
          name="serviceCategoryId"
          render={({ field }) => (
            <TextInput
              autoCapitalize="none"
              error={errors.serviceCategoryId?.message}
              label="Selected service category ID"
              onBlur={field.onBlur}
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <Controller
          control={control}
          name="clientAddressId"
          render={({ field }) => (
            <TextInput
              autoCapitalize="none"
              error={errors.clientAddressId?.message}
              label="Selected address ID"
              onBlur={field.onBlur}
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        {bookingType === BOOKING_TYPE_VALUE.SCHEDULED ? (
          <Controller
            control={control}
            name="scheduledFor"
            render={({ field }) => (
              <TextInput
                autoCapitalize="none"
                error={errors.scheduledFor?.message}
                label="Requested time (ISO 8601)"
                onBlur={field.onBlur}
                onChangeText={(value) => field.onChange(value || undefined)}
                placeholder="2026-10-01T09:00:00+10:00"
                value={field.value ?? ''}
              />
            )}
          />
        ) : null}
      </Card>

      <Button label="Load valid example values" onPress={loadExample} variant="secondary" />
      <Button label="Save validated selections" loading={isSubmitting} onPress={saveDraft} />
      <Button
        label="Clear local draft"
        onPress={() => {
          draft.resetDraft();
          setFeedback('Local draft cleared. Form edits remain until this screen closes.');
        }}
        variant="ghost"
      />

      <Text selectable style={[typography.caption, { color: colors.textMuted }]}>
        {feedback}
      </Text>
    </Screen>
  );
}
