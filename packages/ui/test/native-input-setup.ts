// Jest has no native accessory host. Keep its children available for interaction tests.
jest.mock(
  'react-native/Libraries/Components/TextInput/InputAccessoryView',
  () => {
    const React = jest.requireActual<typeof import('react')>('react');
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return {
      __esModule: true,
      default: (props: import('react-native').InputAccessoryViewProps) =>
        React.createElement(View, props),
    };
  },
);
