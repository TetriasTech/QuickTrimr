import type { TextStyle } from 'react-native';

import { colors } from './colors';

export const typography = {
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '600',
  },
  headline: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  body: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '400',
  },
  subhead: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '400',
  },
  caption: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
} as const satisfies Record<string, TextStyle>;
