import { ActivityIndicator, Text, View, type ViewStyle } from 'react-native';

import { colors, spacing, typography, useTheme } from '../theme';

export interface LoadingStateProps {
  message?: string;
  testID?: string;
}

export function LoadingState({ message = 'Loading…', testID }: LoadingStateProps) {
  useTheme();
  return (
    <View
      accessible
      accessibilityLabel={message}
      accessibilityRole="progressbar"
      style={styles.state}
      testID={testID}
    >
      <ActivityIndicator color={colors.accent} />
      <Text style={typography.subhead}>{message}</Text>
    </View>
  );
}

const styles = {
  state: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.lg,
  },
} as const satisfies Record<string, ViewStyle>;
