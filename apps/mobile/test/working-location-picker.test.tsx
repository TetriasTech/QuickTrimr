import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react-native';
import { useState } from 'react';

import {
  WorkingLocationPicker,
  type WorkingLocationCentre,
} from '../src/features/locations/working-location-picker';

jest.mock('../src/features/session/session-provider', () => ({
  useMobileSession: () => ({ supabase: {} }),
}));
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: () => mockPermission(),
  getCurrentPositionAsync: () => mockPosition(),
}));
jest.mock('../src/features/onboarding/barber-profile', () => ({
  searchBarberServiceAreas: (...args: unknown[]) => mockSearch(...args),
}));
const mockPermission = jest.fn(),
  mockPosition = jest.fn(),
  mockSearch = jest.fn();
let selected: WorkingLocationCentre | null = null;
const caches: QueryClient[] = [];
function Harness() {
  const [centre, setCentre] = useState<WorkingLocationCentre | null>(null);
  return (
    <WorkingLocationPicker
      mode="available"
      userId="barber-a"
      centre={centre}
      onChange={(c) => {
        selected = c;
        setCentre(c);
      }}
      disabled={false}
      error={undefined}
      savedArea={undefined}
    />
  );
}
async function mount() {
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  caches.push(cache);
  await render(
    <QueryClientProvider client={cache}>
      <Harness />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  selected = null;
  mockSearch.mockResolvedValue([
    {
      directoryId: 'GAACTTEST001',
      line1: '1 Synthetic Street',
      suburb: 'Testville',
      state: 'ACT',
      postcode: '2600',
      unit: '',
    },
  ]);
});
afterEach(async () => {
  await cleanup();
  for (const c of caches) c.clear();
  caches.length = 0;
});
test.each(['denied', 'restricted', 'unavailable'])(
  '%s GPS keeps manual selection usable',
  async (mode) => {
    mockPermission.mockResolvedValue({
      granted: mode === 'unavailable',
      canAskAgain: mode !== 'restricted',
    });
    mockPosition.mockRejectedValue(new Error('unavailable'));
    await mount();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Use current location' }),
    );
    await screen.findByText(
      mode === 'unavailable'
        ? /Could not get your location/
        : /Location access is off/,
    );
    await fireEvent.changeText(
      screen.getByLabelText('Search an Australian address'),
      'Synthetic',
    );
    const address = await screen.findByRole('button', {
      name: /1 Synthetic Street/,
    });
    await fireEvent.press(address);
    expect(selected).toEqual(
      expect.objectContaining({ type: 'address', id: 'GAACTTEST001' }),
    );
    if (mode !== 'unavailable') expect(mockPosition).not.toHaveBeenCalled();
  },
);
test('foreground GPS must be explicitly confirmed; no background tracking', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockPosition.mockResolvedValue({
    coords: { latitude: -37.8, longitude: 144.9 },
  });
  await mount();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Use current location' }),
  );
  expect(
    await screen.findByText(
      'Use this location for your Available Now session?',
    ),
  ).toBeTruthy();
  expect(selected).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm current location' }),
  );
  expect(selected).toEqual({ type: 'gps', lat: -37.8, lng: 144.9 });
  expect(mockPosition).toHaveBeenCalledTimes(1);
});
test('manual lookup shows empty and retry states without clearing typed input', async () => {
  mockSearch.mockResolvedValueOnce([]);
  await mount();
  await fireEvent.changeText(
    screen.getByLabelText('Search an Australian address'),
    'Missing',
  );
  expect(await screen.findByText(/No matching addresses/)).toBeTruthy();
  mockSearch.mockRejectedValue(new Error('network'));
  await fireEvent.changeText(
    screen.getByLabelText('Search an Australian address'),
    'Other',
  );
  await screen.findByRole('button', { name: 'Retry address search' });
  mockSearch.mockResolvedValue([]);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Retry address search' }),
  );
  await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(3));
  await screen.findByText(/No matching addresses/);
  expect(
    screen.getByLabelText('Search an Australian address').props.value,
  ).toBe('Other');
});

test('a never-resolving foreground GPS request times out to usable manual entry', async () => {
  jest.useFakeTimers();
  try {
    mockPermission.mockResolvedValue({ granted: true });
    mockPosition.mockImplementation(() => new Promise(() => undefined));
    await mount();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Use current location' }),
    );
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(await screen.findByText(/Could not get your location/)).toBeTruthy();
    expect(
      screen.getByLabelText('Search an Australian address').props.editable,
    ).toBe(true);
  } finally {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    await cleanup();
    jest.useRealTimers();
  }
});
