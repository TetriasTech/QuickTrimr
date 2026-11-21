import { Image } from 'expo-image';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { brandAssets, useTheme } from '../theme';

export function BrandLockup({
  compact = false,
  inverse = false,
  tagline = false,
  style,
}: {
  compact?: boolean;
  inverse?: boolean;
  tagline?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { brand, colors, typography, spacing, radius, sizes } = useTheme();
  const p = brand.palette;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={brand.name}
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: spacing.compact },
        style,
      ]}
    >
      <Image
        accessible={false}
        source={inverse ? brandAssets.markInverse : brandAssets.mark}
        style={{
          width: compact ? sizes.markSmall : sizes.markMedium,
          height: compact ? sizes.markSmall : sizes.markMedium,
          borderRadius: radius.sm,
        }}
        contentFit="contain"
      />
      <View style={{ gap: spacing.xs, flexShrink: 1 }}>
        <Text
          allowFontScaling={false}
          style={[
            compact ? typography.headline : typography.title,
            { color: inverse ? p.ivory : colors.text, letterSpacing: -0.8 },
          ]}
        >
          {brand.name}
        </Text>
        {tagline ? (
          <Text
            style={[
              typography.eyebrow,
              { color: inverse ? p.sage : colors.textMuted },
            ]}
          >
            {brand.tagline.toUpperCase()}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
