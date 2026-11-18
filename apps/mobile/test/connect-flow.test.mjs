import assert from 'node:assert/strict';
import test from 'node:test';

import { VERIFICATION_STATUS } from '@quicktrimr/shared';

import { connectApi } from '../src/features/connect/connect-api.ts';
import {
  connectCallbackAction,
  runConnectOnboarding,
} from '../src/features/connect/connect-flow.ts';
import {
  connectNeedsWarning,
  connectStatusCopy,
} from '../src/features/connect/connect-presentation.ts';
import { EdgeFunctionError } from '../src/lib/api/invoke-edge-function.ts';

const callbackUrl = 'quicktrimr://connect';
const pending = {
  accountStatus: 'pending',
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
};

function setup(overrides = {}) {
  const calls = [];
  let link = 0;
  const dependencies = {
    signal: new AbortController().signal,
    callbackUrl,
    now: () => Date.parse('2026-11-18T01:00:00Z'),
    async createLink() {
      calls.push('link');
      return {
        onboardingUrl: `https://connect.stripe.com/setup/synthetic_${++link}`,
        expiresAt: '2026-11-18T02:00:00Z',
        accountStatus: 'pending',
      };
    },
    async refresh() {
      calls.push('refresh');
      return pending;
    },
    async openBrowser(url) {
      calls.push(url);
      return {
        type: 'success',
        url: `${callbackUrl}?action=return&status=verified`,
      };
    },
    ...overrides,
  };
  return { calls, dependencies };
}

test('every approved status has distinct copy and every unverified status has a persistent warning/action', () => {
  assert.deepEqual(
    Object.keys(connectStatusCopy).sort(),
    [...VERIFICATION_STATUS].sort(),
  );
  const labels = new Set();
  for (const status of VERIFICATION_STATUS) {
    labels.add(connectStatusCopy[status].label);
    assert.equal(connectNeedsWarning(status, false), status !== 'verified');
    assert.equal(
      connectStatusCopy[status].action === null,
      status === 'verified',
    );
    assert.equal(connectNeedsWarning(status, true), true);
  }
  assert.equal(labels.size, VERIFICATION_STATUS.length);
  assert.equal(connectNeedsWarning(undefined, false), true);
});

test('return without completion refetches pending and ignores a forged verified callback', async () => {
  const { calls, dependencies } = setup();
  let actual;
  dependencies.refresh = async () => {
    calls.push('refresh');
    actual = pending;
    return pending;
  };
  assert.equal(await runConnectOnboarding(dependencies), 'returned');
  assert.equal(actual.accountStatus, 'pending');
  assert.deepEqual(calls, [
    'link',
    'https://connect.stripe.com/setup/synthetic_1',
    'refresh',
  ]);
});

test('abandonment rechecks status and the next user action requests a fresh link', async () => {
  const { calls, dependencies } = setup({
    openBrowser: async () => ({ type: 'cancel' }),
  });
  await runConnectOnboarding(dependencies);
  await runConnectOnboarding(dependencies);
  assert.deepEqual(calls, ['link', 'refresh', 'link', 'refresh']);
});

test('an expired-link redirect automatically obtains a different link and refreshes after each browser return', async () => {
  const urls = [];
  const { calls, dependencies } = setup({
    async openBrowser(url) {
      urls.push(url);
      return {
        type: 'success',
        url: `${callbackUrl}?action=${urls.length === 1 ? 'refresh' : 'return'}`,
      };
    },
  });
  assert.equal(await runConnectOnboarding(dependencies), 'returned');
  assert.equal(new Set(urls).size, 2);
  assert.deepEqual(calls, ['link', 'refresh', 'link', 'refresh']);
});

test('redirect loops stop safely and already-expired responses never open a browser', async () => {
  const { calls, dependencies } = setup({
    openBrowser: async () => ({
      type: 'success',
      url: `${callbackUrl}?action=refresh`,
    }),
  });
  assert.equal(await runConnectOnboarding(dependencies), 'renewal_needed');
  assert.deepEqual(calls, ['link', 'refresh', 'link', 'refresh']);
  dependencies.createLink = async () => ({
    onboardingUrl: 'https://connect.stripe.com/setup/expired',
    expiresAt: '2026-11-18T01:00:00Z',
    accountStatus: 'pending',
  });
  dependencies.openBrowser = async () => assert.fail('Expired link was opened');
  assert.equal(await runConnectOnboarding(dependencies), 'renewal_needed');
});

test('provider outages propagate for safe retry and browser failures still refresh status', async () => {
  const { calls, dependencies } = setup({
    openBrowser: async () => {
      throw new Error('browser unavailable');
    },
  });
  await assert.rejects(
    runConnectOnboarding(dependencies),
    /browser unavailable/,
  );
  assert.deepEqual(calls, ['link', 'refresh']);
  dependencies.createLink = async () => {
    throw new EdgeFunctionError(502, { error: 'stripe_unavailable' });
  };
  await assert.rejects(
    runConnectOnboarding(dependencies),
    /stripe_unavailable/,
  );
  dependencies.createLink = async () => {
    throw new EdgeFunctionError(409, { error: 'onboarding_complete' });
  };
  assert.equal(await runConnectOnboarding(dependencies), 'returned');
  assert.equal(calls.at(-1), 'refresh');
});

test('signing out during link creation never opens the old account URL', async () => {
  const controller = new AbortController();
  const { dependencies } = setup({ signal: controller.signal });
  const original = dependencies.createLink;
  dependencies.createLink = async () => {
    const link = await original();
    controller.abort();
    return link;
  };
  dependencies.openBrowser = async () => assert.fail('Old account opened');
  await assert.rejects(runConnectOnboarding(dependencies), {
    name: 'AbortError',
  });
});

test('callbacks require the exact configured destination and never supply an account or status', () => {
  assert.equal(
    connectCallbackAction(
      `${callbackUrl}?action=refresh&account=other`,
      callbackUrl,
    ),
    'refresh',
  );
  for (const url of [
    'https://bad.example? action=refresh',
    'quicktrimr://connect-other?action=refresh',
    'quicktrimr://connect/other?action=refresh',
    'quicktrimr://user@connect?action=refresh',
    `${callbackUrl}?status=verified`,
  ])
    assert.equal(connectCallbackAction(url, callbackUrl), null);
});

test('API calls use current bearer credentials, empty validated bodies, cancellation and user-scoped identity', async () => {
  const calls = [];
  let currentUser = 'barber-a';
  const supabase = {
    auth: {
      async getSession() {
        return {
          data: {
            session: { user: { id: currentUser }, access_token: 'test-token' },
          },
          error: null,
        };
      },
    },
    functions: {
      async invoke(name, options) {
        calls.push(name);
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        assert.deepEqual(JSON.parse(options.body), {});
        assert.ok(options.signal instanceof AbortSignal);
        return { data: pending, error: null };
      },
    },
  };
  const api = connectApi(supabase, 'barber-a');
  assert.deepEqual(await api.refresh(new AbortController().signal), pending);
  currentUser = 'barber-b';
  await assert.rejects(
    api.refresh(new AbortController().signal),
    /Session changed/,
  );
  await assert.rejects(
    api.createLink(new AbortController().signal),
    /Session changed/,
  );
  assert.deepEqual(calls, ['refresh-stripe-connect-status']);
});
