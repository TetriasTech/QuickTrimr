import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { colors, radius, shadows, spacing, useTheme } from '../theme';

export type CardVariant = 'filled' | 'outlined' | 'raised';

export interface CardProps extends Omit<ViewProps, 'style'> {
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
}

const variants = {
  filled: {
    backgroundColor: colors.surface,
  },
  outlined: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
  },
  raised: {
    backgroundColor: colors.background,
    boxShadow: shadows.raised,
  },
} as const satisfies Record<CardVariant, ViewStyle>;

export function Card({ variant = 'filled', style, ...viewProps }: CardProps) {
  useTheme();
  return <View {...viewProps} style={[styles.card, variants[variant], style]} />;
}

const styles = {
  card: {
    borderCurve: 'continuous',
    borderRadius: radius.lg,
    gap: spacing.sm,
    padding: spacing.md,
  },
} as const satisfies Record<string, ViewStyle>;
