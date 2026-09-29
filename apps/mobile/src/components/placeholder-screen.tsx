import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type PlaceholderScreenProps = {
  title: string;
  description: string;
  details?: readonly string[];
  children?: ReactNode;
};

export function PlaceholderScreen({
  title,
  description,
  details = [],
  children,
}: PlaceholderScreenProps) {
  return (
    <View accessibilityRole="summary" style={styles.container} testID="placeholder-screen">
      <Text style={styles.eyebrow}>QuickTrimr</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {details.map((detail) => (
        <Text key={detail} style={styles.detail}>
          {detail}
        </Text>
      ))}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  eyebrow: {
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
  },
  detail: {
    fontSize: 14,
    textAlign: 'center',
  },
});
