import { Text, View, type ViewStyle } from 'react-native';

import { spacing, useTheme } from '../theme';

import { Button } from './button';

export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  testID?: string;
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Try again',
  testID,
}: ErrorStateProps) {
  const { colors, typography } = useTheme();
  const styles = {
    message: {
      ...typography.body,
      color: colors.danger,
      textAlign: 'center',
    },
    state: {
      alignItems: 'center',
      gap: spacing.md,
      justifyContent: 'center',
      padding: spacing.lg,
    },
  } as const satisfies Record<string, ViewStyle | TextStyle>;
  return (
    <View style={styles.state} testID={testID}>
      <Text accessibilityRole="alert" selectable style={styles.message}>
        {message}
      </Text>
      <Button label={retryLabel} onPress={onRetry} variant="secondary" />
    </View>
  );
}

type TextStyle = import('react-native').TextStyle;
