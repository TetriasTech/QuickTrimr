import { useColorScheme } from 'react-native';

import brand from './brand.json';
import { palettes } from './colors';
import { radius } from './radius';
import { shadows } from './shadows';
import { sizes } from './sizes';
import { spacing } from './spacing';
import { createTypography } from './typography';

export { brandAssets } from './assets';
export { colors, palettes } from './colors';
export type { ThemeColors } from './colors';
export { radius } from './radius';
export { shadows } from './shadows';
export { sizes } from './sizes';
export { spacing } from './spacing';
export { typography } from './typography';
export { brand };

const base = { brand, radius, shadows, sizes, spacing } as const;
const themes = {
  light: {
    ...base,
    colors: palettes.light,
    typography: createTypography(palettes.light),
  },
  dark: {
    ...base,
    colors: palettes.dark,
    typography: createTypography(palettes.dark),
  },
};
export const theme = themes.light;
export function useTheme() {
  return themes[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
