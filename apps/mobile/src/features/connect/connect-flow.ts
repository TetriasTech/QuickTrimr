import { EdgeFunctionError } from '../../lib/api/invoke-edge-function.ts';

import type {
  CreateStripeConnectOnboardingLinkResponse,
  RefreshStripeConnectStatusResponse,
} from '@quicktrimr/validation';

export type ConnectBrowserResult =
  | { type: 'success'; url: string }
  | { type: 'cancel' | 'dismiss' | 'opened' | 'locked' };

export function connectCallbackAction(raw: string, callbackUrl: string) {
  try {
    const url = new URL(raw);
    const expected = new URL(callbackUrl);
    if (
      url.protocol !== expected.protocol ||
      url.host !== expected.host ||
      url.pathname !== expected.pathname ||
      url.username ||
      url.password
    )
      return null;
    const action = url.searchParams.get('action');
    return action === 'return' || action === 'refresh' ? action : null;
  } catch {
    return null;
  }
}

export type ConnectFlowDependencies = {
  createLink: () => Promise<CreateStripeConnectOnboardingLinkResponse>;
  refresh: () => Promise<RefreshStripeConnectStatusResponse>;
  openBrowser: (url: string) => Promise<ConnectBrowserResult>;
  callbackUrl: string;
  signal: AbortSignal;
  now?: () => number;
};

// Browser orchestration only: status and paid-booking eligibility remain server-owned.
export async function runConnectOnboarding({
  createLink,
  refresh,
  openBrowser,
  callbackUrl,
  signal,
  now = Date.now,
}: ConnectFlowDependencies): Promise<'returned' | 'renewal_needed'> {
  function active() {
    signal.throwIfAborted();
  }
  // One automatic renewal per user action prevents a broken redirect loop.
  for (let attempt = 0; attempt < 2; attempt++) {
    active();
    let link;
    try {
      link = await createLink();
    } catch (error) {
      active();
      if (
        error instanceof EdgeFunctionError &&
        error.response.error === 'onboarding_complete'
      ) {
        await refresh();
        active();
        return 'returned';
      }
      throw error;
    }
    active();
    if (Date.parse(link.expiresAt) <= now()) continue;
    let result;
    try {
      result = await openBrowser(link.onboardingUrl);
    } finally {
      // Cancel, dismiss and browser failures also recheck the server.
      active();
      await refresh();
      active();
    }
    if (
      result.type !== 'success' ||
      connectCallbackAction(result.url, callbackUrl) !== 'refresh'
    )
      return 'returned';
  }
  return 'renewal_needed';
}
