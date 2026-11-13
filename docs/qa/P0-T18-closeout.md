# P0-T18 / TRIMR-27 — closeout continuation, 2026-10-20

## TICKET / OWNER / READY

P0-T18 — Provision Stripe test mode and Connect. Owner: Tony. Type: Task.
Both prerequisite Jira issues (TRIMR-6 / P0-D05 and TRIMR-12 / P0-T03) read Done; the
graph check reports 108 tickets, 173 defined KB IDs and zero open TBCs. Ready to continue
the existing sandbox slice, **not complete**. Google remains deferred to P0-T20 / TRIMR-29.

## UNDERSTOOD

Andrew requested completion of the remaining criteria on PR #34 before human review, merge
and moving TRIMR-27 to Done. Do not weaken provider evidence or substitute authorization
decline for capture failure. No live mode, bank/credential change or production feature is
authorized merely by this closeout request.

## DONE

- Diagnosed the failed Docs job: the new header-reading helper imported `yaml`, but the job
  deliberately runs without installing dependencies. Removed that import and read only the
  existing flat header fields needed by the specification guards. No workflow permissions,
  dependency installation, required checks or generated documentation were changed.
- Added **Docs decision checks keep a dependency-free runtime import surface**. Tested all
  85 decision checks in the working repo and a temporary exported source snapshot without
  `node_modules`; both passed. This is not a claim of GitHub CI success until the new commit runs.
- Read-only sandbox preflight matched the expected account, Express Dashboard, application
  fee/negative-balance responsibility, active merchant card payments/recipient transfers and
  saved manual payout schedule. No profile, bank field, credential or full payload printed.
- Refreshed public Stripe docs through official CLI 1.54.0. Express docs describe bank changes
  and feature controls, while the Instant Payout eligibility UI is documented as private preview.
  Public documentation is not evidence that the required controls exist in this tenant.
- Exercised the documented `pm_card_chargeCustomerFail` candidate with a synthetic customer,
  manual-capture parameters and deterministic customer/attach/authorize keys. **Authorization
  declined**, zero captured; capture was never attempted. This is **not** the required fixture.
  A direct retrieval established the tagged intent; a later bounded search found exactly one
  after the initial search-index lag. Repeating the identical authorization with the same key
  returned that same declined intent; reconciliation still found one case and zero captured.
  No speculative payment-method fixture name or card number was submitted to the payment API.
- The existing Express test session expired when opening Settings. Kept the sign-in page for
  Andrew and requested test-only sign-in; no real verification or phone/bank change performed.
- Asked whether Stripe Support may receive a generic technical question about a supported
  capture-failure fixture and durable Express Instant Payout prevention. **No support message
  has been sent**; no keys, payloads, profiles or bank data would be included.

## EVIDENCE

- Original failed job: [Docs validation](https://github.com/TetriasTech/QuickTrimr/actions/runs/39398185804/job/118546023061),
  `ERR_MODULE_NOT_FOUND: yaml` before tests. The local/fresh-snapshot fix specifically addresses
  this failure, rather than bypassing or deleting the check.
- [Candidate provider evidence](evidence/P0-T18-capture-failure-candidate.json):
  `pi_3USZLaJHIzfhdSDq1KjePYHR`, `requires_payment_method`, `card_declined`,
  `amount_received: 0`, charge `captured: false`. Initial metadata search returned zero; later
  search returned one with no pagination. No repeated create was inferred safe from a zero search.
- Reproduction: reuse the guarded sandbox client and `manualCaptureFixture`; create/reuse the
  tagged synthetic customer, attach the documented named method and create a manual-capture
  PaymentIntent with the recorded deterministic key base/suffixes. Read the exact existing
  intent before any retry. Do not rerun after provider idempotency retention expires without
  reconciling existing objects. Do not interpret this authorization decline as capture failure.
- [Existing full criterion mapping](P0-T18.md) and [approved Google split](P0-T18-google-deferral.md)
  remain authoritative for previous evidence. No new bank payout was initiated in this continuation.

## TESTS

- `node --test scripts/decisions.test.mjs`: **85 passed**, zero failed/skipped.
- Exported tracked-source snapshot with current decision test overlaid, no `node_modules`:
  graph check **OK**, the same **85 passed**. Temporary path is an operator test artifact,
  not an input to CI or the repo.
- `pnpm test`: **295 passed** (100 workspace + 195 root Node), zero failed/skipped.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm check:client-env`, graph validation
  and `git diff --check`: **PASS**.
- These checks do not prove secure bank correction, permanent Instant opt-out or the missing
  capture-failure fixture. New GitHub results must be checked on the pushed commit.

## DRIFT

No KB or backlog change: existing business/security rules and acceptance criteria are retained.
The CI failure was an implementation defect, not a reason to change the dependency-free Docs job.
The declined fixture supplies evidence about one method, not proof no supported capture-failure
fixture exists. If Stripe cannot support an existing requirement, use the drift protocol and
obtain an upstream human decision; do not silently amend or waive the criterion.

## DECISIONS / ACTIONS NEEDED

- Andrew: reopen the synthetic account's Express preview in the customer sandbox using test-only
  sign-in, stopping if real verification is requested. Continue the approved narrow settings
  inspection; no broad profile capture or bank/phone changes.
- Await authorization to contact Stripe Support, or have Andrew obtain a documented supported
  test method and durable payout-control guidance. The current guide does not establish them.

## AUDIT

Scope: the CI helper/import guard and this continuation's documentation/evidence; repository
QUICKTRIMR_AUDIT_PROMPT.md A–F plus Stripe credential/webhook/security guidance.
No new app API, domain rule, money implementation, RLS, status, scheduler or UI code introduced.
The pure specification helper supports the repository's existing flat header contract only and
asserts on missing fields/unsupported lists. **No new findings in the CI fix.** The original
provider/security findings and adjacent Jira tooling Major retain their existing triage; none
is declared resolved by passing CI. New provider replies/controls must still be reviewed.

## NOT DONE

TRIMR-27 stays In Progress and PR #34 stays draft while secure bank correction, durable prevention
of payouts bypassing the approved run, and genuine authorization-success/capture-failure proof
are unresolved. Human PR approval and merge are later steps. Do not move the Jira ticket to Done
from this CI fix or from the rejected candidate. No Google billing or live Stripe setup performed.
