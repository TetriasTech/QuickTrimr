import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { DiscoveryFiltersScreen } from '../src/features/discovery/discovery-filters-screen';
import { EdgeFunctionError } from '../src/lib/api/invoke-edge-function';
import { useBookingDraftStore } from '../src/stores/booking-draft-store';

import type {
  DiscoveryFilters,
  SearchAvailableNowBarbersResponse,
} from '@quicktrimr/validation';

jest.mock('@expo/ui', () => {
  const native =
    jest.requireActual<typeof import('react-native')>('react-native');
  const Picker = Object.assign(
    (props: Record<string, unknown>) => <native.View {...props} />,
    { Item: () => null },
  );
  return { Host: native.View, Picker };
});
jest.mock('@expo/ui/community/datetime-picker', () => {
  const native =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => <native.View {...props} />,
  };
});
jest.mock('../src/features/session/session-provider', () => ({
  useMobileSession: () => ({ supabase: {} }),
}));
jest.mock('../src/features/discovery/discovery-api', () => ({
  discoveryApi: () => mockApi,
}));
jest.mock('../src/features/addresses/client-addresses-screen', () => {
  const native =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ClientAddressesScreen: ({
      onSelect,
      startWithCurrentLocation,
    }: {
      onSelect: (id: string) => void;
      startWithCurrentLocation: boolean;
    }) => (
      <native.Pressable
        accessibilityRole="button"
        accessibilityLabel={
          startWithCurrentLocation
            ? 'Confirm GPS address'
            : 'Select saved address'
        }
        onPress={() => onSelect('22222222-2222-4222-8222-222222222222')}
      >
        <native.Text>Existing P1 address picker</native.Text>
      </native.Pressable>
    ),
  };
});
const user = '11111111-1111-4111-8111-111111111111',
  addressId = '22222222-2222-4222-8222-222222222222',
  categoryId = '33333333-3333-4333-8333-333333333333';
const now = Date.now();
const config: DiscoveryFilters = {
  serverNow: new Date(now).toISOString(),
  scheduling: { minimumLeadMinutes: 240, maximumHorizonDays: 30 },
  radiusKm: { min: 1, max: 50 },
  address: null,
};
const category = {
  id: categoryId,
  slug: 'qa',
  displayName: 'Synthetic haircut',
  description: '',
  displayOrder: 0,
  minPriceCents: 3500,
  maxPriceCents: 7000,
  archivedAt: null,
};
const mockApi = {
  inputs: jest.fn<Promise<DiscoveryFilters>, [string | null, AbortSignal]>(),
  categories: jest.fn(),
  search: jest.fn<
    Promise<SearchAvailableNowBarbersResponse>,
    [unknown, AbortSignal]
  >(),
};
const caches: QueryClient[] = [];
function seed() {
  useBookingDraftStore.getState().patchDraft({
    selectedAddressId: addressId,
    selectedBookingType: 'available_now',
    selectedServiceCategoryId: categoryId,
    radiusKm: 10,
  });
}
async function mount(
  cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  }),
) {
  caches.push(cache);
  const navigate = jest.fn();
  const rendered = await render(
    <QueryClientProvider client={cache}>
      <DiscoveryFiltersScreen userId={user} onManageAddresses={navigate} />
    </QueryClientProvider>,
  );
  return { cache, navigate, ...rendered };
}
beforeAll(() =>
  notifyManager.setScheduler((callback) => queueMicrotask(callback)),
);
afterAll(() =>
  notifyManager.setScheduler((callback) => {
    setTimeout(callback, 0);
  }),
);
beforeEach(() => {
  jest.clearAllMocks();
  useBookingDraftStore.getState().resetDraft();
  mockApi.inputs.mockImplementation(async (id) => ({
    ...config,
    address: id
      ? { id, label: 'Synthetic home', point: { lat: -38.2, lng: 145.2 } }
      : null,
  }));
  mockApi.categories.mockResolvedValue([category]);
  mockApi.search.mockResolvedValue({ results: [], nextCursor: null });
});
afterEach(async () => {
  await cleanup();
  for (const c of caches) c.clear();
  caches.length = 0;
});
test('invalid filters are blocked; mode/category/radius/address changes invalidate and refetch with no mirrored server data', async () => {
  const { cache } = await mount();
  await screen.findByText('Booking mode');
  expect(
    screen.getByRole('button', { name: 'Refresh search' }).props
      .accessibilityState.disabled,
  ).toBe(true);
  expect(mockApi.search).not.toHaveBeenCalled();
  const invalidation = jest.spyOn(cache, 'invalidateQueries');
  await fireEvent(
    screen.getByTestId('booking-mode'),
    'valueChange',
    'available_now',
  );
  await fireEvent(
    screen.getByTestId('service-category'),
    'valueChange',
    categoryId,
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Choose service address' }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Select saved address' }),
  );
  const radius = await screen.findByLabelText('Search radius (km)');
  await fireEvent.changeText(radius, '10.5');
  await fireEvent(radius, 'blur');
  await waitFor(() => expect(mockApi.search).toHaveBeenCalled());
  expect(mockApi.search.mock.calls.at(-1)?.[0]).toMatchObject({
    radiusKm: 10.5,
    lat: -38.2,
    lng: 145.2,
    bookingType: 'available_now',
  });
  expect(invalidation).toHaveBeenCalledWith({
    queryKey: ['discovery'],
    refetchType: 'none',
  });
  expect(
    Object.keys(useBookingDraftStore.getState())
      .filter(
        (k) =>
          typeof useBookingDraftStore.getState()[
            k as keyof ReturnType<typeof useBookingDraftStore.getState>
          ] !== 'function',
      )
      .sort(),
  ).toEqual([
    'radiusKm',
    'scheduledFor',
    'selectedAddressId',
    'selectedBarberId',
    'selectedBookingType',
    'selectedServiceCategoryId',
  ]);
  const before = mockApi.search.mock.calls.length;
  await fireEvent.changeText(radius, '11');
  await fireEvent(radius, 'blur');
  await waitFor(() =>
    expect(mockApi.search.mock.calls.length).toBeGreaterThan(before),
  );
  expect(await screen.findByText(/No barbers matched/)).toBeTruthy();
});
test('Scheduled picker uses live server bounds, requested copy and too-soon guidance; switching modes hides it', async () => {
  seed();
  await mount();
  await screen.findByText('Booking mode');
  await fireEvent(
    screen.getByTestId('booking-mode'),
    'valueChange',
    'scheduled',
  );
  expect(screen.getByText('Requested date and time')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Choose requested date' }),
  );
  const picker = screen.getByTestId('requested-picker');
  expect(picker.props.minimumDate.getTime()).toBeGreaterThanOrEqual(
    now + 240 * 60000,
  );
  expect(picker.props.maximumDate.getTime()).toBeGreaterThanOrEqual(
    now + 30 * 86400000,
  );
  await fireEvent(picker, 'valueChange', {}, new Date(now + 60 * 60000));
  expect(screen.getByText(/at least 4 hours' notice/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Refresh search' }).props
      .accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Try Available Now' }),
  );
  expect(screen.queryByText('Requested date and time')).toBeNull();
  expect(useBookingDraftStore.getState().scheduledFor).toBeNull();
});
test('a fresh server policy can invalidate the draft without dropping it; failures have no hard-coded fallback', async () => {
  seed();
  useBookingDraftStore.getState().patchDraft({
    selectedBookingType: 'scheduled',
    scheduledFor: new Date(now + 5 * 3600000).toISOString(),
  });
  let reads = 0;
  mockApi.inputs.mockImplementation(async (id) => ({
    ...config,
    scheduling: {
      minimumLeadMinutes: ++reads === 1 ? 240 : 360,
      maximumHorizonDays: 30,
    },
    address: {
      id: id!,
      label: 'Synthetic home',
      point: { lat: -38.2, lng: 145.2 },
    },
  }));
  await mount();
  expect(
    (await screen.findAllByText(/at least 6 hours' notice/)).length,
  ).toBeGreaterThan(0);
  expect(mockApi.search).not.toHaveBeenCalled();
  expect(useBookingDraftStore.getState().scheduledFor).toBe(
    new Date(now + 5 * 3600000).toISOString(),
  );
});
test('draft persists across leaving/remounting, and the current-location action reuses the existing picker', async () => {
  seed();
  const mounted = await mount();
  await screen.findByText('Booking mode');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Use current location' }),
  );
  expect(await screen.findByText('Existing P1 address picker')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm GPS address' }),
  );
  await mounted.unmount();
  await mount();
  await screen.findByText('Booking mode');
  expect(screen.getByTestId('booking-mode').props.selectedValue).toBe(
    'available_now',
  );
  expect(screen.getByLabelText('Search radius (km)').props.value).toBe('10');
  expect(useBookingDraftStore.getState().selectedAddressId).toBe(addressId);
});
test('config loading/error/recovery, catalogue empty and search failure retain draft and stay distinct from no matches', async () => {
  seed();
  mockApi.inputs.mockRejectedValue(new Error('offline'));
  await mount();
  expect(
    await screen.findByText(/Could not load search settings/),
  ).toBeTruthy();
  expect(mockApi.search).not.toHaveBeenCalled();
  expect(screen.queryByText('Booking mode')).toBeNull();
  mockApi.inputs.mockResolvedValue({
    ...config,
    address: {
      id: addressId,
      label: 'Synthetic home',
      point: { lat: -38.2, lng: 145.2 },
    },
  });
  mockApi.search.mockRejectedValue(new Error('offline'));
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(
    await screen.findByText(/Could not update nearby search/),
  ).toBeTruthy();
  expect(screen.queryByText(/No barbers matched/)).toBeNull();
  mockApi.search.mockResolvedValue({ results: [], nextCursor: null });
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText(/No barbers matched/)).toBeTruthy();
  await act(async () => {
    for (const c of caches)
      c.setQueryData(['discovery-categories', user], {
        pages: [[]],
        pageParams: [0],
      });
  });
  expect(await screen.findByText(/No services are listed/)).toBeTruthy();
  expect(useBookingDraftStore.getState().radiusKm).toBe(10);
});

test('an archived selected address can be replaced after its initial lookup fails', async () => {
  seed();
  useBookingDraftStore
    .getState()
    .patchDraft({ selectedAddressId: '44444444-4444-4444-8444-444444444444' });
  mockApi.inputs.mockRejectedValueOnce(
    new EdgeFunctionError(422, {
      error: 'validation_failed',
      fields: { addressId: 'Choose an active saved address.' },
    }),
  );
  await mount();
  await screen.findByText('Choose an active saved address.');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Choose service address' }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Select saved address' }),
  );
  expect(await screen.findByText('Booking mode')).toBeTruthy();
});
