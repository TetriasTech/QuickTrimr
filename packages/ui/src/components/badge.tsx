import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing, typography, useTheme } from '../theme';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const toneColors = {
  neutral: colors.textMuted,
  info: colors.accent,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
} as const;

export function Badge({ label, tone = 'neutral', style, testID }: BadgeProps) {
  useTheme();
  const toneColor = toneColors[tone];

  return (
    <View
      accessibilityLabel={label}
      style={[styles.badge, { borderColor: toneColor }, style]}
      testID={testID}
    >
      <Text style={[typography.caption, { color: toneColor }]}>{label}</Text>
    </View>
  );
}

const styles = {
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
} as const satisfies Record<string, ViewStyle>;
