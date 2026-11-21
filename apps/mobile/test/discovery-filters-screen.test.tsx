import { integerCentsSchema } from '@quicktrimr/validation';
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
      <DiscoveryFiltersScreen
        userId={user}
        photoBaseUrl="http://127.0.0.1:55321"
        onManageAddresses={navigate}
        onSelectBarber={navigate}
      />
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
  await screen.findByText('01 / WHEN');
  expect(
    screen.getByRole('button', { name: 'Refresh search' }).props
      .accessibilityState.disabled,
  ).toBe(true);
  expect(mockApi.search).not.toHaveBeenCalled();
  const invalidation = jest.spyOn(cache, 'invalidateQueries');
  await fireEvent.press(screen.getByRole('button', { name: 'Available Now' }));
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
  await screen.findByText('01 / WHEN');
  await fireEvent.press(screen.getByRole('button', { name: 'Scheduled' }));
  expect(screen.getByText('REQUESTED DATE & TIME')).toBeTruthy();
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
  expect(screen.queryByText('REQUESTED DATE & TIME')).toBeNull();
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
  await screen.findByText('01 / WHEN');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Use current location' }),
  );
  expect(await screen.findByText('Existing P1 address picker')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm GPS address' }),
  );
  await mounted.unmount();
  await mount();
  await screen.findByText('01 / WHEN');
  expect(screen.getByRole('button', { name: 'Available Now' })).toBeSelected();
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
  expect(screen.queryByText('01 / WHEN')).toBeNull();
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
  expect(await screen.findByText('01 / WHEN')).toBeTruthy();
});

const barberId = '44444444-4444-4444-8444-444444444444';
function result(id = barberId) {
  return {
    barberId: id,
    displayName: 'Synthetic Barber',
    photoUrl: null,
    approximateArea: {
      id: 'sal:2021:qa',
      label: 'QA Locality',
      mapPoint: { lat: -38, lng: 145 },
    },
    priceCents: integerCentsSchema.parse(4550),
    rating: null,
    ratingCount: 0,
    distanceBand: '2-5km' as const,
    availableUntil: new Date(now + 3600000).toISOString(),
  };
}
test('public cards show cents, SAL, approved distance and honest availability; tap carries only the selected IDs', async () => {
  seed();
  mockApi.search.mockResolvedValue({ results: [result()], nextCursor: null });
  const { navigate } = await mount();
  await screen.findByText('Synthetic Barber');
  expect(screen.getByText('Synthetic haircut')).toBeTruthy();
  expect(screen.getByText('A$45.50')).toBeTruthy();
  expect(screen.getByText('QA Locality')).toBeTruthy();
  expect(screen.getByText('2–5 km away')).toBeTruthy();
  expect(screen.getByText(/No reviews yet/)).toBeTruthy();
  expect(screen.getByText(/Available Now until/)).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: /View Synthetic Barber/ }),
  );
  expect(navigate).toHaveBeenCalledWith(barberId, categoryId);
  expect(useBookingDraftStore.getState().selectedBarberId).toBe(barberId);
});
test('opaque continuation appends in server order once, and refresh restarts without the old chain', async () => {
  seed();
  const second = '55555555-5555-4555-8555-555555555555';
  mockApi.search.mockImplementation(async (request: unknown) =>
    (request as { cursor?: string }).cursor
      ? { results: [result(second)], nextCursor: null }
      : { results: [result()], nextCursor: 'opaque-server-cursor' },
  );
  const { cache } = await mount();
  await screen.findByText('Load more barbers');
  await act(async () => {
    const onEnd = screen.getByTestId('barber-results').props.onEndReached;
    onEnd();
    onEnd();
  });
  await waitFor(() => expect(mockApi.search).toHaveBeenCalledTimes(2));
  expect(mockApi.search.mock.calls[1]![0]).toMatchObject({
    cursor: 'opaque-server-cursor',
  });
  await waitFor(() =>
    expect(screen.queryByText('Load more barbers')).toBeNull(),
  );
  const pages = cache.getQueriesData<{
    pages: SearchAvailableNowBarbersResponse[];
  }>({ queryKey: ['discovery'] })[0]![1]!.pages;
  expect(pages.flatMap((p) => p.results.map((r) => r.barberId))).toEqual([
    barberId,
    second,
  ]);
  await fireEvent(screen.getByTestId('barber-results'), 'refresh');
  await waitFor(() => expect(mockApi.search).toHaveBeenCalledTimes(3));
  expect(mockApi.search.mock.calls[2]![0]).not.toHaveProperty('cursor');
  await waitFor(() =>
    expect(
      cache.getQueriesData<{ pages: unknown[] }>({
        queryKey: ['discovery'],
      })[0]![1]!.pages,
    ).toHaveLength(1),
  );
  await fireEvent.changeText(screen.getByLabelText('Search radius (km)'), '11');
  await fireEvent(screen.getByLabelText('Search radius (km)'), 'blur');
  await waitFor(() => expect(mockApi.search).toHaveBeenCalledTimes(4));
  expect(mockApi.search.mock.calls[3]![0]).toMatchObject({ radiusKm: 11 });
  expect(mockApi.search.mock.calls[3]![0]).not.toHaveProperty('cursor');
});
test('continuation failure keeps loaded cards, suppresses empty and retries with a fresh first page', async () => {
  seed();
  mockApi.search
    .mockResolvedValueOnce({ results: [result()], nextCursor: 'opaque' })
    .mockRejectedValueOnce(new Error('offline'));
  await mount();
  await screen.findByText('Load more barbers');
  await fireEvent.press(screen.getByText('Load more barbers'));
  await screen.findByText(/Could not update nearby search/);
  expect(screen.getByText('Synthetic Barber')).toBeTruthy();
  expect(screen.queryByText(/No barbers matched/)).toBeNull();
  mockApi.search.mockResolvedValue({ results: [], nextCursor: null });
  await fireEvent.press(screen.getByText('Try again'));
  await screen.findByText(/No barbers matched/);
  expect(mockApi.search.mock.calls.at(-1)![0]).not.toHaveProperty('cursor');
});
test('empty actions open editable radius/service controls and Scheduled without inventing a date', async () => {
  seed();
  const mounted = await mount();
  await screen.findByText(/No barbers matched/);
  await fireEvent.press(screen.getByText('Show barbers'));
  expect(screen.queryByText('01 / WHEN')).toBeNull();
  await fireEvent.press(screen.getByText('Widen search radius'));
  expect(screen.getByText('01 / WHEN')).toBeTruthy();
  expect(screen.getByLabelText('Search radius (km)').props.value).toBe('');
  expect(useBookingDraftStore.getState().radiusKm).toBeNull();
  await mounted.unmount();
  seed();
  await mount();
  await screen.findByText(/No barbers matched/);
  await fireEvent.press(screen.getByText('Choose another service'));
  expect(useBookingDraftStore.getState().selectedServiceCategoryId).toBeNull();
  await cleanup();
  seed();
  await mount();
  await screen.findByText(/No barbers matched/);
  await fireEvent.press(screen.getByText('Try Scheduled'));
  expect(useBookingDraftStore.getState().selectedBookingType).toBe('scheduled');
  expect(useBookingDraftStore.getState().scheduledFor).toBeNull();
  expect(
    screen.getAllByText('Choose a requested date and time.').length,
  ).toBeGreaterThan(0);
});
test('initial search loading is distinct from empty results', async () => {
  seed();
  mockApi.search.mockImplementation(() => new Promise(() => {}));
  await mount();
  await screen.findByText('Updating nearby search…');
  expect(screen.queryByText(/No barbers matched/)).toBeNull();
});
