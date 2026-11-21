import brand from '../../packages/ui/src/theme/brand.json';

import type { ConfigContext, ExpoConfig } from 'expo/config';

// Native metadata uses the same editable palette as the rendered app.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? brand.name,
  slug: config.slug ?? 'quicktrimr',
  icon: '../../packages/ui/assets/brand/app-icon.png',
  plugins: [
    ...(config.plugins ?? []),
    [
      'expo-splash-screen',
      {
        image: '../../packages/ui/assets/brand/adaptive-icon.png',
        imageWidth: 160,
        backgroundColor: brand.palette.forest,
      },
    ],
  ],
  android: {
    ...config.android,
    adaptiveIcon: {
      foregroundImage: '../../packages/ui/assets/brand/adaptive-icon.png',
      backgroundColor: brand.palette.forest,
    },
  },
});
