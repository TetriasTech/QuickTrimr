import {
  Text,
  TextInput as NativeTextInput,
  View,
  type StyleProp,
  type TextInputProps as NativeTextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, radius, sizes, spacing, typography, useTheme } from '../theme';

export interface TextInputProps extends NativeTextInputProps {
  label: string;
  error?: string | undefined;
  containerStyle?: StyleProp<ViewStyle>;
}

export function TextInput({
  label,
  error,
  editable = true,
  containerStyle,
  style,
  ...inputProps
}: TextInputProps) {
  useTheme();

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={typography.subhead}>{label}</Text>
      <NativeTextInput
        {...inputProps}
        accessibilityLabel={inputProps.accessibilityLabel ?? label}
        accessibilityState={{ disabled: !editable }}
        aria-invalid={Boolean(error)}
        editable={editable}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          typography.body,
          error ? styles.inputError : undefined,
          !editable ? styles.disabled : undefined,
          style,
        ]}
      />
      {error ? (
        <Text accessibilityRole="alert" selectable style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = {
  container: {
    gap: spacing.xs,
  },
  disabled: {
    opacity: 0.5,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
  },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderCurve: 'continuous',
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: sizes.controlMedium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputError: {
    borderColor: colors.danger,
  },
} as const satisfies Record<string, ViewStyle | TextStyle>;

type TextStyle = import('react-native').TextStyle;
