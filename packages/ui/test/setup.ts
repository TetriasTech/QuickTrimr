jest.mock('@expo/ui', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    BottomSheet: ({
      children,
      isPresented,
      onDismiss,
      testID,
    }: {
      children?: React.ReactNode;
      isPresented: boolean;
      onDismiss: () => void;
      testID?: string;
    }) =>
      isPresented
        ? React.createElement(View, { onDismiss, testID }, children)
        : null,
  };
});

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    Image: (props: Record<string, unknown>) => React.createElement(View, props),
  };
});
