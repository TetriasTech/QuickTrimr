import {
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { radius, shadows, spacing, useTheme } from '../theme';

export type CardVariant = 'filled' | 'outlined' | 'raised';

export interface CardProps extends Omit<ViewProps, 'style'> {
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
}

export function Card({ variant = 'filled', style, ...viewProps }: CardProps) {
  const { colors } = useTheme();
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
  return (
    <View {...viewProps} style={[styles.card, variants[variant], style]} />
  );
}

const styles = {
  card: {
    borderCurve: 'continuous',
    borderRadius: radius.lg,
    gap: spacing.sm,
    padding: spacing.inset,
  },
} as const satisfies Record<string, ViewStyle>;
