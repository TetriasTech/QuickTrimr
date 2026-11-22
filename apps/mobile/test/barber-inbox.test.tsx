import { integerCentsSchema } from '@quicktrimr/validation';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { BarberInboxScreen } from '../src/features/barber-inbox/barber-inbox-screen';

import type { BarberInboxApi } from '../src/features/barber-inbox/barber-inbox-api';
import type {
  BarberRequestInboxWithJobSlot,
  OwnAvailableNowState,
} from '@quicktrimr/validation';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const serverNow = '2026-11-23T00:00:00Z';
const request = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  bookingType: 'available_now',
  status: 'pending',
  serviceName: 'Skin Fade',
  priceCents: integerCentsSchema.parse(4503),
  clientDisplayName: 'Sam R.',
  clientRating: null,
  distanceBand: '2-5km',
  suburb: 'Carlton',
  scheduledFor: null,
  expiresAt: '2026-11-23T00:05:00Z',
} satisfies BarberRequestInboxWithJobSlot['requests'][number];
const scheduled = {
  ...request,
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  bookingType: 'scheduled',
  serviceName: 'Beard Trim',
  distanceBand: null,
  scheduledFor: '2026-11-24T00:00:00Z',
  expiresAt: '2026-11-23T01:25:00Z',
} satisfies BarberRequestInboxWithJobSlot['requests'][number];
const availability = {
  serverNow,
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
} satisfies OwnAvailableNowState;

function page(overrides: Partial<BarberRequestInboxWithJobSlot> = {}) {
  return {
    serverNow,
    requests: [request, scheduled],
    nextCursor: null,
    hasActiveAvailableNowJob: false,
    ...overrides,
  } satisfies BarberRequestInboxWithJobSlot;
}

function mockApi(first = page()) {
  return {
    read: jest
      .fn<
        ReturnType<BarberInboxApi['read']>,
        Parameters<BarberInboxApi['read']>
      >()
      .mockResolvedValue(first),
    readAvailability: jest
      .fn<
        ReturnType<BarberInboxApi['readAvailability']>,
        Parameters<BarberInboxApi['readAvailability']>
      >()
      .mockResolvedValue(availability),
  };
}

async function mount(api: BarberInboxApi) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const onAvailability = jest.fn();
  const view = (focused: boolean) => (
    <QueryClientProvider client={cache}>
      <BarberInboxScreen
        api={api}
        focused={focused}
        userId={userId}
        onAvailability={onAvailability}
      />
    </QueryClientProvider>
  );
  const rendered = await render(view(true));
  return { rendered, view, onAvailability };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'setImmediate'] });
});

afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
  focusManager.setFocused(undefined);
});

test('shows both request types and safe card details with an occupied-slot reason for Available Now only', async () => {
  const privateFields = {
    address: '99 Synthetic Private Road',
    phone: '+61400000000',
    email: 'contact@example.invalid',
  };
  const overshared = { ...request, ...privateFields };
  const api = mockApi(
    page({
      hasActiveAvailableNowJob: true,
      requests: [overshared, scheduled],
    }),
  );
  await mount(api);
  expect(await screen.findByText('Available Now')).toBeOnTheScreen();
  expect(screen.getByText('Scheduled')).toBeOnTheScreen();
  expect(screen.getByText('Skin Fade')).toBeOnTheScreen();
  expect(screen.getByText('Beard Trim')).toBeOnTheScreen();
  expect(screen.getAllByText(/45\.03/)).toHaveLength(2);
  expect(screen.getAllByText('Sam R.')).toHaveLength(2);
  expect(screen.getByText('Carlton · 2–5 km away')).toBeOnTheScreen();
  expect(screen.getByText('Carlton')).toBeOnTheScreen();
  expect(screen.getByText('Requested time')).toBeOnTheScreen();
  expect(screen.getByText(/November 2026/)).toBeOnTheScreen();
  expect(screen.getAllByLabelText(/Time to respond /)).toHaveLength(2);
  expect(screen.getByText(/This request can’t be accepted/)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /accept|decline/i })).toBeNull();
  expect(api.readAvailability).not.toHaveBeenCalled();
  for (const privateValue of Object.values(privateFields)) {
    expect(
      screen.queryByText(privateValue, { includeHiddenElements: true }),
    ).toBeNull();
    expect(
      screen.queryByLabelText(privateValue, { includeHiddenElements: true }),
    ).toBeNull();
  }
});

test('marks expiry in place at the displayed deadline and conceals the request details', async () => {
  const api = mockApi(
    page({ requests: [{ ...request, expiresAt: '2026-11-23T00:00:02Z' }] }),
  );
  await mount(api);
  expect(await screen.findByText('Skin Fade')).toBeOnTheScreen();
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.queryByText('Request expired')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(1100);
  });
  expect(screen.getByText('Request expired')).toBeOnTheScreen();
  expect(screen.queryByText('Sam R.')).toBeNull();
  expect(screen.queryByText(/Carlton/)).toBeNull();
  expect(screen.queryByRole('button', { name: /accept|decline/i })).toBeNull();
  expect(api.read).toHaveBeenCalledTimes(1);
});

test('loads the continuation and starts at page one on route focus and app foreground', async () => {
  const cursor = { expiresAt: request.expiresAt, requestId: request.id };
  const first = page({
    requests: [request],
    nextCursor: cursor,
    hasActiveAvailableNowJob: true,
  });
  const api = mockApi(first);
  api.read
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(
      page({ requests: [scheduled], hasActiveAvailableNowJob: true }),
    )
    .mockResolvedValue(
      page({ requests: [{ ...request, serviceName: 'New Cut' }] }),
    );
  const { rendered, view } = await mount(api);
  expect(
    await screen.findByText(/This request can’t be accepted/),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Load more requests' }),
  );
  expect(await screen.findByText('Beard Trim')).toBeOnTheScreen();
  expect(api.read.mock.calls.map(([after]) => after)).toEqual([null, cursor]);
  await rendered.rerender(view(false));
  await rendered.rerender(view(true));
  expect(await screen.findByText('New Cut')).toBeOnTheScreen();
  expect(screen.queryByText('Beard Trim')).toBeNull();
  expect(screen.queryByText(/This request can’t be accepted/)).toBeNull();
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() =>
    expect(api.read.mock.calls.map(([after]) => after)).toEqual([
      null,
      cursor,
      null,
      null,
    ]),
  );
});

test.each([true, false])(
  'distinguishes the loaded empty state when session is active=%s',
  async (isActive) => {
    const api = mockApi(page({ requests: [] }));
    if (isActive)
      api.readAvailability.mockResolvedValue({
        ...availability,
        session: {
          id: userId,
          status: 'active',
          isActive,
          radiusKm: 8,
          availableUntil: request.expiresAt,
          locationSource: 'manual',
          approximateArea: { id: 'sal:test', label: 'Carlton' },
        },
      });
    const { onAvailability } = await mount(api);
    if (isActive) {
      expect(
        await screen.findByText(/New requests will appear here/),
      ).toBeOnTheScreen();
      expect(
        screen.queryByRole('button', { name: 'Manage availability' }),
      ).toBeNull();
    } else {
      expect(
        await screen.findByText(/You’re not Available Now/),
      ).toBeOnTheScreen();
      await fireEvent.press(
        screen.getByRole('button', { name: 'Manage availability' }),
      );
      expect(onAvailability).toHaveBeenCalledTimes(1);
    }
  },
);

test('shows initial loading, reports the request error and retries', async () => {
  const api = mockApi();
  let reject!: (reason: Error) => void;
  api.read.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await mount(api);
  expect(screen.getByText('Checking booking requests…')).toBeOnTheScreen();
  await act(async () => reject(new Error('Synthetic connection error')));
  expect(
    await screen.findByText('Could not refresh booking requests.'),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Skin Fade')).toBeOnTheScreen();
});
