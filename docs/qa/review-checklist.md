# QuickTrimr PR review checklist

One named owner delivers the complete slice and the other engineer reviews it (`ADR-012`).
Use this guide alongside the [PR template](../../.github/pull_request_template.md), the
[knowledge base](../../QUICKTRIMR_KNOWLEDGE_BASE.md), the authoritative
[backlog ticket](../../QUICKTRIMR_BACKLOG_README.md) and the
[ticket workflow](../../QUICKTRIMR_TICKET_PROMPT.md). The knowledge base wins a conflict.
This guide explains the existing requirements; it does not introduce product rules.

## Scope and evidence

Start with the backlog ID, Jira key and one owner, then compare the diff to the complete ticket,
including Context, dependencies and Out of scope. Trace the slice from migration and RLS through
function, UI and tests wherever those layers apply. A compiling layer is insufficient evidence
of integration (`ADR-012`).

Each acceptance criterion needs its own evidence row: exact command or named test, result and
readable output/artifact. For manual QA, record the environment, actions, expected result and
observed result so the reviewer can repeat it. Exercise the actual running flow. A checked box
or the word "verified" is not an artifact. Keep failures, skipped checks and unmet criteria visible.

Tick a box only when its evidence is attached. Replace an inapplicable checkbox with
`N/A — <specific reason>`; for example, "No migrations or table changes in this docs-only PR."
The reviewer checks that reason against the diff. N/A cannot excuse a missing test for a touched
path. Use synthetic data and redact credentials and personal information in every artifact.

## Migrations, access and privacy

- List migration paths and every new/changed table. Schema changes live in migrations; a dashboard
  edit cannot be reproduced on a clean environment.
- Check RLS is enabled on every new table (`ADR-001`). Name cross-user denial tests for **read
  and write, every exposed verb, at the API**. Use distinct users, attempt another user's records
  and inspect the raw response and persisted data. A hidden UI control proves no denial.
- Call Edge Functions with missing/invalid authentication, unpermitted roles and malformed input;
  assert validation rejection includes field-level errors. Identity must come from the verified
  JWT; role and permission decisions must not trust client-supplied values.
- For admin work, prove each unpermitted role is denied by calling the endpoint directly and
  check that no admin data is fetched before server-side role verification (`RULE-ADMIN-01`).
- Assert raw response fields, rather than screen visibility. A barber may receive a client's
  address/contact only for an accepted, active booking (`ROLE-BARBER`); pending, declined,
  cancelled and completed responses must omit them. Selecting fewer columns on the client
  cannot enforce column-level privacy.
- Check discovery location precision against `RULE-DISCOVERY-05`, and PostGIS filtering / bounded
  database work against `ADR-008`. If the query changed, inspect its plan and index usage.

These checks cover the API an attacker can call and the data a device can inspect; reviewing
screens alone cannot establish access control.

## Money and external effects

- Trace integer cents from the booking's server-side snapshot to the external call (`ADR-009`,
  `RULE-SERVICE-04`). Reject client-supplied amounts and prove a later price/config change does
  not rewrite an existing booking's snapshot.
- Inspect deterministic, server-derived idempotency keys. Duplicate capture/refund/payout calls
  must produce one effect; for Stripe calls, attach redacted **Stripe test-mode evidence** for
  that effect as well as the test output (`RULE-PAY-04`, `RULE-EARN-06`). A mock call count alone
  cannot prove Stripe idempotency.
- Exercise capture failure: the booking remains `accepted_pending_payment` and can recover
  (`RULE-PAY-05`). Stripe API responses and verified webhooks establish payment success
  (`RULE-PAY-06`); a mobile success report cannot establish it.
- For webhooks, test invalid signature rejection and duplicate delivery with exactly one effect
  (`RULE-PAY-07`). Check transaction boundaries: no database lock spans a Stripe/network call
  (`RULE-PAY-09`).
- Check cancellation/refund maths against the worked examples at and either side of
  `CFG-LATE-CANCEL-WINDOW-HOURS`, including the `RULE-CANCEL-07` exception. Earning release needs
  an eligible server-verified outcome (`RULE-EARN-02`); an open dispute holds the earning at
  `pending` (`RULE-EARN-03`). A pending/failed cancellation refund cannot release the
  inconvenience earning, and a cancelled booking must not be falsely completed to release it.

Financial evidence must show what was persisted and what Stripe did, including duplicate and
failure paths. Retried requests are ordinary operation and must never multiply a charge or payout.

## State, time and audit history

- Reject illegal status transitions server-side and assert an append-only
  `booking_status_history` row for each legal transition (`ADR-010`). The frontend cannot set
  the status. Sensitive actions append `audit_logs` with the actor, role, entity, before/after
  state, required reason, timestamp and safe metadata (`ADR-013`). A correction is a new row;
  test that audit/history/reliability events cannot be updated or deleted.
- Scheduled enforcement runs on the server (`ADR-011`). A display countdown cannot enforce
  expiry or release. Test due execution, stale-state no-op, duplicate execution and reconciliation
  after a dropped schedule; execution re-checks current database state.
- Concurrency tests use **real parallel calls, repeated runs and exactly one winner**. Sequential
  accepts cannot prove the first-acceptance or one-active-job rules (`RULE-REQUEST-05`,
  `RULE-AVAIL-05`). Check database constraints / conditional updates as well as output.

History is how the team reconstructs a disputed payment later. Time and concurrency checks must
continue working when the phone is backgrounded, offline or uninstalled.

For the relevant marketplace slices, also check the knowledge base's mandatory QA cases:

- One client cannot hold two active pending Available Now requests (`RULE-AVAIL-04`).
- Expiry is tested at and either side of `CFG-AVAIL-EXPIRY-MIN` and `CFG-SCHED-EXPIRY-HOURS`;
  expired, declined and cancelled requests cannot be accepted.
- Completion covers client confirmation and both auto-completion paths (`RULE-COMPLETE-02`,
  `RULE-COMPLETE-03`, `RULE-COMPLETE-04`).
- Reliability tests cover escalation and reset (`RULE-RELY-02`).

Manual QA exercises the touched flow: client/barber onboarding, Stripe Connect, Available Now,
Scheduled, cancellation, payment, completion, disputes and admin resolution/refund, ETA or reviews.
The ticket's Tests section and these applicable cases are a floor; add boundary and denial tests
for the actual paths changed.

## UI and truthful copy

Attach screenshots or a screen recording for every UI change, including loading, error and
empty states. Record the device/browser and steps; show the expected next action in an empty
state and recovery from errors. Inspect the running flow, not just an isolated component.
Reuse shared primitives and check accessibility where the existing surface supports it.

Apply `RULE-COPY-01` to screens, notifications and marketing copy: an authorised hold is not a
charge, a QuickTrimr balance is not money already in the bank, and ETA does not imply live
tracking (`ADR-004`, `RULE-EARN-04`). The words are promises to the customer and must match the
actual state and behavior.

## Secrets, architecture and cost

Run the repository's existing quality commands and link results:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm check:client-env
node scripts/jira/generate-indexes.mjs --check
```

Review the diff and artifacts for secrets, card details, raw Stripe payloads, home addresses
and phone numbers. No server-only environment variable is referenced from `apps/`; use the
[environment contract](../architecture/environment-variables.md) and existing client guard.
Passing a static guard does not authorize logging a secret or publishing one in an artifact.

Check shared types, enums, validation and UI are reused. Business rules belong in
`packages/domain`, pure and without I/O (`ADR-002`); Edge Functions authenticate, validate and
delegate. Tunables come from the relevant `CFG-*`, with boundary tests, rather than literals.
Google Routes and Places run server-side and the server key cannot enter the mobile bundle.
Look for N+1 queries, unbounded fetching, repeated external calls, missing indexes, unthrottled
Routes/Places refreshes, dead code and copied schemas/components. These are part of the
[repository audit](../../QUICKTRIMR_AUDIT_PROMPT.md), not optional cleanup after the feature ships.

## Knowledge-base sync and review outcome

Confirm the diff neither contradicts a rule nor encodes an undocumented product decision.
Record changed stable IDs or `None`. For changed rules, check the backlog's generated
traceability table, name every affected ticket and say whether each remains correct or needs
follow-up. Record confirmed decisions upstream first, then amend the ticket, then implement.
An unresolved decision requires the ticket workflow's stop, not an assumed value.

Run the graph check above. Leave generated backlog sections 8/9 for CI's reviewed automation PR
from `main` (`RULE-DEV-CI`); do not regenerate them on a feature branch. The ticket prompt's
generic regeneration instruction is constrained by this rule and `AGENTS.md`.

Run `$audit-quicktrimr-code` on the delivered slice. Attach the scope, ranked findings, fixes and
triage reasons. Every Critical must be resolved before Done; every remaining finding must be
resolved or triaged with a reason. The audit is advisory and cannot make product decisions.
The human reviewer assesses the evidence and gaps across the whole slice. Passing CI does not
replace live verification or the approving human review required by `RULE-DEV-CI`.

## Template activation check

The single default template lives at `.github/pull_request_template.md`. GitHub makes it available
after it is merged into the repository's default branch:
[GitHub's template documentation](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository).

After merge, use a branch with a real subsequent change to open GitHub's **new PR form** against
`main`. Do not supply a body or a `template` query parameter. Confirm the ticket fields,
acceptance-evidence table, unchecked review boxes and working review-guide link are inserted
automatically. Record the branch/base and a redacted screenshot or observed form contents in
the ticket's QA evidence. Inspecting the form is sufficient; do not submit a throwaway PR.
Local tests establish discoverability and link integrity; they do not emulate GitHub's UI.
