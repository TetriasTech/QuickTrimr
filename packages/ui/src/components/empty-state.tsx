import { Text, View, type ViewStyle } from 'react-native';

import { spacing, useTheme } from '../theme';

import { Button, type ButtonVariant } from './button';

export type StateAction = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
};

export interface EmptyStateProps {
  message: string;
  title?: string;
  action?: StateAction;
  testID?: string;
}

export function EmptyState({
  message,
  title,
  action,
  testID,
}: EmptyStateProps) {
  const { typography } = useTheme();

  return (
    <View style={styles.state} testID={testID}>
      {title ? (
        <Text
          accessibilityRole="header"
          style={[typography.editorial, { textAlign: 'center' }]}
        >
          {title}
        </Text>
      ) : null}
      <Text selectable style={[typography.body, { textAlign: 'center' }]}>
        {message}
      </Text>
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          variant={action.variant ?? 'secondary'}
        />
      ) : null}
    </View>
  );
}

const styles = {
  state: {
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.lg,
  },
} as const satisfies Record<string, ViewStyle>;
