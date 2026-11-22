import {
  BrandLockup,
  brandAssets,
  sizes,
  radius,
  spacing,
  useTheme,
} from '@quicktrimr/ui';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { DiscoveryFiltersScreen } from '@/features/discovery/discovery-filters-screen';
import { useMobileSession } from '@/features/session/session-provider';
import { mobileEnv } from '@/lib/env';
export default function ClientRoute() {
  const { userId } = useMobileSession();
  const { colors } = useTheme();
  const router = useRouter();
  return userId ? (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Find a barber',
          headerTitle: () => <BrandLockup compact />,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Service addresses"
              hitSlop={spacing.xs}
              onPress={() => router.push('/addresses')}
              style={({ pressed }) => ({
                width: sizes.controlSmall,
                height: sizes.controlSmall,
                borderRadius: radius.full,
                backgroundColor: colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Image
                accessible={false}
                source={brandAssets.addressIcon}
                tintColor={colors.accent}
                style={{ width: sizes.iconMedium, height: sizes.iconMedium }}
              />
            </Pressable>
          ),
        }}
      />
      <DiscoveryFiltersScreen
        key={userId}
        photoBaseUrl={mobileEnv.supabaseUrl}
        userId={userId}
        onSelectBarber={(barberId, serviceCategoryId) =>
          router.push({
            pathname: '/barbers/[barberId]',
            params: { barberId, serviceCategoryId },
          })
        }
        onManageAddresses={() => router.push('/addresses')}
        onViewLatestRequest={() =>
          router.push({
            pathname: '/requests/[requestId]',
            params: { requestId: 'latest' },
          })
        }
      />
    </>
  ) : null;
}
