# Stripe development setup — P0-T18

Status: **approved design; provider verification incomplete**. The source of truth is
`RULE-PAY-12`, not this implementation note. Andrew approved sandbox implementation only;
live activation and customer confirmation remain `P6-T11`.

## Account and responsibilities

Use the customer-owned **Quick Trimr sandbox**, account `acct_1UORkfJHIzfhdSDq`, with
`livemode: false`. Do not substitute the parent live account or its shared test-mode view.
Preserve the sandbox's two existing sample connected accounts.

The approved design uses Express Dashboard access, Stripe-hosted onboarding and separate
charges and transfers. QuickTrimr pays processing fees and standard Connect/payout fees and
accepts responsibility for unrecovered connected-account negative balances. With indirect
charges, refunds and disputes also affect the platform balance; a barber already receiving a
bank payout does not eliminate QuickTrimr's exposure. See
[Stripe's responsibility model](https://docs.stripe.com/connect/risk-management).

Record and verify the actual account configuration dimensions, capabilities, fee/loss
responsibilities and payout settings. An Express label alone does not prove these controls.
Current Accounts v2 distinguishes merchant and recipient configurations; do not silently
replace `RULE-ONBOARD-04`'s charges-enabled **and** payouts-enabled eligibility gate with a
recipient-only transfer check. The mapping must preserve both gates; the new fixture's
active-state observations below now demonstrate the mapping in this sandbox.

Read-only API inspection of the existing Express fixture `acct_1UORmaJHIzOcnsQ5` confirmed
v2 access and the approved dimensions: Express Dashboard, `fees_collector: application`,
`losses_collector: application`, `requirements_collector: stripe`. Its applied configurations
are customer/merchant, not recipient. The following paired observations are evidence of the
current restricted account, not a complete active-state compatibility test:

| Existing eligibility requirement | Observed v2 field / state | Observed v1 projection |
|---|---|---|
| Charges enabled | `configuration.merchant.capabilities.card_payments.status`: `restricted` | `charges_enabled: false` |
| Payouts enabled | `configuration.merchant.capabilities.stripe_balance.payouts.status`: `restricted` | `payouts_enabled: false` |

Both restrictions cite past-due requirements. Balance Settings reports payouts disabled,
default schedule `daily` and settlement `delay_days: 2`. The fixture was not changed. Its
default daily schedule is not proof of the approved weekly/platform-controlled policy; a new
verified fixture must demonstrate the manual bank-payout controls before AC2 is met. For a
recipient configuration, transfer capability and recipient payout capability require their
own checks; transfer readiness must not substitute for the two existing eligibility gates.

The first sandbox creation attempt was rejected because the platform's refunds/chargebacks
liability acknowledgement was incomplete. After reviewing the actual dialog and disclosed
Radar Pro rates, Andrew explicitly authorized **Acknowledge** on 2026-10-15. The decision was
recorded upstream as `RULE-OPS-STRIPE-SANDBOX-ACK` before submission; `TBC-STRIPE-RADAR-PLAN`
is resolved in place. Stripe now displays **Completed October 14, 2026** (provider UTC date).
See [the saved acknowledgement](../qa/evidence/P0-T18-sandbox-acknowledged.jpg). Its disclosed
A$0.13 per screened transaction and A$7 per connected account are provider observations, not
QuickTrimr config values or proof of sandbox billing. No live agreement or plan was accepted.

Created synthetic fixture **`acct_1UQZXTJHIzBQ6oGf`**, labelled **QuickTrimr P0-T18 sandbox
verification**, through Accounts v2. A duplicate deterministic create returned the same ID.
Read-back confirms AU/AUD, Express Dashboard, application fee/loss collection, Stripe requirement
collection, and both merchant/recipient configurations. Set manual payouts with a deterministic
key, repeated the update and retrieved the saved schedule. The API read-back shows `manual`;
settlement delay is two days. The retained [account overview](../qa/evidence/P0-T18-connect-manual-payouts.jpg)
shows the initial restricted account, not the manual schedule setting. The original two sample
accounts remain unchanged.

Initially, all four relevant v2 capabilities were `restricted` with `requirements_past_due`: merchant
card payments, merchant bank payouts, recipient transfers and recipient bank payouts. The v1
projection was `charges_enabled: false`, `payouts_enabled: false`, with no external account.
This initial observation proves restricted-state compatibility, not active eligibility.

Validated the official verification helper for Accounts v2, AU platform/account, Express,
full service agreement, individual synthetic fixture, card payments and transfers. No business
structure or requirements-update program applies. Website/MCC supplemental endpoints returned
empty maps successfully. The individual fixture is not a declaration about Joel's legal entity.
The account's actual current requirements still govern. Andrew subsequently confirmed that
the manually completed onboarding used test personal/bank data only; no profile values are
retained as evidence.

A single-use v2 account link successfully opened Stripe-hosted **test** onboarding with the
configured local return/refresh URLs. The flow displays a separate connected-account terms
notice before **Use test phone number**. Andrew explicitly approved this distinct synthetic
flow; recorded `RULE-OPS-STRIPE-TEST-ONBOARDING` before proceeding. Resumed on 2026-10-16
Australia/Sydney with a fresh link and temporary listener. The AU test-phone button supplied
an incomplete value that Stripe rejected. Tried the documented test token and Stripe's own
test-phone button with the phone-only US calling code; the hosted signup still did not advance.
The account's legal country remained AU. The agent submitted only provider test fixtures.
Requested a manual attempt using test data only. The original stalled-flow capture is kept
local and excluded from version control because it contains a test phone field. Do not infer
a provider root cause from the stalled UI.
At that point read-back still had `details_submitted: false` and the original requirements.
Andrew then completed the test-only flow manually. Subsequent API read-back shows
`details_submitted: true`, no currently-due requirements, `charges_enabled: true` and
`payouts_enabled: true`. All four v2 capabilities are **active**: merchant card payments,
merchant bank payouts, recipient transfers and recipient bank payouts. Express access,
application fee/loss responsibility, Stripe requirement collection and manual payouts remain
saved; bank payouts are enabled. The default AU/AUD external account is **STRIPE TEST BANK**.
The Dashboard independently shows active payments, transfers and payouts. Access-bearing links,
profile values and bank numbers are not retained in repository evidence.

Fresh hosted onboarding returned through the provider's **Return to Quick Trimr sandbox**
button to the configured `/connect/return`. Reusing the actual single-use link redirected to
`/connect/refresh`. The loopback probe recorded **one return and one refresh**, with truthful
copy that a callback alone does not verify onboarding. See the
[return](../qa/evidence/P0-T18-hosted-return-callback.jpg) and
[refresh](../qa/evidence/P0-T18-hosted-refresh-callback.jpg) captures. Production authenticated
link regeneration remains P1-T07; the diagnostic refresh route only records the redirect.

### Verification requirements checked

Queried Accounts **v2**, platform **AU**, account **AU**, **Express** Dashboard, **full** service
agreement, **individual** synthetic fixture, **card payments and transfers**. No business
structure or requirements-update program applies. See
[the exact validated setup](https://docs.stripe.com/connect/required-verification-information?accountSetupKeys=account-setup-A&account-setup-A%5BapiVersion%5D=v2&account-setup-A%5BplatformCountry%5D=AU&account-setup-A%5BaccountCountry%5D=AU&account-setup-A%5BdashboardType%5D=express&account-setup-A%5BtosType%5D=full&account-setup-A%5BlegalEntityType%5D=individual&account-setup-A%5Bcapabilities%5D=card_payments%2Ctransfers).
Helper validation/build errors were empty. Website and MCC supplemental tables were empty,
not failed requests. No requirement was omitted for lacking a v2 field mapping or row family.
The helper returned no verification guidance in `extras`; blank verification cells below are
intentional. Actual account requirements must still be re-read after every onboarding step.

Account — requirements at initial fixture creation, before completed onboarding:

| | Requirement | Verification | Enforcement action |
|---|---|---|---|
| Website | `defaults.profile.business_url` | | Capability/payments/payouts paused immediately if not provided. |
| Category | `configuration.merchant.mcc` | | Capability/payments paused immediately if not provided. |
| Agreement | `identity.attestations.terms_of_service.account.ip`, `identity.attestations.terms_of_service.account.date` | | Capability/payments paused immediately if not provided. |
| External account | `external_account` | | Capability/payouts paused immediately if not provided. |

Individual — requirements at initial fixture creation, before completed onboarding:

| | Requirement | Verification | Enforcement action |
|---|---|---|---|
| Name | `identity.individual.given_name`, `identity.individual.surname` | | Capability/payments/payouts paused immediately if not provided. |
| Date of birth | `identity.individual.date_of_birth.day`, `identity.individual.date_of_birth.month`, `identity.individual.date_of_birth.year` | | Capability/payments/payouts paused immediately if not provided. |
| Address | `identity.individual.address.line1`, `identity.individual.address.postal_code`, `identity.individual.address.city`, `identity.individual.address.state` | | Capability/payments/payouts paused immediately if not provided. |
| Email | `identity.individual.email` | | Capability/payments paused immediately if not provided. |
| Phone | `identity.individual.phone` | | Capability/payments paused immediately if not provided. |

Eventually due: none in this helper response. These tables describe the queried test setup,
not a guarantee that Stripe will never request additional verification. The actual new account
initially had the corresponding past-due restrictions; its current due list is empty.
Synthetic fixture values must come from
[Stripe's test guide](https://docs.stripe.com/connect/testing), never a real person's details.

## Funds flow and policy boundaries

1. Authorize on the platform at request creation; capture on acceptance (`ADR-006`).
2. Compute barber entitlement and QuickTrimr commission from the approved booking snapshots.
   Separate charges/transfers do not use `application_fee_amount`; do not deduct an estimated
   processing fee from barber entitlement.
3. Transfer only eligible, settled earnings under `RULE-EARN-02`–`RULE-EARN-07`.
4. Request the separate bank payout through the approved Monday 10:00 Australia/Sydney run.
   Transfer success is not bank-payment success. Reconcile their provider IDs independently.

The platform must control bank payouts without independent automatic, on-demand or instant
controls bypassing this policy. Confirm this against the actual Dashboard and API, including
reused accounts. Do not change the weekly schedule, positive minimum, strict cutoff or
eligibility rules to accommodate a default provider setting.

Unknown outcomes must be reconciled before retrying money movement. This ticket
does not implement a production payout worker, recovery policy or automatic barber debit.

### Observed payout controls and minimum boundary

Saved sandbox Settings → Connect → Express Dashboard → Features show **Manual payouts: Off**
and **Edit payout schedule: Off** during targeted inspection. They were already off and were not
changed. The retained [Features navigation image](../qa/evidence/P0-T18-express-payout-controls.jpg)
shows only top payment controls, not those payout switches; it does not prove their state.
The account's API schedule
remains manual, payouts enabled, settlement delay two days. Settings → Connect → Payouts →
Instant Payouts shows **A$0/day**. This current aggregate limit is **not proof of a durable
Instant Payouts opt-out**; no such off switch was observed. See the
[current limit](../qa/evidence/P0-T18-instant-payout-limit.jpg).

Andrew opened the actual Express preview manually and approved read-only inspection of the
test payout/bank settings without printing/saving field values or changing data. Broad page
capture remained blocked; targeted locators inspected the actual embedded Stripe frames.
Settings shows Professional details, Personal details and Payout details, but no bank-change
or correction control was found. Balance/settings exposed no payout-initiation, withdrawal,
Instant or schedule-edit action buttons in the inspected surfaces. These observations are not
a durable Instant opt-out or verified correction flow. No credentials/bank values changed,
and no profile/bank values or detail screenshots were saved from the follow-up.

The provider documents an AUD payout minimum of **A$0.01**, AU settlement timing of **two
business days**, and a **90-day** manual holding maximum for Australia. See
[payout constraints](https://docs.stripe.com/payouts) and
[manual holding limits](https://docs.stripe.com/connect/manual-payouts). These are provider
constraints, not permission to alter the Monday run or strict earning cutoff.

The positive minimum boundary from `CFG-PAYOUT-MIN-CENTS` was exercised with one AUD cent:

- Platform-to-connected transfer: `tr_1UQzB5JHIzfhdSDqQmoE55ub`.
- Separate connected-account standard bank payout: `po_1UQzB8JHIzBQ6oGfGkC116A1`,
  `automatic: false`, final status **paid**, no failure code.
- Each duplicate create reused its own deterministic platform/account/case/operation key and
  returned the same provider ID. Bounded reconciliation found exactly one matching transfer
  and one matching payout, with neither list truncated.
- Payout balance transaction `txn_1UQzB8JHIzBQ6oGf9rqTuJBD`: amount **-1**, fee **0**, net
  **-1** AUD cents. No additional deduction from the one-cent barber-side amount was observed.
- The platform Dashboard independently shows one A$0.01 transfer creation event and matching
  metadata in [the transfer capture](../qa/evidence/P0-T18-one-cent-transfer.jpg). The global
  payout-search jump used platform context and returned no such payout; this is not evidence
  of provider payout failure. The connected-context API retrieval establishes `paid`.
- The actual Express Balance transaction table independently shows one **Paid** payout,
  amount **-$0.01**, fee **$0.00**, net **-$0.01 AUD**, alongside one incoming payment. Its
  three rows include the header. The payout row has no button/link or detail dialog, so no
  exact-ID payout detail view is claimed. This corroborates the paid test-bank result without
  retrieving or printing profile/bank fields.

Guards checked the exact sandbox, fixture metadata, active capabilities, approved responsibility
fields, manual schedule, default AU/AUD test bank, available test balance and prior case objects
before money calls. This is a fake-bank provider-boundary test, not an earning/batch or weekly
scheduler. A zero-fee sandbox transaction does **not** prove production monthly Connect/payout
invoices; application fee collection is configured, but production tariffs/billing remain
outside what this sandbox result establishes.

## Observed authorization deadlines — sandbox card fixtures

The configured pending windows are `CFG-AVAIL-EXPIRY-MIN` and `CFG-SCHED-EXPIRY-HOURS`.
Their current longest window is two hours. Capture is on acceptance, not the appointment date;
the maximum booking horizon is not a requirement to keep an authorization open that long.

On 2026-10-15 Australia/Sydney, `verify-manual-capture.mjs` passed against the selected sandbox
using `pm_card_visa`, 4500 AUD cents, SDK 23.0.0 and API `2026-09-30.endive`. The actual
charge's `payment_method_details.card.capture_before` was `1792615864`
(`2026-10-21T20:51:04Z`), versus charge creation `1792011064`
(`2026-10-14T20:51:04Z`): **604800 seconds / seven days**. This covers both configured
pending windows; the verifier compared against their 7200-second maximum before capture.
Duplicate creation returned one PaymentIntent; duplicate capture returned one succeeded,
captured, unrefunded 4500-cent charge. IDs and selected observations are in
[the redacted provider evidence](../qa/evidence/P0-T18-stripe-sandbox.json).

This is a test-mode Visa observation, not a promise of every live issuer's authorization
lifetime, a supported-method allowlist or permission to wait seven days before acceptance.
Retain each actual authorization's deadline and recheck it in later payment integration.
Additional payment methods still require their own compatibility/deadline checks.

Additional `pm_card_mastercard` and `pm_card_amex` fixtures both authorized 4500 AUD cents
without capture and reported a seven-day window: creation `1792011996`, deadline `1792616796`.
Both cover the same 7200-second pending maximum. Duplicate create/cancel calls reused each
intent; both holds ended `canceled` with zero captured. This extends the observed brand checks,
not the approved launch method list or a promise about live issuers.

## Test-method matrix

| Case | Named method and observed result |
|---|---|
| Successful manual authorization/capture | `pm_card_visa`: `requires_capture` → `succeeded`, one charge under duplicate calls. |
| Additional authorization windows | `pm_card_mastercard`, `pm_card_amex`: seven-day windows, duplicate create/cancel IDs unchanged, both holds cancelled without capture. |
| Authentication required | `pm_card_threeDSecure2Required`: `requires_action`, zero received, duplicate creation reused the intent. Cancelled with duplicate deterministic calls after observation; final `canceled`. No challenge completion or mobile payment UI was tested. |
| Genuine capture-time failure | **Outstanding.** No documented method was established that first authorizes successfully and then genuinely fails at capture. A generic decline or decline-after-attaching is not that proof; do not substitute one or invent a method name. |

The named 3DS fixture is documented in [Stripe's testing guide](https://docs.stripe.com/testing).
The current public guide was read with official CLI 1.53.1. Its decline-after-attaching method
describes failure to charge a customer, not proof of a successful authorization followed by
capture failure. The latter remains a P0-T18 evidence gap for P3-T02/P6-T07.

## Local verification

See [the operator instructions](../../scripts/stripe/README.md). `stripe@23.0.0` is a pinned
root development dependency for these Node scripts, not a mobile/admin dependency.

- `local-probe.mjs` verifies raw-byte event signatures, rejects live events and records only
  event IDs/types. Its loopback-only, bounded, in-memory deduplication has no business effects
  and is not a durable production webhook inbox.
- The local return and refresh routes read `CFG-DEV-PROVIDER-URLS`. A callback response
  explicitly does not mean onboarding succeeded; account requirements must be rechecked.
- `verify-manual-capture.mjs` rejects live credentials, checks the explicitly selected
  Australian/AUD account before payment operations, repeats create/capture with deterministic
  keys and retrieves the resulting charge. It uses a named Stripe test method, never card
  numbers. Its fake-provider tests do not establish actual provider idempotency.

The test credential belongs in ignored `supabase/.env.local` as `STRIPE_SECRET_KEY`, loaded
explicitly by the selected Node process. The actual local listener's signing secret belongs
there as `STRIPE_WEBHOOK_SECRET`. Neither belongs in chat, CLI arguments, committed examples
or mobile/admin environments. The local probe needs no API credential.

Actual platform events were forwarded through official CLI 1.53.1 to the loopback probe.
The listener's signing secret was captured in process memory, passed directly to the probe
and never printed or saved. Three verified event IDs were matched to the 3DS test intent
using the Stripe Events API. An invalid signature returned 400 without changing the event
count. The probe and listener were stopped afterward. This does not establish connected-
account delivery, durable business processing or v2 thin-notification support in that run.

### Connected-account v2 notification verification

On 2026-10-16 Australia/Sydney, a metadata-only update on the synthetic account generated
`v2.core.account.updated`, not the classic `account.updated` snapshot. The snapshot-only probe
correctly did not establish delivery for that event. A separate, ephemeral loopback observer
used SDK `Stripe.parseEventNotification` on the raw bytes and the official CLI listener's
private, in-memory signing secret. It accepted actual signed event
`evt_test_65VaMNhmXsYZkSKtDNq16VXpi1Hx8S1jMXZ3y7UwEGe3m4`; a v2 Events API retrieval
independently matched its type, `livemode: false` and related account `acct_1UQZXTJHIzBQ6oGf`.

Three rounds of 16 simultaneous replays of those actual signed bytes returned 200/duplicate:
**one recorded notification, 48 duplicate deliveries**. An invalid signature returned **400**
without adding an entry. The observer used the existing diagnostic body/event bounds,
five-second request/header timeouts, and an OS-assigned loopback port. The original raw bytes,
signature, context and secret stayed in process memory; only selected evidence is recorded.
Listener and observer were stopped afterward. No onboarding, payment, transfer, payout or
business processing was performed by the observer; its deduplication was not durable.

Reproduction procedure: start the official CLI for `v2.core.account.updated` with account scope
`all`, forward to a temporary loopback observer, capture the signing secret privately and call
`Stripe.parseEventNotification`. Update only the fixture's `verification_webhook_case` metadata
with a deterministic account/case key. Match the received ID through `v2.core.events.retrieve`,
then replay its retained raw bytes/signature in three parallel batches and send one invalid
signature. Keep every payload/secret private and stop both processes. Reconcile the existing
metadata/event before repeating the case; a repeated idempotent update need not emit another event.

This is actual connected-account notification evidence, **not** added v2 support in the committed
snapshot probe. P1-T09 still names legacy account flags and `account.updated`; its implementation
contract needs an explicit v2 mapping before it is picked up, preserving both `RULE-ONBOARD-04`
eligibility gates. P3-T03 must extend that eventual durable handler, not reuse this diagnostic
observer as a business webhook service. Active-state capability mapping is now observed above;
the later consumer contract still needs its explicit v2 projection before implementation.

After the completed checks, a browser inspection encountered the API-keys page with the full
sandbox secret revealed, causing it to appear in tool output. No key value is retained in
these artifacts. Further use of that credential stopped; Andrew was asked to rotate it and
replace the ignored env value. Andrew subsequently explicitly instructed continued use on
2026-10-15. Sandbox verification may continue under that direction; the exposure finding and
rotation recommendation remain open. This does not authorize live use or another disclosure.

An account-summary inspection also returned a profile phone value to tool output. Andrew
subsequently confirmed test data only. The value is not repeated or retained in the repository;
no profile screenshot was saved. Future checks select only named non-sensitive controls/statuses
instead of retrieving a full profile and redacting afterward. This test-data logging violation
is recorded in the QA audit rather than treated as a real-person exposure after that confirmation.

## Evidence still required

The [QA report](../qa/P0-T18.md) tracks each acceptance criterion. Outstanding Stripe proof
includes complete payout controls and secure bank correction. Express shows the paid one-cent
payout row; an exact-ID UI detail view remains unverified. Remaining checks also include
other supported-method deadlines and a genuine capture failure. Test fee responsibility is
configured; production invoices cannot be inferred and are outside this sandbox scope.
Active capabilities, hosted callbacks and separate one-cent transfer/paid-bank-payout references
are now verified. On 2026-10-20 Andrew reported the requested credential action done; interpreted
as rotation/local replacement, with current sandbox access verified. Old-key revocation/activity
were not independently audited. Keep `P0-T18` incomplete until its remaining Stripe criteria
are demonstrated. Google billing/API/key/quota/budget verification is explicitly deferred to
P0-T20 / TRIMR-29 under `RULE-OPS-GOOGLE-DEV-DEFERRAL`; it has not been marked passed.
