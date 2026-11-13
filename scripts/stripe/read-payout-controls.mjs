// P0-T18 — read-only payout-control inspection for a connected account.
//
// RULE-EARN-07 requires platform-controlled weekly bank payouts and forbids an
// independent automatic schedule or on-demand control able to bypass that run.
// The connected account's own dashboard exposes a "Pay out funds" button, so a
// greyed-out button is not evidence either way: this reads the configuration
// that decides whether such a control can ever fire.
//
// Read-only. It retrieves the account and its Connect feature configuration and
// prints a small allowlisted set of payout fields. It creates no object, moves
// no money, changes no setting, and never prints a credential, bank value or
// personal field.
//
// Usage: STRIPE_SECRET_KEY=sk_test_... node scripts/stripe/read-payout-controls.mjs \
//          --platform acct_<platform> --connected acct_<connected>

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import Stripe from 'stripe';

const ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/;

// Bad input the caller can fix. Distinct from a provider failure so the message
// can be shown: it is built here and never contains provider data.
export class LocalInputError extends Error {}

export function parseArguments(argv) {
  const read = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const platformId = read('--platform');
  const connectedId = read('--connected');
  for (const [flag, value] of [
    ['--platform', platformId],
    ['--connected', connectedId],
  ])
    if (!ACCOUNT_ID.test(value ?? ''))
      throw new LocalInputError(
        value
          ? `${flag} must be an acct_ identifier with no extra characters (a trailing "/" or space is the usual cause). Received: ${JSON.stringify(value)}`
          : `${flag} is required and must be an explicit acct_ identifier.`,
      );
  if (platformId === connectedId)
    throw new LocalInputError(
      'The platform and connected accounts must differ.',
    );
  return { platformId, connectedId };
}

export async function sandboxClient({
  key,
  platformId,
  factory = (secret) => new Stripe(secret),
}) {
  if (typeof key !== 'string' || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key))
    throw new LocalInputError(
      'STRIPE_SECRET_KEY must be a sandbox/test credential (sk_test_ or rk_test_).',
    );
  const stripe = factory(key);
  const platform = await stripe.accounts.retrieve();
  if (platform.id !== platformId)
    throw new Error('The credential does not match the selected platform.');
  return stripe;
}

// Only payout-control fields. Never a bank value, personal detail or secret.
export function summarisePayoutControls(account, features) {
  const settings = account.settings ?? {};
  const schedule = settings.payouts?.schedule ?? {};
  const payouts = features?.payouts ?? {};
  return {
    accountId: account.id,
    livemode: account.livemode,
    dashboardType: account.controller?.stripe_dashboard?.type ?? null,
    payoutsEnabled: account.payouts_enabled === true,
    debitNegativeBalances: settings.payouts?.debit_negative_balances ?? null,
    scheduleInterval: schedule.interval ?? null,
    scheduleDelayDays: schedule.delay_days ?? null,
    feesPayer: account.controller?.fees?.payer ?? null,
    lossesPayments: account.controller?.losses?.payments ?? null,
    // The platform must own the run: an automatic interval or a connected-account
    // control able to trigger or reschedule a payout bypasses RULE-EARN-07.
    manualPayoutsFeature: payouts.manual_payouts ?? null,
    editPayoutScheduleFeature: payouts.edit_payout_schedule ?? null,
    instantPayoutsFeature: payouts.instant_payouts ?? null,
  };
}

export function assessPolicyCompatibility(summary) {
  const problems = [];
  if (summary.livemode) problems.push('Account is in live mode.');
  if (summary.scheduleInterval !== 'manual')
    problems.push(
      `Payout schedule is "${summary.scheduleInterval}"; RULE-EARN-07 needs platform-controlled manual payouts.`,
    );
  for (const [field, label] of [
    ['manualPayoutsFeature', 'on-demand payouts'],
    ['editPayoutScheduleFeature', 'payout-schedule editing'],
    ['instantPayoutsFeature', 'instant payouts'],
  ])
    if (summary[field] === true)
      problems.push(
        `Connected account retains ${label}, which can bypass the weekly run.`,
      );
  const unknown = [
    'manualPayoutsFeature',
    'editPayoutScheduleFeature',
    'instantPayoutsFeature',
  ].filter((field) => summary[field] === null);
  return { problems, unknown };
}

async function main() {
  const { platformId, connectedId } = parseArguments(process.argv.slice(2));
  const stripe = await sandboxClient({
    key: process.env.STRIPE_SECRET_KEY,
    platformId,
  });

  const account = await stripe.accounts.retrieve(connectedId);
  // The Express payout toggles (manual payouts, schedule editing, Instant) are
  // platform-wide Connect Dashboard settings, not fields on the account object,
  // so they are deliberately not read here and stay a Dashboard observation.
  const summary = summarisePayoutControls(account, null);
  const { problems, unknown } = assessPolicyCompatibility(summary);

  console.log(JSON.stringify(summary, null, 2));
  if (unknown.length)
    console.log(
      `\nNot readable from the account object: ${unknown.join(', ')}.` +
        '\nThese are platform-wide Express Dashboard settings (Connect > Settings >' +
        '\nExpress Dashboard). Confirm them there; do not assume they are disabled.',
    );
  if (problems.length) {
    console.log('\nRULE-EARN-07 compatibility: PROBLEMS FOUND');
    for (const problem of problems) console.log(`  - ${problem}`);
  } else {
    console.log(
      `\nRULE-EARN-07 compatibility: no bypass control reported${unknown.length ? ' among the exposed fields' : ''}.`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    // Local validation messages are written here and carry no provider data, so
    // showing them turns an unusable failure into an actionable one. Anything
    // else may be a provider error: report it generically, never raw.
    process.stderr.write(
      error instanceof LocalInputError
        ? `${error.message}\n`
        : 'Payout-control inspection failed. Check the selected test credential/account and inspect its Dashboard; no raw provider error is logged.\n',
    );
    process.exitCode = 1;
  });
