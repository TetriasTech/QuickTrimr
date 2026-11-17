import Stripe from 'stripe';

export class StripeConfigurationError extends Error {}

export function createSandboxStripe(key: string, platformAccountId: string) {
  if (
    !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key) ||
    !/^acct_[A-Za-z0-9]+$/.test(platformAccountId)
  )
    throw new StripeConfigurationError();
  const stripe = new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 0,
    timeout: 2_000,
    telemetry: false,
  });
  let platformCheck: Promise<void> | undefined;
  function verifyPlatform() {
    platformCheck ??= stripe.accounts
      .retrieveCurrent()
      .then((platform) => {
        if (platform.id !== platformAccountId)
          throw new StripeConfigurationError();
      })
      .catch((error: unknown) => {
        platformCheck = undefined;
        throw error;
      });
    return platformCheck;
  }
  return { stripe, verifyPlatform };
}
