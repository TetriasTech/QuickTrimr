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
import { Alert } from 'react-native';

import { BarberBookingStatusScreen } from '../src/features/barber-inbox/barber-booking-status-screen';
import { BarberInboxScreen } from '../src/features/barber-inbox/barber-inbox-screen';
import { EdgeFunctionError } from '../src/lib/api/invoke-edge-function';

import type { BarberInboxApi } from '../src/features/barber-inbox/barber-inbox-api';
import type {
  BarberRequestInboxWithJobSlot,
  OwnAvailableNowState,
} from '@quicktrimr/validation';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bookingId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
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
    accept: jest
      .fn<ReturnType<BarberInboxApi['accept']>, [string]>()
      .mockImplementation(async (requestId) => ({
        requestId,
        bookingId,
        requestStatus: 'accepted',
        bookingStatus: 'accepted_pending_payment',
      })),
    decline: jest
      .fn<ReturnType<BarberInboxApi['decline']>, [string]>()
      .mockImplementation(async (requestId) => ({
        requestId,
        status: 'declined',
      })),
    readBookingStatus: jest
      .fn<
        ReturnType<BarberInboxApi['readBookingStatus']>,
        Parameters<BarberInboxApi['readBookingStatus']>
      >()
      .mockResolvedValue({ id: bookingId, status: 'accepted_pending_payment' }),
  };
}

async function mount(api: BarberInboxApi) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const onAvailability = jest.fn();
  const onBooking = jest.fn();
  const view = (focused: boolean) => (
    <QueryClientProvider client={cache}>
      <BarberInboxScreen
        api={api}
        focused={focused}
        userId={userId}
        onAvailability={onAvailability}
        onBooking={onBooking}
      />
    </QueryClientProvider>
  );
  const rendered = await render(view(true));
  return { rendered, view, onAvailability, onBooking };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'setImmediate'] });
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
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
  expect(
    screen.getByRole('button', { name: 'Accept Skin Fade' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Decline Skin Fade' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Accept Beard Trim' }),
  ).toBeEnabled();
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

function alertSpy() {
  return jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
}

async function confirm(alert: ReturnType<typeof alertSpy>) {
  await act(async () => {
    alert.mock.calls
      .at(-1)?.[2]
      ?.find(({ text }) => text === 'Accept request')
      ?.onPress?.();
  });
}

test('accept requires confirmation, sends once, refreshes the inbox and opens the returned booking', async () => {
  const alert = alertSpy();
  const api = mockApi();
  let settle!: (value: Awaited<ReturnType<BarberInboxApi['accept']>>) => void;
  api.accept.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const { onBooking } = await mount(api);
  const accept = await screen.findByRole('button', {
    name: 'Accept Skin Fade',
  });
  await fireEvent.press(accept);
  expect(alert.mock.lastCall?.[0]).toEqual('Accept this request?');
  expect(api.accept).not.toHaveBeenCalled();
  await act(async () => alert.mock.lastCall?.[2]?.[0]?.onPress?.());
  expect(api.accept).not.toHaveBeenCalled();
  await fireEvent.press(accept);
  const submit = alert.mock.lastCall?.[2]?.[1]?.onPress;
  expect(submit).toBeDefined();
  await act(async () => {
    submit?.();
    submit?.();
  });
  expect(api.accept).toHaveBeenCalledTimes(1);
  expect(api.accept).toHaveBeenCalledWith(request.id);
  expect(
    screen.getByRole('button', { name: 'Accept Skin Fade' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Decline Skin Fade' }),
  ).toBeDisabled();
  api.read.mockResolvedValue(
    page({ requests: [scheduled], hasActiveAvailableNowJob: true }),
  );
  await act(async () =>
    settle({
      requestId: request.id,
      bookingId,
      requestStatus: 'accepted',
      bookingStatus: 'accepted_pending_payment',
    }),
  );
  expect(
    await screen.findByText('Request accepted. Payment pending.'),
  ).toBeOnTheScreen();
  expect(screen.queryByText('Skin Fade')).toBeNull();
  expect(api.read).toHaveBeenCalledTimes(2);
  await fireEvent.press(
    screen.getByRole('button', { name: 'View booking status' }),
  );
  expect(onBooking).toHaveBeenCalledWith(bookingId);
});

test('declines once even through a network wait and refreshes the first page', async () => {
  const alert = alertSpy();
  const api = mockApi();
  let settle!: (value: Awaited<ReturnType<BarberInboxApi['decline']>>) => void;
  api.decline.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  await mount(api);
  const decline = await screen.findByRole('button', {
    name: 'Decline Beard Trim',
  });
  await fireEvent.press(decline);
  await fireEvent.press(decline);
  expect(alert).not.toHaveBeenCalled();
  expect(api.decline).toHaveBeenCalledTimes(1);
  expect(api.decline).toHaveBeenCalledWith(scheduled.id);
  expect(
    screen.getByRole('button', { name: 'Accept Beard Trim' }),
  ).toBeDisabled();
  expect(decline).toBeDisabled();
  api.read.mockResolvedValue(page({ requests: [request] }));
  await act(async () =>
    settle({ requestId: scheduled.id, status: 'declined' }),
  );
  expect(await screen.findByText('Request declined.')).toBeOnTheScreen();
  expect(screen.queryByText('Beard Trim')).toBeNull();
  expect(api.read.mock.calls.map(([cursor]) => cursor)).toEqual([null, null]);
});

test.each([
  ['request_not_pending', 'This request is no longer available.'],
  [
    'active_job_exists',
    'Finish your current Available Now job before accepting another.',
  ],
])('explains the server conflict %s and reloads', async (code, message) => {
  const alert = alertSpy();
  const api = mockApi();
  api.accept.mockRejectedValueOnce(new EdgeFunctionError(409, { error: code }));
  await mount(api);
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Accept Skin Fade' }),
  );
  api.read.mockResolvedValue(
    page(
      code === 'active_job_exists'
        ? { hasActiveAvailableNowJob: true }
        : { requests: [scheduled] },
    ),
  );
  await confirm(alert);
  expect(await screen.findByText(message)).toBeOnTheScreen();
  expect(api.read).toHaveBeenCalledTimes(2);
  if (code === 'active_job_exists') {
    expect(
      screen.getByRole('button', { name: 'Accept Skin Fade' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Decline Skin Fade' }),
    ).toBeEnabled();
  } else expect(screen.queryByText('Skin Fade')).toBeNull();
});

test.each([
  [401, 'unauthorized', 'Sign in again to respond to booking requests.'],
  [403, 'forbidden', 'You don’t have access to respond to this request.'],
  [
    422,
    'validation_failed',
    'This response couldn’t be sent. Try again from the refreshed list.',
  ],
  [
    500,
    'internal_error',
    'Could not verify the response. Check the refreshed requests before trying again.',
  ],
] as const)(
  'reports a %s failure and reloads without repeating the action',
  async (status, error, message) => {
    const api = mockApi();
    api.decline.mockRejectedValueOnce(new EdgeFunctionError(status, { error }));
    await mount(api);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Decline Beard Trim' }),
    );
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(api.decline).toHaveBeenCalledTimes(1);
    expect(api.read).toHaveBeenCalledTimes(2);
  },
);

const reliabilityCases = [
  {
    level: 'limited',
    allowed: false,
    suspended: false,
    message: /Available Now is paused until/,
  },
  {
    level: 'suspended',
    allowed: false,
    suspended: true,
    message: /Human reinstatement is required/,
  },
  {
    level: 'restricted',
    allowed: true,
    suspended: false,
    message: /You can use Available Now/,
  },
] as const;

test.each(reliabilityCases)(
  'refreshes standing after a conflict and preserves decline for $level',
  async ({ level, allowed, suspended, message }) => {
    const alert = alertSpy();
    const api = mockApi();
    api.accept.mockRejectedValueOnce(
      new EdgeFunctionError(409, { error: 'barber_unavailable' }),
    );
    api.readAvailability.mockResolvedValue({
      ...availability,
      reliability: {
        ...availability.reliability,
        level,
        availableNowAllowed: allowed,
        requiresHumanReinstatement: suspended,
        cooldownUntil: level === 'limited' ? scheduled.expiresAt : null,
      },
    });
    await mount(api);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Accept Skin Fade' }),
    );
    await confirm(alert);
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(api.readAvailability).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Decline Skin Fade' }),
      ).toBeEnabled(),
    );
    if (allowed)
      expect(
        screen.getByRole('button', { name: 'Accept Skin Fade' }),
      ).toBeEnabled();
    else
      expect(
        screen.getByRole('button', { name: 'Accept Skin Fade' }),
      ).toBeDisabled();
    if (suspended)
      expect(
        screen.getByRole('button', { name: 'Accept Beard Trim' }),
      ).toBeDisabled();
    else
      expect(
        screen.getByRole('button', { name: 'Accept Beard Trim' }),
      ).toBeEnabled();
  },
);

test('does not submit when the request expires while the native confirmation is open', async () => {
  const alert = alertSpy();
  const api = mockApi(
    page({ requests: [{ ...request, expiresAt: '2026-11-23T00:00:02Z' }] }),
  );
  await mount(api);
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Accept Skin Fade' }),
  );
  await act(async () => {
    jest.advanceTimersByTime(2100);
  });
  await confirm(alert);
  expect(api.accept).not.toHaveBeenCalled();
  expect(screen.getByText('Request expired')).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Decline Skin Fade' }),
  ).toBeNull();
});

test('checks the persisted booking status, retries errors and handles an unavailable booking', async () => {
  const api = mockApi();
  let reject!: (error: Error) => void;
  api.readBookingStatus.mockResolvedValueOnce(null).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = (id: string) => (
    <QueryClientProvider client={cache}>
      <BarberBookingStatusScreen
        read={api.readBookingStatus}
        bookingId={id}
        focused
        userId={userId}
        onInbox={jest.fn()}
      />
    </QueryClientProvider>
  );
  const status = await render(view(request.id));
  expect(
    await screen.findByText('This booking is unavailable.'),
  ).toBeOnTheScreen();
  await status.rerender(view(bookingId));
  expect(screen.getByText('Checking booking status…')).toBeOnTheScreen();
  await act(async () => reject(new Error('Synthetic connection error')));
  expect(
    await screen.findByText('Could not check the booking status.'),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Payment pending')).toBeOnTheScreen();
  expect(
    screen.getByText(/Wait for booking confirmation before travelling/),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/client was charged|payment received/i)).toBeNull();
});

test.each([
  ['captured', 'paid_confirmed', 'Payment was received for this booking.'],
  [
    'capture_failed',
    'accepted_pending_payment',
    'Payment could not be collected. Wait for booking confirmation before travelling.',
  ],
] as const)(
  'shows the accepting barber notice for %s',
  async (captureNotice, status, message) => {
    const api = mockApi();
    api.readBookingStatus.mockResolvedValue({
      id: bookingId,
      status,
      captureNotice,
    });
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    await render(
      <QueryClientProvider client={cache}>
        <BarberBookingStatusScreen
          read={api.readBookingStatus}
          bookingId={bookingId}
          userId={userId}
          focused
          onInbox={jest.fn()}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(message)).toBeOnTheScreen();
    if (captureNotice === 'capture_failed')
      expect(screen.getByText('Payment pending')).toBeOnTheScreen();
  },
);
