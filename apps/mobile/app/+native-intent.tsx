import { isStripeReturnUrl } from '../src/features/payment-authorisation/stripe-return-url';

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | null {
  if (!isStripeReturnUrl(path)) return path;
  // The active Stripe SDK consumes the callback. Keep its query out of app routes.
  return initial ? '/' : null;
}
