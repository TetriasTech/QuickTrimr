import {
  BrandLockup,
  Button,
  brand,
  brandAssets,
  radius,
  spacing,
  useTheme,
} from '@quicktrimr/ui';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function WelcomeScreen({
  onSignIn,
  onCreateAccount,
}: {
  onSignIn: () => void;
  onCreateAccount: () => void;
}) {
  const { typography } = useTheme();
  const p = brand.palette;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.forest }}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.lg,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <BrandLockup inverse />
        <View
          style={{
            aspectRatio: 1.18,
            borderRadius: radius.lg,
            overflow: 'hidden',
          }}
        >
          <Image
            source={brandAssets.editorial}
            contentFit="cover"
            contentPosition="center"
            accessibilityLabel="Editorial image of a barber crafting a haircut at home"
            style={{ width: '100%', height: '100%' }}
          />
          <View
            style={{
              position: 'absolute',
              bottom: spacing.md,
              left: spacing.md,
              backgroundColor: p.ivory,
              paddingHorizontal: spacing.compact,
              paddingVertical: spacing.sm,
              borderRadius: radius.full,
            }}
          >
            <Text style={[typography.eyebrow, { color: p.forest }]}>
              THE ART OF A GREAT CUT
            </Text>
          </View>
        </View>
        <View style={{ gap: spacing.compact }}>
          <Text style={[typography.eyebrow, { color: p.citrus }]}>
            GROOMING, ON YOUR TERMS.
          </Text>
          <Text
            accessibilityRole="header"
            style={[typography.hero, { color: p.ivory }]}
          >
            Look sharp.{'\n'}Feel ready.
          </Text>
          <Text style={[typography.body, { color: p.sage }]}>
            Discover barbers who bring their craft to your place.
          </Text>
        </View>
        <View style={{ gap: spacing.compact, marginTop: 'auto' }}>
          <Button
            label="Get started →"
            accessibilityLabel="Create an account"
            variant="highlight"
            size="large"
            onPress={onCreateAccount}
          />
          <Button
            label="Already here? Sign in"
            accessibilityLabel="Sign in"
            variant="inverse"
            onPress={onSignIn}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
