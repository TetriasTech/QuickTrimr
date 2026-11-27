export const stripeReturnUrl = 'quicktrimr://stripe-redirect';

export function isStripeReturnUrl(url: string): boolean {
  return url.split(/[?#]/, 1)[0] === stripeReturnUrl;
}
