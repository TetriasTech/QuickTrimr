// The native SDK is exercised separately on both emulators; Jest observes its props/events.
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const native =
    jest.requireActual<typeof import('react-native')>('react-native');
  const fitToCoordinates = jest.fn();
  const Map = React.forwardRef<
    Record<string, unknown>,
    Record<string, unknown>
  >((props, ref) => {
    React.useImperativeHandle(ref, () => ({ fitToCoordinates }));
    return <native.View {...props} />;
  });
  Map.displayName = 'NativeMapTestHost';
  return {
    __esModule: true,
    default: Map,
    Marker: native.View,
    PROVIDER_GOOGLE: 'google',
    fitToCoordinates,
  };
});
