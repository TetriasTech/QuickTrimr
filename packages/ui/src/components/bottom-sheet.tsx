import {
  BottomSheet as ExpoBottomSheet,
  type BottomSheetProps as ExpoBottomSheetProps,
} from '@expo/ui';

import { colors, spacing, useTheme } from '../theme';

import type { ReactNode } from 'react';

export interface BottomSheetProps {
  children: ReactNode;
  isPresented: boolean;
  onDismiss: () => void;
  showDragIndicator?: boolean;
  snapPoints?: ExpoBottomSheetProps['snapPoints'];
  testID?: string;
}

export function BottomSheet({
  children,
  isPresented,
  onDismiss,
  showDragIndicator = true,
  snapPoints,
  testID,
}: BottomSheetProps) {
  useTheme();
  return (
    <ExpoBottomSheet
      containerColor={colors.background}
      contentPadding={spacing.lg}
      isPresented={isPresented}
      onDismiss={onDismiss}
      showDragIndicator={showDragIndicator}
      {...(snapPoints === undefined ? {} : { snapPoints })}
      {...(testID === undefined ? {} : { testID })}
    >
      {children}
    </ExpoBottomSheet>
  );
}
