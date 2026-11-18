import type { VerificationStatus } from '@quicktrimr/shared';

export const connectStatusCopy = {
  not_started: {
    label: 'Not started',
    message:
      'Set up your Stripe account to receive payments for your bookings.',
    action: 'Start Stripe setup',
    tone: 'neutral',
  },
  pending: {
    label: 'Pending',
    message:
      'Finish any remaining steps in Stripe. If you have submitted everything, Stripe may still be checking it.',
    action: 'Continue Stripe setup',
    tone: 'info',
  },
  verified: {
    label: 'Verified',
    message:
      'Stripe setup is complete. QuickTrimr also checks your profile and service settings before enabling bookings.',
    action: null,
    tone: 'success',
  },
  failed: {
    label: 'Failed',
    message:
      'Stripe could not approve this account. Open Stripe to see the next steps or contact Stripe support.',
    action: 'View Stripe next steps',
    tone: 'danger',
  },
  requires_review: {
    label: 'Action required',
    message:
      'Stripe needs your attention. Open Stripe to review restrictions or provide the information requested.',
    action: 'Review in Stripe',
    tone: 'warning',
  },
} as const satisfies Record<
  VerificationStatus,
  {
    label: string;
    message: string;
    action: string | null;
    tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning';
  }
>;

export const connectIncompleteWarning =
  'You cannot receive paid bookings until Stripe verification is complete.';

export function connectNeedsWarning(
  status: VerificationStatus | undefined,
  refreshFailed: boolean,
) {
  return refreshFailed || status !== 'verified';
}
