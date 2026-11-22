import { integerCentsSchema } from '@quicktrimr/validation';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react-native';

import { DiscoveryMapScreen } from '../src/features/discovery/discovery-map-screen';

import type { ComponentProps } from 'react';

jest.mock('@expo/ui', () => {
  const n = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Host: n.View,
    Picker: Object.assign((p: Record<string, unknown>) => <n.View {...p} />, {
      Item: () => null,
    }),
  };
});
jest.mock('expo-image', () => ({ Image: () => null }));
const area = {
  id: 'sal:2021:qa',
  label: 'QA area',
  mapPoint: { lat: -38, lng: 145 },
};
const result = (barberId: string) => ({
  barberId,
  displayName: 'Synthetic barber',
  photoUrl: null,
  approximateArea: area,
  priceCents: integerCentsSchema.parse(4550),
  distanceBand: 'under-2km' as const,
  rating: null,
  ratingCount: 0,
  availableUntil: null,
});
function props(): ComponentProps<typeof DiscoveryMapScreen> {
  return {
    point: { lat: -38.2, lng: 145.2 },
    results: [result('a'), result('b')],
    refreshIntervalMs: 2000,
    serviceName: 'Synthetic cut',
    loading: false,
    refreshing: false,
    error: null,
    hasNextPage: true,
    fetchingNextPage: false,
    onRefresh: jest.fn(async () => {}),
    onMore: jest.fn(),
    onSelectArea: jest.fn(),
    onList: jest.fn(),
    onFilters: jest.fn(),
  };
}
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
});
test('renders Google, one SAL cluster at its public point and a separate own-service-address pin without GPS or jitter', async () => {
  const p = props();
  await render(<DiscoveryMapScreen {...p} />);
  const map = screen.getByTestId('discovery-google-map');
  expect(map.props.provider).toBe('google');
  expect(map.props.showsUserLocation).toBe(false);
  expect(map.props.showsMyLocationButton).toBe(false);
  expect(screen.getByTestId('service-address-marker').props.coordinate).toEqual(
    { latitude: -38.2, longitude: 145.2 },
  );
  expect(screen.getAllByTestId('area-sal:2021:qa')).toHaveLength(1);
  const cluster = screen.getByTestId('area-sal:2021:qa');
  expect(cluster.props.coordinate).toEqual({ latitude: -38, longitude: 145 });
  await fireEvent.press(cluster);
  expect(p.onSelectArea).toHaveBeenCalledWith(area.id);
  await fireEvent.press(screen.getByText('Load more barbers'));
  expect(p.onMore).toHaveBeenCalledTimes(1);
  await fireEvent(
    screen.getByTestId('map-area-picker'),
    'valueChange',
    area.id,
  );
  expect(p.onSelectArea).toHaveBeenCalledWith(area.id);
});
test('map request counts ignore continuous/programmatic camera changes; unmount cancels trailing work', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'setImmediate'] });
  const p = props();
  const mounted = await render(<DiscoveryMapScreen {...p} />);
  const map = screen.getByTestId('discovery-google-map');
  await fireEvent(map, 'regionChange', {}, { isGesture: true });
  await fireEvent(map, 'regionChangeComplete', {}, { isGesture: false });
  expect(p.onRefresh).not.toHaveBeenCalled();
  await fireEvent(map, 'regionChangeComplete', {}, { isGesture: true });
  await act(async () => {});
  expect(p.onRefresh).toHaveBeenCalledTimes(1);
  await fireEvent(map, 'regionChange', {}, { isGesture: true });
  await fireEvent(map, 'regionChangeComplete', {}, { isGesture: true });
  await act(async () => {
    jest.advanceTimersByTime(1999);
  });
  expect(p.onRefresh).toHaveBeenCalledTimes(1);
  await mounted.unmount();
  await act(async () => {
    jest.advanceTimersByTime(10000);
  });
  expect(p.onRefresh).toHaveBeenCalledTimes(1);
});
test('background refresh keeps the loaded map and clusters visible without refresh spinners', async () => {
  const p = props();
  const mounted = await render(<DiscoveryMapScreen {...p} />);
  await fireEvent(screen.getByTestId('discovery-google-map'), 'mapReady');
  await fireEvent(screen.getByTestId('discovery-google-map'), 'mapLoaded');
  await mounted.rerender(<DiscoveryMapScreen {...p} refreshing />);
  expect(screen.getByTestId('discovery-google-map')).toBeOnTheScreen();
  expect(screen.getByTestId('area-sal:2021:qa').props.title).toContain(
    '2 loaded matches',
  );
  expect(screen.queryByText('Updating map matches…')).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
  await fireEvent(
    screen.getByTestId('discovery-google-map'),
    'regionChangeComplete',
    {},
    { isGesture: true },
  );
  await act(async () => {});
  expect(p.onRefresh).toHaveBeenCalledTimes(1);
});
test('loading, empty, cached errors and unsafe-area errors are distinct and actionable', async () => {
  const p = props();
  const mounted = await render(
    <DiscoveryMapScreen {...p} results={[]} loading />,
  );
  expect(screen.getByText('Updating map matches…')).toBeOnTheScreen();
  expect(screen.queryByText(/No barbers matched/)).toBeNull();
  await mounted.rerender(
    <DiscoveryMapScreen {...p} results={[]} hasNextPage={false} />,
  );
  expect(screen.getByText(/No barbers matched/)).toBeOnTheScreen();
  await mounted.rerender(
    <DiscoveryMapScreen {...p} error="Could not update map matches" />,
  );
  expect(screen.getByTestId('area-sal:2021:qa')).toBeOnTheScreen();
  expect(screen.queryByText(/No barbers matched/)).toBeNull();
  await fireEvent.press(screen.getByText('Try again'));
  expect(p.onRefresh).toHaveBeenCalledTimes(1);
  const bad = result('c');
  bad.approximateArea = { ...area, mapPoint: { lat: -37, lng: 145 } };
  await mounted.rerender(
    <DiscoveryMapScreen {...p} results={[result('a'), bad]} />,
  );
  expect(
    screen.getByText(/Public map areas could not be read safely/),
  ).toBeOnTheScreen();
  expect(screen.queryByTestId('discovery-google-map')).toBeNull();
  expect(screen.queryByText('Loading map…')).toBeNull();
  expect(screen.queryByText(/No barbers matched/)).toBeNull();
  await mounted.rerender(
    <DiscoveryMapScreen
      {...p}
      results={[]}
      onRefresh={async () => {
        throw new Error('offline');
      }}
    />,
  );
  await fireEvent.press(screen.getByText('Refresh map'));
  expect(
    await screen.findByText('Could not refresh the map. Try again.'),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/No barbers matched/)).toBeNull();
});
