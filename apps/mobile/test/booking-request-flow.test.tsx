import {
  bookingRequestReviewSchema,
  createBookingRequestResponseSchema,
} from '@quicktrimr/validation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react-native';

import { BookingRequestReviewScreen } from '../src/features/booking-requests/review-screen';
import { BookingRequestStatusScreen } from '../src/features/booking-requests/status-screen';
import { EdgeFunctionError } from '../src/lib/api/invoke-edge-function';

import type { BookingRequestApi } from '../src/features/booking-requests/booking-request-api';
import type { ComponentProps, ReactNode } from 'react';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = '2026-11-22T00:00:00Z';
const later = '2026-11-23T10:00:00Z';
const end = '2026-11-22T00:00:02Z';
const quote = bookingRequestReviewSchema.parse({
  barberName: 'QA Barber',
  serviceName: 'Skin Fade',
  priceCents: 4503,
  address: {
    id,
    label: 'Demo',
    line1: '1 Synthetic Road',
    unit: '',
    suburb: 'Demo',
    state: 'VIC',
    postcode: '3000',
    accessNotes: '',
    archivedAt: null,
    createdAt: now,
  },
  cancellation: { refundPct: 50, lateWindowHours: null },
  scheduledIssue: null,
  reviewToken: 'a'.repeat(64),
});
const submitted = createBookingRequestResponseSchema.parse({
  id,
  bookingType: 'available_now',
  status: 'pending',
  servicePriceCents: 4503,
  commissionPct: 20,
  grossCents: 4503,
  commissionCents: 900,
  barberNetCents: 3603,
  createdAt: now,
  expiresAt: end,
});

function apiMock() {
  return {
    review: jest
      .fn<
        ReturnType<BookingRequestApi['review']>,
        Parameters<BookingRequestApi['review']>
      >()
      .mockResolvedValue(quote),
    submit: jest
      .fn<
        ReturnType<BookingRequestApi['submit']>,
        Parameters<BookingRequestApi['submit']>
      >()
      .mockResolvedValue(submitted),
    status: jest
      .fn<
        ReturnType<BookingRequestApi['status']>,
        Parameters<BookingRequestApi['status']>
      >()
      .mockResolvedValue({
        id,
        bookingType: 'available_now',
        status: 'pending',
        expiresAt: end,
        serverNow: now,
      }),
  };
}

function reviewProps(
  api = apiMock(),
): ComponentProps<typeof BookingRequestReviewScreen> {
  return {
    userId: id,
    api,
    input: {
      bookingType: 'available_now',
      barberId: id,
      serviceCategoryId: id,
      clientAddressId: id,
    },
    onEdit: jest.fn(),
    onSent: jest.fn(),
    onExisting: jest.fn(),
  };
}

function wrap() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function BookingRequestTestProvider({
    children,
  }: {
    children: ReactNode;
  }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
});

test('review renders the current price, service, barber, own address, payment disclosure and edit limit', async () => {
  await render(<BookingRequestReviewScreen {...reviewProps()} />, {
    wrapper: wrap(),
  });
  expect(await screen.findByText('Skin Fade')).toBeOnTheScreen();
  expect(screen.getByText('with QA Barber')).toBeOnTheScreen();
  expect(screen.getByText(/45.03/)).toBeOnTheScreen();
  expect(screen.getByText(/1 Synthetic Road/)).toBeOnTheScreen();
  expect(screen.getByText(/No payment is collected/)).toHaveTextContent(
    /charge only after the barber accepts/,
  );
  expect(
    screen.getByText('You cannot edit a request after you send it.'),
  ).toBeOnTheScreen();
  expect(screen.getByText(/50% refund/)).toBeOnTheScreen();
  expect(screen.queryByText('Requested time')).toBeNull();
});

test('Scheduled quote shows requested time and current terms, and preserves input on an aged selection', async () => {
  const api = apiMock();
  const scheduled = {
    ...quote,
    cancellation: { refundPct: 75, lateWindowHours: 12 },
  };
  const p = reviewProps(api);
  p.input = { ...p.input, bookingType: 'scheduled', scheduledFor: later };
  const message =
    "Scheduled bookings need at least 6 hours' notice. Try Available Now for sooner.";
  api.review
    .mockResolvedValueOnce(scheduled)
    .mockResolvedValue({ ...scheduled, scheduledIssue: message });
  await render(<BookingRequestReviewScreen {...p} />, { wrapper: wrap() });
  expect(await screen.findByText('Requested time')).toBeOnTheScreen();
  expect(screen.getByText(/12 hours or less.*75% refund/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
  expect(await screen.findByText(message)).toBeOnTheScreen();
  expect(screen.getByText('Requested time')).toBeOnTheScreen();
  expect(api.submit).not.toHaveBeenCalled();
  expect(p.input.scheduledFor).toBe(later);
  await fireEvent.press(screen.getByRole('button', { name: 'Edit request' }));
  expect(p.onEdit).toHaveBeenCalledTimes(1);
});

test('concurrent taps send one request with the server comparison token', async () => {
  const api = apiMock();
  const p = reviewProps(api);
  let settle!: (r: typeof submitted) => void;
  api.submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  await render(<BookingRequestReviewScreen {...p} />, { wrapper: wrap() });
  const button = await screen.findByRole('button', { name: 'Send request' });
  await act(async () => {
    await fireEvent.press(button);
    await fireEvent.press(button);
  });
  expect(api.submit).toHaveBeenCalledTimes(1);
  expect(api.submit).toHaveBeenCalledWith({
    ...p.input,
    reviewToken: quote.reviewToken,
  });
  expect(button).toBeDisabled();
  await act(async () => settle(submitted));
  expect(p.onSent).toHaveBeenCalledWith(id);
});

test('changed price requires review again; backend Scheduled field error and failed network retry preserve the draft', async () => {
  const api = apiMock();
  const p = reviewProps(api);
  p.input = { ...p.input, bookingType: 'scheduled', scheduledFor: later };
  api.review
    .mockResolvedValueOnce(quote)
    .mockResolvedValue({ ...quote, reviewToken: 'b'.repeat(64) });
  api.submit.mockRejectedValueOnce(new Error('offline'));
  api.submit.mockRejectedValueOnce(
    new EdgeFunctionError(422, {
      error: 'validation_failed',
      fields: { scheduledFor: 'Choose a later requested time.' },
    }),
  );
  await render(<BookingRequestReviewScreen {...p} />, { wrapper: wrap() });
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Send request' }),
  );
  expect(await screen.findByText(/details changed/)).toBeOnTheScreen();
  expect(api.submit).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
  expect(await screen.findByText(/Could not send/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
  expect(
    await screen.findByText('Choose a later requested time.'),
  ).toBeOnTheScreen();
  expect(screen.getByText('Requested time')).toBeOnTheScreen();
  expect(api.submit).toHaveBeenCalledTimes(2);
});

test('Available Now conflict points to the existing request', async () => {
  const api = apiMock();
  const p = reviewProps(api);
  api.submit.mockRejectedValue(
    new EdgeFunctionError(409, { error: 'active_request_exists' }),
  );
  await render(<BookingRequestReviewScreen {...p} />, { wrapper: wrap() });
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Send request' }),
  );
  expect(
    await screen.findByText(/already have an Available Now request/),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole('button', { name: 'View existing request' }),
  );
  expect(p.onExisting).toHaveBeenCalledTimes(1);
});

test('countdown reaches zero, checks once and displays pending until the reopened screen reads a terminal response', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'setImmediate'] });
  const api = apiMock();
  const p = {
    api,
    userId: id,
    requestId: id,
    activeAvailableNow: false,
    focused: true,
    onDiscovery: jest.fn(),
    onResolvedId: jest.fn(),
  };
  const first = await render(<BookingRequestStatusScreen {...p} />, {
    wrapper: wrap(),
  });
  expect(await screen.findByText('0:02')).toBeOnTheScreen();
  await act(async () => {
    jest.advanceTimersByTime(2100);
  });
  expect(
    await screen.findByText(/response window has ended/),
  ).toBeOnTheScreen();
  await act(async () => {
    jest.advanceTimersByTime(10000);
  });
  expect(api.status).toHaveBeenCalledTimes(2);
  expect(api.submit).not.toHaveBeenCalled();
  expect(screen.getByText('Waiting for a reply')).toBeOnTheScreen();
  await first.unmount();
  api.status.mockResolvedValue({
    id,
    bookingType: 'available_now',
    status: 'expired',
    expiresAt: end,
    serverNow: end,
  });
  await render(<BookingRequestStatusScreen {...p} />, { wrapper: wrap() });
  expect(await screen.findByText('Request expired')).toBeOnTheScreen();
});

test.each([
  ['accepted', 'Back to discovery'],
  ['declined', 'Find another barber'],
  ['expired', 'Start a new search'],
  ['cancelled', 'Find a barber'],
] as const)('server status %s provides an action', async (status, action) => {
  const api = apiMock(),
    onDiscovery = jest.fn();
  api.status.mockResolvedValue({
    id,
    bookingType: 'scheduled',
    status,
    expiresAt: end,
    serverNow: now,
  });
  await render(
    <BookingRequestStatusScreen
      api={api}
      userId={id}
      requestId={id}
      activeAvailableNow={false}
      focused
      onDiscovery={onDiscovery}
      onResolvedId={jest.fn()}
    />,
    { wrapper: wrap() },
  );
  expect(await screen.findByText('Request ' + status)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: action }));
  expect(onDiscovery).toHaveBeenCalledTimes(1);
});

test('review distinguishes loading, retryable errors and an unavailable service', async () => {
  const api = apiMock();
  let finish!: (value: typeof quote | null) => void;
  api.review.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const initial = await render(
    <BookingRequestReviewScreen {...reviewProps(api)} />,
    { wrapper: wrap() },
  );
  expect(screen.getByText('Loading your request…')).toBeOnTheScreen();
  expect(screen.queryByText('This service is no longer available.')).toBeNull();
  await act(async () => finish(null));
  expect(
    await screen.findByText('This service is no longer available.'),
  ).toBeOnTheScreen();
  await initial.unmount();
  api.review.mockRejectedValueOnce(new Error('offline'));
  await render(<BookingRequestReviewScreen {...reviewProps(api)} />, {
    wrapper: wrap(),
  });
  expect(
    await screen.findByText('Could not load your request details.'),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Skin Fade')).toBeOnTheScreen();
});

test.each([
  ['captured', 'Payment was received for this booking.'],
  [
    'capture_failed',
    'Payment could not be collected. Your booking is awaiting payment confirmation.',
  ],
] as const)(
  'shows the client notice after the server records %s',
  async (captureNotice, message) => {
    const api = apiMock();
    const accepted = {
      id,
      bookingType: 'scheduled',
      status: 'accepted',
      expiresAt: end,
      serverNow: now,
    } as const;
    api.status
      .mockResolvedValueOnce(accepted)
      .mockResolvedValue({ ...accepted, captureNotice });
    await render(
      <BookingRequestStatusScreen
        api={api}
        userId={id}
        requestId={id}
        activeAvailableNow={false}
        focused
        onDiscovery={jest.fn()}
        onResolvedId={jest.fn()}
      />,
      { wrapper: wrap() },
    );
    expect(await screen.findByText('Request accepted')).toBeOnTheScreen();
    expect(screen.queryByText(message)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(api.submit).not.toHaveBeenCalled();
  },
);
