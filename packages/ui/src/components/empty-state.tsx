import { Text, View, type ViewStyle } from 'react-native';

import { spacing, typography, useTheme } from '../theme';

import { Button, type ButtonVariant } from './button';

export type StateAction = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
};

export interface EmptyStateProps {
  message: string;
  action?: StateAction;
  testID?: string;
}

export function EmptyState({ message, action, testID }: EmptyStateProps) {
  useTheme();
  return (
    <View style={styles.state} testID={testID}>
      <Text selectable style={typography.body}>
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
