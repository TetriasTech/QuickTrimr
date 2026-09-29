import { Color } from 'expo-router';
import { Platform } from 'react-native';

export const colors = {
  text: Platform.select({
    ios: Color.ios.label,
    android: Color.android.dynamic.onSurface,
    default: '#111827',
  })!,
  textMuted: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: '#4B5563',
  })!,
  background: Platform.select({
    ios: Color.ios.systemBackground,
    android: Color.android.dynamic.surface,
    default: '#FFFFFF',
  })!,
  surface: Platform.select({
    ios: Color.ios.secondarySystemBackground,
    android: Color.android.dynamic.surfaceContainer,
    default: '#F9FAFB',
  })!,
  surfaceMuted: Platform.select({
    ios: Color.ios.systemGray5,
    android: Color.android.dynamic.surfaceContainerHigh,
    default: '#F3F4F6',
  })!,
  border: Platform.select({
    ios: Color.ios.separator,
    android: Color.android.dynamic.outlineVariant,
    default: '#D1D5DB',
  })!,
  accent: Platform.select({
    ios: Color.ios.systemBlue,
    android: Color.android.dynamic.primary,
    default: '#2563EB',
  })!,
  onAccent: Platform.select({
    ios: '#FFFFFF',
    android: Color.android.dynamic.onPrimary,
    default: '#FFFFFF',
  })!,
  danger: Platform.select({
    ios: Color.ios.systemRed,
    android: Color.android.dynamic.error,
    default: '#DC2626',
  })!,
  onDanger: Platform.select({
    ios: '#FFFFFF',
    android: Color.android.dynamic.onError,
    default: '#FFFFFF',
  })!,
  warning: Platform.select({
    ios: Color.ios.systemOrange,
    android: Color.android.dynamic.tertiary,
    default: '#B45309',
  })!,
  success: Platform.select({
    ios: Color.ios.systemGreen,
    android: Color.android.dynamic.primary,
    default: '#15803D',
  })!,
  transparent: 'transparent',
} as const;
