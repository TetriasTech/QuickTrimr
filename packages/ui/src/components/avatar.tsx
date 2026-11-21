import { Image, type ImageSource } from 'expo-image';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, sizes, useTheme } from '../theme';

export type AvatarSize = 'small' | 'medium' | 'large';

export interface AvatarProps {
  accessibilityLabel: string;
  initials: string;
  source?: ImageSource;
  size?: AvatarSize;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const avatarSizes = {
  small: sizes.avatarSmall,
  medium: sizes.avatarMedium,
  large: sizes.avatarLarge,
} as const satisfies Record<AvatarSize, number>;

export function Avatar({
  accessibilityLabel,
  initials,
  source,
  size = 'medium',
  style,
  testID,
}: AvatarProps) {
  const { brand, typography } = useTheme();
  const styles = {
    avatar: {
      overflow: 'hidden',
    },
    fallback: {
      alignItems: 'center',
      backgroundColor: brand.palette.forest,
      justifyContent: 'center',
    },
    image: {
      height: '100%',
      width: '100%',
    },
  } as const satisfies Record<string, ViewStyle>;
  const dimension = avatarSizes[size];
  const sharedStyle: ViewStyle = {
    borderRadius: radius.full,
    height: dimension,
    width: dimension,
  };

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      style={[
        styles.avatar,
        !source ? styles.fallback : undefined,
        sharedStyle,
        style,
      ]}
      testID={testID}
    >
      {source ? (
        <Image contentFit="cover" source={source} style={styles.image} />
      ) : (
        <Text
          style={[
            size === 'large' ? typography.editorial : typography.headline,
            { color: brand.palette.citrus },
          ]}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}
