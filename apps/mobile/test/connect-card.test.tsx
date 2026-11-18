import { VERIFICATION_STATUS } from '@quicktrimr/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef } from 'react';

import { ConnectCard } from '../src/features/connect/connect-card';
import {
  connectIncompleteWarning,
  connectStatusCopy,
} from '../src/features/connect/connect-presentation';
import {
  ConnectProvider,
  useConnect,
} from '../src/features/connect/connect-provider';

import type { VerificationStatus } from '@quicktrimr/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@expo/ui', () => ({ BottomSheet: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-linking', () => ({ createURL: () => 'quicktrimr://connect' }));
jest.mock('expo-web-browser', () => ({
  WebBrowserResultType: { CANCEL: 'cancel' },
  openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })),
  dismissAuthSession: jest.fn(),
}));

function ColdRefreshCallback() {
  const flow = useConnect();
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    flow.callback('refresh');
  }, [flow]);
  return null;
}

function fixture(
  initialStatus: VerificationStatus = 'not_started',
  coldRefresh = false,
) {
  let status = initialStatus;
  let unavailable = false;
  let links = 0;
  const invoke = jest.fn(async (name: string) => {
    if (unavailable) throw new Error('Synthetic provider outage');
    if (name === 'refresh-stripe-connect-status')
      return {
        data: {
          accountStatus: status,
          chargesEnabled: status === 'verified',
          payoutsEnabled: status === 'verified',
          detailsSubmitted: status !== 'not_started',
        },
        error: null,
      };
    links++;
    status = 'pending';
    return {
      data: {
        onboardingUrl: `https://connect.stripe.com/setup/fixture_${links}`,
        expiresAt: '2099-01-01T00:00:00Z',
        accountStatus: 'pending',
      },
      error: null,
    };
  });
  const supabase = {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: 'test-barber' },
            access_token: 'synthetic-token',
          },
        },
        error: null,
      }),
    },
    functions: { invoke },
  } as unknown as SupabaseClient;
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    cache,
    invoke,
    setUnavailable(value: boolean) {
      unavailable = value;
    },
    ui: (
      <QueryClientProvider client={cache}>
        <ConnectProvider userId="test-barber" supabase={supabase}>
          {coldRefresh && <ColdRefreshCallback />}
          <ConnectCard />
        </ConnectProvider>
      </QueryClientProvider>
    ),
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

test('a cold expired-link callback starts a fresh browser session after provider mount', async () => {
  const f = fixture('pending', true);
  await render(f.ui);
  await waitFor(() =>
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue Stripe setup' }),
    ).toBeEnabled(),
  );
});

test('the first status check shows loading and failure offers a retry without inventing a status', async () => {
  const f = fixture();
  let release: (() => void) | undefined;
  f.invoke.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    throw new Error('Synthetic offline first load');
  });
  await render(f.ui);
  expect(screen.getByText('Checking Stripe status…')).toBeOnTheScreen();
  expect(screen.queryByText('Not started')).toBeNull();
  await act(async () => {
    release?.();
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled(),
  );
  expect(screen.getByText(connectIncompleteWarning)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(screen.getByText('Not started')).toBeOnTheScreen(),
  );
});

test.each(VERIFICATION_STATUS)(
  '%s renders its distinct label, next action and warning policy',
  async (status) => {
    const f = fixture(status);
    await render(f.ui);
    await waitFor(() =>
      expect(
        screen.getByText(connectStatusCopy[status].label),
      ).toBeOnTheScreen(),
    );
    if (status === 'verified') {
      expect(screen.queryByText(connectIncompleteWarning)).toBeNull();
      expect(
        screen.queryByRole('button', {
          name: /Start Stripe|Continue Stripe|Review in Stripe|View Stripe/,
        }),
      ).toBeNull();
    } else {
      expect(screen.getByText(connectIncompleteWarning)).toBeOnTheScreen();
      expect(
        screen.getByRole('button', { name: connectStatusCopy[status].action! }),
      ).toBeEnabled();
    }
  },
);

test('abandoning setup changes only to the server pending state and resume gets a fresh URL', async () => {
  const f = fixture();
  await render(f.ui);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Start Stripe setup' }),
    ).toBeEnabled(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Start Stripe setup' }),
  );
  await waitFor(() => expect(screen.getByText('Pending')).toBeOnTheScreen());
  expect(screen.getByText(connectIncompleteWarning)).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Continue Stripe setup' }),
  );
  await waitFor(() =>
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(2),
  );
  expect(
    jest.mocked(WebBrowser.openAuthSessionAsync).mock.calls.map(([url]) => url),
  ).toEqual([
    'https://connect.stripe.com/setup/fixture_1',
    'https://connect.stripe.com/setup/fixture_2',
  ]);
  // Only the safe four-field status is cached; bearer links never enter query data.
  expect(
    JSON.stringify(
      f.cache
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    ),
  ).not.toContain('stripe.com');
});

test('a provider outage preserves prior status with an explicit error and a working retry', async () => {
  const f = fixture('verified');
  await render(f.ui);
  await waitFor(() => expect(screen.getByText('Verified')).toBeOnTheScreen());
  f.setUnavailable(true);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Check Stripe status' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Last checked: Verified')).toBeOnTheScreen(),
  );
  expect(screen.getByText(/Could not check Stripe status/)).toBeOnTheScreen();
  expect(screen.queryByText(connectStatusCopy.verified.message)).toBeNull();
  f.setUnavailable(false);
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.getByText('Verified')).toBeOnTheScreen());
});

test('loading disables actions and repeated presses open only one browser session', async () => {
  const f = fixture();
  let finish:
    ((value: WebBrowser.WebBrowserAuthSessionResult) => void) | undefined;
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(f.ui);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Start Stripe setup' }),
    ).toBeEnabled(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Start Stripe setup' }),
  );
  const start = screen.getByRole('button', { name: 'Start Stripe setup' });
  expect(start).toBeDisabled();
  await fireEvent.press(start);
  expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish?.({ type: WebBrowser.WebBrowserResultType.CANCEL });
  });
});

test('repeated status retry taps share one in-flight provider read', async () => {
  const f = fixture('pending');
  await render(f.ui);
  await waitFor(() => expect(screen.getByText('Pending')).toBeOnTheScreen());
  f.setUnavailable(true);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Check Stripe status' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled(),
  );
  f.setUnavailable(false);
  const before = f.invoke.mock.calls.length;
  const original = f.invoke.getMockImplementation()!;
  let release: (() => void) | undefined;
  f.invoke.mockImplementationOnce(async (name) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return original(name);
  });
  const retry = screen.getByRole('button', { name: 'Try again' });
  await fireEvent.press(retry);
  // The first provider read stays unresolved while another tap arrives.
  await fireEvent.press(retry);
  await act(async () => {
    release?.();
  });
  await waitFor(() => expect(screen.getByText('Pending')).toBeOnTheScreen());
  expect(f.invoke.mock.calls.length - before).toBe(1);
});
