import { AVAIL_STATUS } from '@quicktrimr/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { AvailabilityScreen } from '../src/features/availability/availability-screen';
import { EdgeFunctionError } from '../src/lib/api/invoke-edge-function';

import type { OwnAvailableNowState } from '@quicktrimr/validation';

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
      onValueChange: (b: boolean) => void;
    }) => (
      <native.View
        {...props}
        accessible
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: props.value, disabled: props.disabled }}
      />
    ),
  };
});
jest.mock('@expo/ui/community/datetime-picker', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../src/features/session/session-provider', () => ({
  useMobileSession: () => ({ supabase: {} }),
}));
jest.mock('../src/features/availability/availability-api', () => ({
  availabilityApi: () => mockApi,
}));
jest.mock('../src/features/locations/working-location-picker', () => {
  const native =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    WorkingLocationPicker: ({
      onChange,
    }: {
      onChange: (c: { type: 'address'; id: string; label: string }) => void;
    }) => (
      <native.Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose manual address"
        onPress={() =>
          onChange({
            type: 'address',
            id: 'GAACTTEST001',
            label: 'Synthetic address',
          })
        }
      >
        <native.Text>Choose manual address</native.Text>
      </native.Pressable>
    ),
  };
});
const id = '60499711-52d4-46c7-beb1-6d2c46937ed5';
const state: OwnAvailableNowState = {
  serverNow: '2026-11-20T08:00:00Z',
  config: { minRadiusKm: 1, maxRadiusKm: 50, maxHours: 12 },
  onboardingEligible: true,
  reliability: {
    level: 'good_standing',
    cooldownUntil: null,
    recoveryEligibleAt: null,
    reviewRequired: false,
    requiresHumanReinstatement: false,
    availableNowAllowed: true,
  },
  session: null,
};
const session: NonNullable<OwnAvailableNowState['session']> = {
  id,
  status: 'active',
  isActive: true,
  radiusKm: 8,
  availableUntil: '2026-11-20T09:00:00Z',
  locationSource: 'manual',
  approximateArea: { id: 'sal:example', label: 'Synthetic area' },
};
const mockApi = {
  read: jest.fn<Promise<OwnAvailableNowState>, [AbortSignal]>(),
  start: jest.fn(),
  update: jest.fn(),
  stop: jest.fn(),
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
      <AvailabilityScreen userId={id} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  mockApi.read.mockResolvedValue(structuredClone(state));
});
afterEach(async () => {
  await cleanup();
  for (const c of caches) c.clear();
  caches.length = 0;
});
async function select() {
  await fireEvent.press(
    screen.getByRole('button', { name: 'Choose manual address' }),
  );
}
test('initial loading, real empty state, displayed runtime bounds and server-confirmed start/stop', async () => {
  await mount();
  expect(await screen.findByText(/Choose a location, radius/)).toBeTruthy();
  expect(screen.getByText(/1–50 km/)).toBeTruthy();
  expect(screen.getByRole('switch').props.accessibilityState.checked).toBe(
    false,
  );
  await select();
  mockApi.start.mockImplementation(async () => {
    mockApi.read.mockResolvedValue({ ...state, session });
    return { ...session };
  });
  await fireEvent(screen.getByRole('switch'), 'valueChange', true);
  await waitFor(() =>
    expect(screen.getByRole('switch').props.accessibilityState.checked).toBe(
      true,
    ),
  );
  expect(mockApi.start).toHaveBeenCalledWith(
    expect.objectContaining({
      directoryId: 'GAACTTEST001',
      locationSource: 'manual',
      radiusKm: 1,
    }),
  );
  expect(screen.getByText('60 minutes remaining when refreshed')).toBeTruthy();
  expect(screen.getByText('Location: Manual')).toBeTruthy();
  mockApi.stop.mockImplementation(async () => {
    mockApi.read.mockResolvedValue({
      ...state,
      session: { ...session, status: 'manually_disabled', isActive: false },
    });
    return { id, status: 'manually_disabled' };
  });
  await fireEvent(screen.getByRole('switch'), 'valueChange', false);
  await waitFor(() =>
    expect(screen.getByRole('switch').props.accessibilityState.checked).toBe(
      false,
    ),
  );
  expect(mockApi.stop).toHaveBeenCalledWith(id);
});
test('failed start never enables switch, preserves input and pending start cannot repeat', async () => {
  await mount();
  await screen.findByText(/Choose a location, radius/);
  await select();
  await fireEvent.changeText(screen.getByLabelText('Radius (km)'), '2.5');
  let reject: (e: Error) => void = () => undefined;
  mockApi.start.mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  await fireEvent(screen.getByRole('switch'), 'valueChange', true);
  expect(screen.getByRole('switch').props.accessibilityState.checked).toBe(
    false,
  );
  expect(screen.getByRole('switch').props.accessibilityState.disabled).toBe(
    true,
  );
  await fireEvent(screen.getByRole('switch'), 'valueChange', true);
  expect(mockApi.start).toHaveBeenCalledTimes(1);
  reject(new Error('offline'));
  await screen.findByText(/Could not confirm the change/);
  expect(screen.getByLabelText('Radius (km)').props.value).toBe('2.5');
  expect(screen.getByRole('switch').props.accessibilityState.checked).toBe(
    false,
  );
});
test('every session status renders defined copy; expired, missed and accepted-job reasons differ', async () => {
  const messages = {
    active: 'Available Now is on',
    busy: 'Off — a job was accepted',
    expired: 'Off — your available time ended',
    manually_disabled: 'Off — you switched availability off',
    auto_disabled: 'Off — consecutive requests were missed',
    cancelled: 'Off — this session was replaced or cancelled',
  };
  for (const status of AVAIL_STATUS) {
    mockApi.read.mockResolvedValue({
      ...state,
      session: { ...session, status, isActive: status === 'active' },
    });
    await mount();
    expect(await screen.findByText(messages[status])).toBeTruthy();
    if (status !== 'active')
      expect(screen.queryByText(/remaining when refreshed/)).toBeNull();
    await cleanup();
  }
});
test('onboarding and cooldown/suspension gates block start; restricted outside cooldown stays bookable', async () => {
  for (const mode of [
    'onboarding',
    'cooldown',
    'suspended',
    'restricted',
  ] as const) {
    const current = structuredClone(state);
    if (mode === 'onboarding') current.onboardingEligible = false;
    if (mode === 'cooldown') {
      current.reliability.level = 'limited';
      current.reliability.cooldownUntil = '2026-11-20T09:00:00Z';
      current.reliability.availableNowAllowed = false;
    }
    if (mode === 'suspended') {
      current.reliability.level = 'suspended';
      current.reliability.availableNowAllowed = false;
      current.reliability.requiresHumanReinstatement = true;
      current.reliability.reviewRequired = true;
    }
    if (mode === 'restricted') {
      current.reliability.level = 'restricted';
      current.reliability.reviewRequired = true;
      current.reliability.recoveryEligibleAt = '2026-11-21T09:00:00Z';
    }
    mockApi.read.mockResolvedValue(current);
    await mount();
    await screen.findByText(/Choose a location, radius/);
    await select();
    expect(screen.getByRole('switch').props.accessibilityState.disabled).toBe(
      mode !== 'restricted',
    );
    if (mode === 'suspended')
      expect(screen.getByText('Standing: Suspended')).toBeTruthy();
    if (mode === 'cooldown')
      expect(screen.getByText('Standing: Limited')).toBeTruthy();
    if (mode === 'restricted')
      expect(screen.getByText('Standing: Restricted')).toBeTruthy();
    if (mode === 'suspended')
      expect(screen.getByText(/Human reinstatement/)).toBeTruthy();
    if (mode === 'restricted')
      expect(screen.getByText(/Recovery eligibility:/)).toBeTruthy();
    await cleanup();
  }
});
test('stale barber_unavailable refreshes standing and leaves activation off', async () => {
  await mount();
  await screen.findByText(/Choose a location, radius/);
  await select();
  mockApi.start.mockImplementation(async () => {
    mockApi.read.mockResolvedValue({
      ...state,
      reliability: {
        ...state.reliability,
        level: 'suspended',
        availableNowAllowed: false,
        requiresHumanReinstatement: true,
      },
    });
    throw new EdgeFunctionError(409, { error: 'barber_unavailable' });
  });
  await fireEvent(screen.getByRole('switch'), 'valueChange', true);
  expect(await screen.findByText(/Human reinstatement/)).toBeTruthy();
  expect(screen.getByRole('switch').props.accessibilityState.checked).toBe(
    false,
  );
});
test('initial load failure has retry; update preserves the stored location', async () => {
  mockApi.read.mockRejectedValueOnce(new Error('offline'));
  await mount();
  expect(await screen.findByText(/Check your connection/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText(/Choose a location, radius/);
  await cleanup();
  mockApi.read.mockResolvedValue({ ...state, session });
  await mount();
  await screen.findByText('Available Now is on');
  await fireEvent.changeText(screen.getByLabelText('Radius (km)'), '3.25');
  mockApi.update.mockResolvedValue({});
  await fireEvent.press(screen.getByRole('button', { name: 'Update session' }));
  await waitFor(() =>
    expect(mockApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: id,
        keepLocation: true,
        radiusKm: 3.25,
      }),
    ),
  );
});
