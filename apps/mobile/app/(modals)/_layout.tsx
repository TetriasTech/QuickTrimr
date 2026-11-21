import { Stack } from 'expo-router';

import { useBrandNavigationOptions } from '@/brand/navigation';

export default function ModalLayout() {
  const navigationOptions = useBrandNavigationOptions();
  return (
    <Stack screenOptions={{ ...navigationOptions, presentation: 'modal' }} />
  );
}
