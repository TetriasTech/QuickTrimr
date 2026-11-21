import { load } from '@expo/env';

import brand from '../../packages/ui/src/theme/brand.json';

import { mobileEnv } from './src/lib/env.ts';

import type { ConfigContext, ExpoConfig } from 'expo/config';

// Native metadata uses the same editable palette as the rendered app.
export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  // Export resolves dynamic config before the CLI's normal env load.
  load(projectRoot);
  return {
    ...config,
    name: config.name ?? brand.name,
    slug: config.slug ?? 'quicktrimr',
    icon: '../../packages/ui/assets/brand/app-icon.png',
    plugins: [
      ...(config.plugins ?? []),
      'expo-secure-store',
      [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: mobileEnv.googleMapsAndroidApiKey,
          iosGoogleMapsApiKey: mobileEnv.googleMapsIosApiKey,
        },
      ],
      [
        'expo-splash-screen',
        {
          image: '../../packages/ui/assets/brand/adaptive-icon.png',
          imageWidth: 160,
          backgroundColor: brand.palette.forest,
        },
      ],
    ],
    ios: {
      ...config.ios,
      entitlements: {
        ...config.ios?.entitlements,
        'keychain-access-groups': [
          '$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)',
        ],
      },
    },
    android: {
      ...config.android,
      adaptiveIcon: {
        foregroundImage: '../../packages/ui/assets/brand/adaptive-icon.png',
        backgroundColor: brand.palette.forest,
      },
    },
  };
};
