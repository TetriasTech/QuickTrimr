import { useId, useState } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Text,
  TextInput as NativeTextInput,
  View,
  type StyleProp,
  type TextInputProps as NativeTextInputProps,
  type ViewStyle,
} from 'react-native';

import { radius, sizes, spacing, useTheme } from '../theme';

import { Button } from './button';

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
  const { colors, typography } = useTheme();
  const accessoryId = useId();
  const [focused, setFocused] = useState(false);
  const numeric = [
    'decimal-pad',
    'number-pad',
    'numeric',
    'phone-pad',
  ].includes(inputProps.keyboardType ?? '');
  const showDone =
    Platform.OS === 'ios' && numeric && !inputProps.inputAccessoryViewID;
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
      backgroundColor: colors.surface,
      borderColor: colors.inputBorder,
      borderCurve: 'continuous',
      borderRadius: radius.md,
      borderWidth: 1,
      minHeight: sizes.controlLarge,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    inputError: {
      borderColor: colors.danger,
    },
  } as const satisfies Record<string, ViewStyle | TextStyle>;

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={typography.eyebrow}>{label}</Text>
      <NativeTextInput
        {...inputProps}
        inputAccessoryViewID={
          showDone ? accessoryId : inputProps.inputAccessoryViewID
        }
        secureTextEntry={inputProps.secureTextEntry ?? false}
        onFocus={(event) => {
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        accessibilityLabel={inputProps.accessibilityLabel ?? label}
        accessibilityState={{ disabled: !editable }}
        aria-invalid={Boolean(error)}
        editable={editable}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          typography.body,
          focused ? { borderColor: colors.accent } : undefined,
          error ? styles.inputError : undefined,
          !editable ? styles.disabled : undefined,
          style,
        ]}
      />
      {showDone ? (
        <InputAccessoryView nativeID={accessoryId}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              backgroundColor: colors.surface,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingHorizontal: spacing.md,
            }}
          >
            <Button
              label="Done"
              size="small"
              variant="ghost"
              onPress={Keyboard.dismiss}
            />
          </View>
        </InputAccessoryView>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" selectable style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type TextStyle = import('react-native').TextStyle;
