import assert from 'node:assert/strict';
import { test } from 'node:test';

import { connectVerificationStatus } from '../src/index.ts';

const active = {
  linked: true,
  closed: false,
  rejected: false,
  capabilities: ['active', 'active', 'active', 'active'],
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  actionRequired: false,
  verificationPending: false,
  previouslyVerified: false,
};
test('RULE-CONNECT-STATUS-01: ordered mapping covers all approved states', () => {
  assert.equal(
    connectVerificationStatus({ ...active, linked: false }),
    'not_started',
  );
  assert.equal(
    connectVerificationStatus({ ...active, closed: true }),
    'failed',
  );
  assert.equal(
    connectVerificationStatus({ ...active, rejected: true }),
    'failed',
  );
  assert.equal(connectVerificationStatus(active), 'verified');
  const incomplete = {
    ...active,
    chargesEnabled: false,
    payoutsEnabled: false,
    capabilities: ['restricted', 'restricted', 'restricted', 'restricted'],
    detailsSubmitted: false,
    actionRequired: true,
  };
  assert.equal(connectVerificationStatus(incomplete), 'pending');
  assert.equal(
    connectVerificationStatus({ ...incomplete, previouslyVerified: true }),
    'requires_review',
  );
  assert.equal(
    connectVerificationStatus({ ...incomplete, detailsSubmitted: true }),
    'requires_review',
  );
  assert.equal(
    connectVerificationStatus({
      ...active,
      payoutsEnabled: false,
      capabilities: ['active', 'pending', 'active', 'pending'],
      verificationPending: true,
      previouslyVerified: true,
    }),
    'pending',
  );
});
test('every required capability must be active and both eligibility gates must pass', () => {
  for (let slot = 0; slot < 4; slot++) {
    for (const status of [
      'rejected',
      'restricted',
      'unsupported',
      'future_unknown',
      null,
    ]) {
      const capabilities = [...active.capabilities];
      capabilities[slot] = status;
      const mapped = connectVerificationStatus({ ...active, capabilities });
      assert.equal(
        mapped,
        status === 'rejected' ? 'failed' : 'requires_review',
      );
    }
  }
  for (const gate of ['chargesEnabled', 'payoutsEnabled'])
    assert.equal(
      connectVerificationStatus({ ...active, [gate]: false }),
      'requires_review',
    );
});
test('missing or unsupported capabilities cannot become pending initial onboarding or verified', () => {
  for (const status of [null, 'unsupported', 'unknown'])
    assert.equal(
      connectVerificationStatus({
        ...active,
        detailsSubmitted: false,
        capabilities: [status, 'restricted', 'restricted', 'restricted'],
        verificationPending: true,
      }),
      'requires_review',
    );
  assert.equal(
    connectVerificationStatus({
      ...active,
      chargesEnabled: false,
      actionRequired: true,
      verificationPending: true,
    }),
    'requires_review',
  );
});
