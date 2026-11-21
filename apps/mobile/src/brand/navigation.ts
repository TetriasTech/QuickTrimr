import { useTheme } from '@quicktrimr/ui';
export function useBrandNavigationOptions() {
  const { colors, brand } = useTheme();
  return {
    headerShown: false,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.text,
    headerTitleStyle: { fontFamily: brand.fonts.bold },
    contentStyle: { backgroundColor: colors.background },
  } as const;
}
