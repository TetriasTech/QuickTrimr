import Stripe from 'stripe';

type Options = {
  key: string;
  platformAccountId: string;
  returnUrl: string;
  refreshUrl: string;
};

const accountIdPattern = /^acct_[A-Za-z0-9]+$/;
const accountIncludes = [
  'configuration.merchant',
  'configuration.recipient',
  'defaults',
  'identity',
] as const;

export class UnsupportedStripeConfiguration extends Error {}

function callback(raw: string) {
  const url = URL.parse(raw);
  if (!url) throw new UnsupportedStripeConfiguration();
  const isLocalHttp =
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !isLocalHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new UnsupportedStripeConfiguration();
  return url;
}

export function createStripeConnect({
  key,
  platformAccountId,
  returnUrl,
  refreshUrl,
}: Options) {
  if (
    !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key) ||
    !accountIdPattern.test(platformAccountId)
  )
    throw new UnsupportedStripeConfiguration();

  const returnCallback = callback(returnUrl);
  const refreshCallback = callback(refreshUrl);
  if (
    returnCallback.origin !== refreshCallback.origin ||
    returnCallback.pathname === refreshCallback.pathname
  )
    throw new UnsupportedStripeConfiguration();

  const stripe = new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    timeout: 10_000,
    telemetry: false,
  });

  // A cold worker verifies the key belongs to the configured customer sandbox.
  // Share successful verification and allow the next invocation to retry a failure.
  let platformCheck: Promise<void> | undefined;
  async function verifyPlatform() {
    platformCheck ??= stripe.accounts
      .retrieveCurrent()
      .then((platform) => {
        if (platform.id !== platformAccountId)
          throw new UnsupportedStripeConfiguration();
      })
      .catch((error: unknown) => {
        platformCheck = undefined;
        throw error;
      });
    return platformCheck;
  }

  return {
    verifyPlatform,
    async createAccount(operationId: string) {
      const account = await stripe.v2.core.accounts.create(
        {
          // Stripe requires a contact email for recipient accounts. Use a stable
          // synthetic address in this sandbox-only integration.
          contact_email: `quicktrimr-connect+${operationId}@example.com`,
          dashboard: 'express',
          defaults: {
            currency: 'aud',
            responsibilities: {
              fees_collector: 'application',
              losses_collector: 'application',
            },
          },
          identity: { country: 'au' },
          configuration: {
            merchant: { capabilities: { card_payments: { requested: true } } },
            recipient: {
              capabilities: {
                stripe_balance: { stripe_transfers: { requested: true } },
              },
            },
          },
          metadata: { quicktrimr_connect_operation: operationId },
          include: [...accountIncludes],
        },
        { idempotencyKey: `quicktrimr:connect-account:${operationId}` },
      );

      if (
        !accountIdPattern.test(account.id) ||
        account.id === platformAccountId ||
        account.livemode !== false ||
        account.metadata?.quicktrimr_connect_operation !== operationId
      )
        throw new UnsupportedStripeConfiguration();
      return account;
    },
    retrieveAccount(accountId: string) {
      return stripe.v2.core.accounts.retrieve(accountId, {
        include: [...accountIncludes],
      });
    },
    async enforcePayoutPolicy(account: Stripe.V2.Core.Account) {
      const { defaults, configuration, identity } = account;
      if (
        account.livemode !== false ||
        account.closed ||
        account.dashboard !== 'express' ||
        defaults?.responsibilities?.fees_collector !== 'application' ||
        defaults.responsibilities.losses_collector !== 'application' ||
        defaults.responsibilities.requirements_collector !== 'stripe' ||
        defaults.currency !== 'aud' ||
        identity?.country?.toUpperCase() !== 'AU' ||
        !configuration?.merchant?.capabilities?.card_payments ||
        !configuration.recipient?.capabilities?.stripe_balance?.stripe_transfers
      )
        throw new UnsupportedStripeConfiguration();

      const options = { stripeAccount: account.id };
      let settings = await stripe.balanceSettings.retrieve({}, options);
      if (settings.payments?.payouts?.schedule?.interval !== 'manual') {
        await stripe.balanceSettings.update(
          {
            payments: { payouts: { schedule: { interval: 'manual' } } },
          },
          options,
        );
        settings = await stripe.balanceSettings.retrieve({}, options);
      }
      if (settings.payments?.payouts?.schedule?.interval !== 'manual')
        throw new UnsupportedStripeConfiguration();

      const merchant = configuration.merchant.capabilities;
      const recipient = configuration.recipient.capabilities.stripe_balance;
      return (
        merchant.card_payments?.status === 'active' &&
        merchant.stripe_balance?.payouts?.status === 'active' &&
        recipient.stripe_transfers?.status === 'active' &&
        recipient.payouts?.status === 'active'
      );
    },
    async issueLink(accountId: string) {
      const link = await stripe.v2.core.accountLinks.create({
        account: accountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            return_url: returnCallback.href,
            refresh_url: refreshCallback.href,
          },
        },
      });
      const url = new URL(link.url);
      if (
        link.livemode !== false ||
        link.account !== accountId ||
        url.protocol !== 'https:' ||
        !['connect.stripe.com', 'accounts.stripe.com'].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.port
      )
        throw new UnsupportedStripeConfiguration();
      return { onboardingUrl: link.url, expiresAt: link.expires_at };
    },
  };
}

export type StripeConnect = ReturnType<typeof createStripeConnect>;
