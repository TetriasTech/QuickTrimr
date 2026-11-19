import {
  barberServiceCatalogueEntrySchema,
  type UpsertBarberServiceRequest,
  type UpsertBarberServiceResponse,
  type BarberServiceCatalogueEntry,
} from '@quicktrimr/validation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react-native';

import { BarberServicesScreen } from '../src/features/services/barber-services-screen';
import { EdgeFunctionError } from '../src/lib/api/invoke-edge-function';

jest.mock('@expo/ui', () => {
  const native =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Host: native.View,
    Switch: ({
      label,
      ...props
    }: {
      label: string;
      value: boolean;
      disabled: boolean;
      onValueChange: (value: boolean) => void;
    }) => (
      <native.View
        {...props}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: props.value, disabled: props.disabled }}
      />
    ),
  };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../src/features/session/session-provider', () => ({
  useMobileSession: () => ({ supabase: {} }),
}));
jest.mock('../src/features/services/barber-services-api', () => ({
  barberServicesApi: () => mockApi,
  SERVICE_CATALOGUE_PAGE_SIZE: 20,
}));

const category = barberServiceCatalogueEntrySchema.parse({
  id: '8f293ef1-2954-463d-89bd-48ab1f2b7d15',
  slug: 'haircut',
  displayName: 'Haircut',
  description: '',
  displayOrder: 1,
  minPriceCents: 2000,
  maxPriceCents: 15000,
  archivedAt: null,
  services: [],
});
const serviceId = '60499711-52d4-46c7-beb1-6d2c46937ed5';
const mockApi = {
  page: jest.fn<
    Promise<BarberServiceCatalogueEntry[]>,
    [number, AbortSignal]
  >(),
  upsert: jest.fn<
    Promise<UpsertBarberServiceResponse>,
    [UpsertBarberServiceRequest]
  >(),
  archive: jest.fn<Promise<{ id: string; archivedAt: string }>, [string]>(),
};
const caches: QueryClient[] = [];
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
      <BarberServicesScreen userId="fixture-barber" />
    </QueryClientProvider>,
  );
  return cache;
}
beforeEach(() => {
  jest.resetAllMocks();
  mockApi.page.mockResolvedValue([category]);
  mockApi.upsert.mockImplementation(async (input) => ({
    id: serviceId,
    ...input,
    archivedAt: null,
  }));
  mockApi.archive.mockResolvedValue({
    id: serviceId,
    archivedAt: '2026-11-19T00:00:00Z',
  });
});
afterEach(async () => {
  await cleanup();
  caches.splice(0).forEach((cache) => cache.clear());
});

test('initial loading, a real empty catalogue and the no-priced-services guidance are distinct', async () => {
  mockApi.page.mockImplementationOnce(() => new Promise(() => {}));
  const first = await mount();
  expect(screen.getByText('Loading services and prices…')).toBeOnTheScreen();
  expect(screen.queryByText(/No service categories/)).not.toBeOnTheScreen();
  first.clear();
  mockApi.page.mockResolvedValue([]);
  await mount();
  await waitFor(() =>
    expect(
      screen.getByText(/No service categories are available/),
    ).toBeOnTheScreen(),
  );
  expect(screen.getByText(/Services must be priced before/)).toBeOnTheScreen();
});

test('a failed initial load can be retried; content explains pricing and preserves existing bookings', async () => {
  mockApi.page.mockRejectedValueOnce(new Error('Synthetic outage'));
  await mount();
  await waitFor(() =>
    expect(
      screen.getByText('Could not load services and prices.'),
    ).toBeOnTheScreen(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(
      screen.getByText(
        'No services enabled yet. Choose a service below and save your price.',
      ),
    ).toBeOnTheScreen(),
  );
  expect(
    screen.getByText('Price changes do not affect existing bookings.'),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('Offer Haircut')).toHaveProp('value', false);
});

test('exact cent conversion, save failure/retry without losing the draft, repricing, disable and re-enable', async () => {
  mockApi.upsert
    .mockRejectedValueOnce(new Error('Synthetic save failure'))
    .mockImplementation(async (input) => ({
      id: serviceId,
      ...input,
      archivedAt: null,
    }));
  await mount();
  await waitFor(() =>
    expect(screen.getByLabelText('Offer Haircut')).toBeOnTheScreen(),
  );
  await fireEvent(screen.getByLabelText('Offer Haircut'), 'valueChange', true);
  await fireEvent.changeText(
    screen.getByLabelText('Haircut price (A$)'),
    '45.50',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Save Haircut price' }),
  );
  await waitFor(() =>
    expect(screen.getByText(/Could not save this service/)).toBeOnTheScreen(),
  );
  expect(screen.getByLabelText('Haircut price (A$)')).toHaveProp(
    'value',
    '45.50',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Save Haircut price' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Service saved.')).toBeOnTheScreen(),
  );
  expect(mockApi.upsert).toHaveBeenLastCalledWith({
    serviceCategoryId: category.id,
    priceCents: 4550,
    enabled: true,
  });
  await fireEvent.changeText(
    screen.getByLabelText('Haircut price (A$)'),
    '46.25',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Save Haircut price' }),
  );
  await waitFor(() =>
    expect(mockApi.upsert).toHaveBeenLastCalledWith({
      serviceCategoryId: category.id,
      priceCents: 4625,
      enabled: true,
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save Haircut price' }),
    ).toBeDisabled(),
  );
  await fireEvent(screen.getByLabelText('Offer Haircut'), 'valueChange', false);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Disable Haircut' }),
  );
  await waitFor(() => expect(mockApi.archive).toHaveBeenCalledWith(serviceId));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Disable Haircut' }),
    ).toBeDisabled(),
  );
  await fireEvent(screen.getByLabelText('Offer Haircut'), 'valueChange', true);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Save Haircut price' }),
  );
  await waitFor(() => expect(mockApi.upsert).toHaveBeenCalledTimes(4));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save Haircut price' }),
    ).toBeDisabled(),
  );
});

test('form rejects fractional cents and either out-of-bounds amount before invoking the API', async () => {
  await mount();
  await waitFor(() =>
    expect(screen.getByLabelText('Offer Haircut')).toBeOnTheScreen(),
  );
  await fireEvent(screen.getByLabelText('Offer Haircut'), 'valueChange', true);
  for (const price of ['19.99', '150.01', '45.501', '1e2']) {
    await fireEvent.changeText(
      screen.getByLabelText('Haircut price (A$)'),
      price,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Save Haircut price' }),
    );
    expect(mockApi.upsert).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Haircut price (A$)')).toHaveProp(
      'aria-invalid',
      true,
    );
  }
});

test('server field validation is shown and a failed refresh keeps edits and cached content', async () => {
  mockApi.upsert.mockRejectedValue(
    new EdgeFunctionError(422, {
      error: 'validation_failed',
      fields: { priceCents: 'The current maximum is A$40.00.' },
    }),
  );
  await mount();
  await waitFor(() =>
    expect(screen.getByLabelText('Offer Haircut')).toBeOnTheScreen(),
  );
  await fireEvent(screen.getByLabelText('Offer Haircut'), 'valueChange', true);
  await fireEvent.changeText(
    screen.getByLabelText('Haircut price (A$)'),
    '45.50',
  );
  mockApi.page.mockRejectedValue(new Error('Synthetic refresh failure'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Save Haircut price' }),
  );
  await waitFor(() =>
    expect(
      screen.getByText('The current maximum is A$40.00.'),
    ).toBeOnTheScreen(),
  );
  await waitFor(() =>
    expect(
      screen.getByText(
        'Could not refresh services. Your edits are still here.',
      ),
    ).toBeOnTheScreen(),
  );
  expect(screen.getByLabelText('Haircut price (A$)')).toHaveProp(
    'value',
    '45.50',
  );
});
