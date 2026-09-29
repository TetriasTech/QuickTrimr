import {
  ActivityIndicator,
  Pressable,
  Text,
  type ColorValue,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, radius, sizes, spacing, typography, useTheme } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'small' | 'medium' | 'large';

export interface ButtonProps
  extends Omit<PressableProps, 'children' | 'disabled' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

type ButtonVariantStyle = {
  container: ViewStyle;
  label: TextStyle;
  indicator: ColorValue;
};

const variants = {
  primary: {
    container: { backgroundColor: colors.accent },
    label: { color: colors.onAccent },
    indicator: colors.onAccent,
  },
  secondary: {
    container: { backgroundColor: colors.surfaceMuted },
    label: { color: colors.text },
    indicator: colors.text,
  },
  ghost: {
    container: { backgroundColor: colors.transparent },
    label: { color: colors.accent },
    indicator: colors.accent,
  },
  destructive: {
    container: { backgroundColor: colors.danger },
    label: { color: colors.onDanger },
    indicator: colors.onDanger,
  },
} as const satisfies Record<ButtonVariant, ButtonVariantStyle>;

const sizeStyles = {
  small: {
    minHeight: sizes.controlSmall,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  medium: {
    minHeight: sizes.controlMedium,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  large: {
    minHeight: sizes.controlLarge,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
} as const satisfies Record<ButtonSize, ViewStyle>;

export function Button({
  label,
  variant = 'primary',
  size = 'medium',
  loading = false,
  disabled = false,
  style,
  ...pressableProps
}: ButtonProps) {
  useTheme();
  const unavailable = disabled || loading;
  const variantStyle = variants[variant];

  return (
    <Pressable
      {...pressableProps}
      accessibilityLabel={pressableProps.accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      style={({ pressed }) => [
        styles.container,
        variantStyle.container,
        sizeStyles[size],
        unavailable ? styles.disabled : pressed ? styles.pressed : undefined,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          accessibilityLabel={`${label} in progress`}
          color={variantStyle.indicator}
          testID="button-loading-indicator"
        />
      ) : (
        <Text style={[typography.headline, variantStyle.label]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = {
  container: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.md,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
} as const satisfies Record<string, ViewStyle>;
