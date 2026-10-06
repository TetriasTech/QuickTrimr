import { BOOKING_STATUS_VALUE } from '@quicktrimr/shared';
import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  StatusBadge,
  TextInput,
  useTheme,
} from '@quicktrimr/ui';
import { useState } from 'react';
import { Text, View } from 'react-native';

export function UiPrimitivesScreen() {
  const { colors, spacing, typography } = useTheme();
  const [displayName, setDisplayName] = useState('Andrew');
  const [isSheetPresented, setSheetPresented] = useState(false);
  const [isDialogPresented, setDialogPresented] = useState(false);
  const [feedback, setFeedback] = useState('Actions are ready to try.');

  return (
    <Screen edges={['right', 'bottom', 'left']} scroll>
      <Text style={typography.title}>Shared mobile UI</Text>
      <Text selectable style={typography.subhead}>
        Every Phase 0 primitive is rendered here against the central theme.
      </Text>

      <Card>
        <Text style={typography.headline}>Buttons and input</Text>
        <Button
          label="Primary action"
          onPress={() => setFeedback('Primary action pressed.')}
        />
        <Button
          label="Secondary action"
          onPress={() => setFeedback('Secondary action pressed.')}
          variant="secondary"
        />
        <Button label="Loading action" loading />
        <TextInput
          label="Display name"
          onChangeText={setDisplayName}
          value={displayName}
        />
      </Card>

      <Card variant="outlined">
        <Text style={typography.headline}>Identity and status</Text>
        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            gap: spacing.md,
          }}
        >
          <Avatar
            accessibilityLabel="Andrew profile placeholder"
            initials="AG"
          />
          <View style={{ gap: spacing.sm }}>
            <Badge label="Available" tone="success" />
            <StatusBadge status={BOOKING_STATUS_VALUE.PAID_CONFIRMED} />
          </View>
        </View>
      </Card>

      <Card>
        <Text style={typography.headline}>Screen states</Text>
        <LoadingState message="Loading bookings" />
        <EmptyState
          action={{
            label: 'Reset filters',
            onPress: () => setFeedback('Empty-state action pressed.'),
          }}
          message="No bookings match these filters."
        />
        <ErrorState
          message="Bookings could not be loaded."
          onRetry={() => setFeedback('Retry pressed.')}
        />
      </Card>

      <Card variant="raised">
        <Text style={typography.headline}>Overlays</Text>
        <Button
          label="Open bottom sheet"
          onPress={() => setSheetPresented(true)}
          variant="secondary"
        />
        <Button
          label="Open destructive confirmation"
          onPress={() => setDialogPresented(true)}
          variant="destructive"
        />
      </Card>

      <Text
        selectable
        style={[typography.caption, { color: colors.textMuted }]}
      >
        {feedback}
      </Text>

      <BottomSheet
        isPresented={isSheetPresented}
        onDismiss={() => setSheetPresented(false)}
        testID="primitive-example-bottom-sheet"
      >
        <View style={{ gap: spacing.md }}>
          <Text style={typography.headline}>Native bottom sheet</Text>
          <Text style={typography.body}>
            This content is composed with shared primitives.
          </Text>
          <Button label="Close" onPress={() => setSheetPresented(false)} />
        </View>
      </BottomSheet>

      <ConfirmDialog
        confirmLabel="Delete example"
        consequence="This removes only the example entry and cannot be undone."
        destructive
        onCancel={() => setDialogPresented(false)}
        onConfirm={() => {
          setDialogPresented(false);
          setFeedback('Destructive example confirmed.');
        }}
        title="Delete the example?"
        visible={isDialogPresented}
      />
    </Screen>
  );
}
