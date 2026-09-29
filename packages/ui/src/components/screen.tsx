import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, spacing, useTheme } from '../theme';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  testID?: string;
}

export function Screen({
  children,
  scroll = false,
  edges = ['top', 'right', 'bottom', 'left'],
  style,
  contentContainerStyle,
  keyboardShouldPersistTaps = 'handled',
  testID,
}: ScreenProps) {
  useTheme();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, contentContainerStyle]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={[...edges]} style={[styles.safeArea, style]} testID={testID}>
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = {
  content: {
    flexGrow: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  keyboard: {
    flex: 1,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
} as const satisfies Record<string, ViewStyle>;
