import { useColorScheme } from 'react-native';

export { colors } from './colors';
export { radius } from './radius';
export { shadows } from './shadows';
export { sizes } from './sizes';
export { spacing } from './spacing';
export { typography } from './typography';

import { colors } from './colors';
import { radius } from './radius';
import { shadows } from './shadows';
import { sizes } from './sizes';
import { spacing } from './spacing';
import { typography } from './typography';

export const theme = {
  colors,
  radius,
  shadows,
  sizes,
  spacing,
  typography,
} as const;

export function useTheme() {
  useColorScheme();
  return theme;
}
