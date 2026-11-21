import brand from './brand.json';
import { colors, type ThemeColors } from './colors';

import type { TextStyle } from 'react-native';

export function createTypography(palette: ThemeColors) {
  const f = brand.fonts;
  return {
    hero: {
      color: palette.text,
      fontFamily: f.display,
      fontSize: 56,
      lineHeight: 56,
      letterSpacing: -1.1,
    },
    display: {
      color: palette.text,
      fontFamily: f.display,
      fontSize: 42,
      lineHeight: 46,
      letterSpacing: -0.5,
    },
    editorial: {
      color: palette.text,
      fontFamily: f.displayItalic,
      fontSize: 32,
      lineHeight: 36,
    },
    title: {
      color: palette.text,
      fontFamily: f.bold,
      fontSize: 26,
      lineHeight: 32,
      letterSpacing: -0.7,
    },
    headline: {
      color: palette.text,
      fontFamily: f.bold,
      fontSize: 17,
      lineHeight: 24,
      letterSpacing: -0.25,
    },
    body: {
      color: palette.text,
      fontFamily: f.regular,
      fontSize: 15,
      lineHeight: 23,
    },
    subhead: {
      color: palette.textMuted,
      fontFamily: f.medium,
      fontSize: 14,
      lineHeight: 21,
    },
    caption: {
      color: palette.textMuted,
      fontFamily: f.medium,
      fontSize: 12,
      lineHeight: 18,
    },
    eyebrow: {
      color: palette.textMuted,
      fontFamily: f.bold,
      fontSize: 10,
      lineHeight: 16,
      letterSpacing: 1.8,
    },
    price: {
      color: palette.text,
      fontFamily: f.bold,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.8,
      fontVariant: ['tabular-nums'],
    },
  } as const satisfies Record<string, TextStyle>;
}
export const typography = createTypography(colors);
