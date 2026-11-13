import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  LocalInputError,
  assessPolicyCompatibility,
  parseArguments,
  sandboxClient,
  summarisePayoutControls,
} from './read-payout-controls.mjs';

const compliantAccount = {
  id: 'acct_connected',
  payouts_enabled: true,
  controller: {
    stripe_dashboard: { type: 'express' },
    fees: { payer: 'application' },
    losses: { payments: 'application' },
  },
  settings: {
    payouts: {
      debit_negative_balances: true,
      schedule: { interval: 'manual', delay_days: 2 },
    },
  },
};

test('argument parsing rejects identifiers carrying extra characters', () => {
  for (const platform of ['acct_abc/', 'acct_abc ', 'acct abc', 'abc', '']) {
    assert.throws(
      () => parseArguments(['--platform', platform, '--connected', 'acct_b']),
      LocalInputError,
      `expected rejection: ${JSON.stringify(platform)}`,
    );
  }
  assert.throws(
    () => parseArguments(['--connected', 'acct_b']),
    LocalInputError,
  );
  assert.throws(
    () => parseArguments(['--platform', 'acct_a', '--connected', 'acct_a']),
    LocalInputError,
  );
  assert.deepEqual(
    parseArguments(['--platform', 'acct_a', '--connected', 'acct_b']),
    { platformId: 'acct_a', connectedId: 'acct_b' },
  );
});

test('a live or malformed credential is refused before any network call', async () => {
  for (const key of ['sk_live_abc', 'pk_test_abc', '', undefined]) {
    await assert.rejects(
      sandboxClient({
        key,
        platformId: 'acct_a',
        factory: () => assert.fail('must not construct a client'),
      }),
      LocalInputError,
    );
  }
});

test('a credential belonging to another platform is refused', async () => {
  await assert.rejects(
    sandboxClient({
      key: 'sk_test_abc',
      platformId: 'acct_expected',
      factory: () => ({
        accounts: { retrieve: async () => ({ id: 'acct_other' }) },
      }),
    }),
    /does not match the selected platform/,
  );
});

test('a manual schedule with no connected-account control satisfies RULE-EARN-07', () => {
  const summary = summarisePayoutControls(compliantAccount, {
    payouts: {
      manual_payouts: false,
      edit_payout_schedule: false,
      instant_payouts: false,
    },
  });
  assert.equal(summary.scheduleInterval, 'manual');
  assert.equal(summary.feesPayer, 'application');
  assert.equal(summary.lossesPayments, 'application');
  assert.deepEqual(assessPolicyCompatibility(summary), {
    problems: [],
    unknown: [],
  });
});

test('an automatic schedule or a retained payout control is reported', () => {
  const summary = summarisePayoutControls(
    {
      ...compliantAccount,
      settings: { payouts: { schedule: { interval: 'daily' } } },
    },
    {
      payouts: {
        manual_payouts: true,
        edit_payout_schedule: true,
        instant_payouts: true,
      },
    },
  );
  const { problems } = assessPolicyCompatibility(summary);
  assert.equal(problems.length, 4);
  assert.match(problems[0], /RULE-EARN-07 needs platform-controlled manual/);
  for (const label of [
    'on-demand payouts',
    'payout-schedule editing',
    'instant payouts',
  ])
    assert.ok(
      problems.some((problem) => problem.includes(label)),
      `missing: ${label}`,
    );
});

test('live mode is reported as a problem', () => {
  const summary = summarisePayoutControls(
    { ...compliantAccount, livemode: true },
    null,
  );
  assert.match(assessPolicyCompatibility(summary).problems[0], /live mode/i);
});

test('an unreadable feature is reported as unknown, never as disabled', () => {
  const summary = summarisePayoutControls(compliantAccount, null);
  const { problems, unknown } = assessPolicyCompatibility(summary);
  assert.deepEqual(problems, []);
  assert.deepEqual(unknown, [
    'manualPayoutsFeature',
    'editPayoutScheduleFeature',
    'instantPayoutsFeature',
  ]);
  for (const field of unknown) assert.equal(summary[field], null);
});

test('the summary carries no credential, bank or personal field', () => {
  const summary = summarisePayoutControls(
    {
      ...compliantAccount,
      email: 'person@example.invalid',
      individual: { phone: '+61400000000', id_number: '123' },
      external_accounts: {
        data: [{ last4: '4321', routing_number: '110000' }],
      },
      business_profile: { name: 'Example' },
    },
    null,
  );
  const serialised = JSON.stringify(summary);
  for (const secret of [
    'person@example.invalid',
    '+61400000000',
    '4321',
    '110000',
    '123',
    'sk_test',
  ])
    assert.equal(
      serialised.includes(secret),
      false,
      `summary leaked: ${secret}`,
    );
  assert.deepEqual(Object.keys(summary).sort(), [
    'accountId',
    'dashboardType',
    'debitNegativeBalances',
    'editPayoutScheduleFeature',
    'feesPayer',
    'instantPayoutsFeature',
    'livemode',
    'lossesPayments',
    'manualPayoutsFeature',
    'payoutsEnabled',
    'scheduleDelayDays',
    'scheduleInterval',
  ]);
});

test('CLI credential failures do not print key values or provider payloads', () => {
  const sentinel = ['sk', 'live', 'DO_NOT_LOG_THIS_FIXTURE'].join('_');
  const run = spawnSync(
    process.execPath,
    [
      'scripts/stripe/read-payout-controls.mjs',
      '--platform',
      'acct_fixture',
      '--connected',
      'acct_other',
    ],
    {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, STRIPE_SECRET_KEY: sentinel },
    },
  );
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr.includes(sentinel), false);
  assert.match(run.stderr, /must be a sandbox\/test credential/);
});
