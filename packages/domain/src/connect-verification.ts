import type { VerificationStatus } from '@quicktrimr/shared';

export type ConnectVerificationInput = {
  linked: boolean;
  closed: boolean;
  rejected: boolean;
  capabilities: readonly [
    string | null,
    string | null,
    string | null,
    string | null,
  ];
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  actionRequired: boolean;
  verificationPending: boolean;
  previouslyVerified: boolean;
};

// RULE-CONNECT-STATUS-01. Provider I/O and personal requirement fields stay outside domain.
export function connectVerificationStatus(
  input: ConnectVerificationInput,
): VerificationStatus {
  if (!input.linked) return 'not_started';
  if (input.closed || input.rejected || input.capabilities.includes('rejected'))
    return 'failed';
  if (
    input.chargesEnabled &&
    input.payoutsEnabled &&
    input.capabilities.every((status) => status === 'active')
  )
    return 'verified';

  const understood = input.capabilities.every(
    (status) =>
      status === 'active' || status === 'pending' || status === 'restricted',
  );
  if (
    understood &&
    ((!input.detailsSubmitted && !input.previouslyVerified) ||
      (input.verificationPending && !input.actionRequired))
  )
    return 'pending';
  return 'requires_review';
}
