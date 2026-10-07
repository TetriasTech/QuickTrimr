## Ticket and summary

- Backlog ID: <!-- P0-T05 -->
- Jira key: <!-- TRIMR-14 -->
- Owner: <!-- Tony or Andrew; one named owner -->

<!-- Describe the problem and resulting behavior, including the complete vertical slice. -->

Use the [review checklist](https://github.com/TetriasTech/QuickTrimr/blob/main/docs/qa/review-checklist.md) for the reasoning and required tests.
Keep applicable boxes unchecked until evidence is attached. For an inapplicable item, replace
its checkbox with `N/A — <specific reason>`; never tick an untested claim. Remove these instructions
and fill every evidence field before requesting review. Redact personal data and credentials.

## Acceptance evidence

<!-- Add one row for EVERY acceptance criterion from the backlog, including unmet criteria.
Give the exact command or test name, result, and a link to output/artifacts. "Verified" alone
is not evidence. Mark failures, skipped checks and pending live verification explicitly. -->

| Acceptance criterion | Command / test / manual steps | Result and evidence link |
| --- | --- | --- |
| <!-- criterion --> | <!-- reproducible check --> | <!-- pass/fail/pending + artifact --> |

## Review checklist

- [ ] The ticket IDs and one named owner are recorded; the slice works end to end and nothing in the ticket's **Out of scope** was built (`ADR-012`).
- [ ] Every acceptance criterion has evidence above; lint, typecheck and required tests pass. The actual running flow was exercised, with commands, results and artifacts attached.
- [ ] Migration files and new/changed tables are listed below. Every new table enables RLS; cross-user read and write denial tests cover every exposed verb at the API (`ADR-001`).
- [ ] Identity comes from the verified JWT; client-supplied identity/role/permission cannot override server-derived values. Admin role verification precedes data fetching, with direct API denial for every unpermitted role (`RULE-ADMIN-01`). Address/contact and location privacy are checked on raw responses.
- [ ] Money uses integer cents and the booking's server-side snapshot. External money calls use deterministic, server-derived idempotency keys; duplicate calls produce one effect, backed by Stripe test evidence. Failed capture remains recoverable; no database lock spans a Stripe call.
- [ ] Backend status transitions reject illegal changes and append `booking_status_history`. Sensitive actions append safe `audit_logs`; corrections append rows (`ADR-013`). Scheduled enforcement runs server-side, re-checks state and survives duplicate or dropped execution; concurrency tests use real parallel calls.
- [ ] UI changes include screenshots or a screen recording below, plus loading, error and empty-state evidence. Copy matches `RULE-COPY-01`.
- [ ] No secrets were added or logged; no server-only environment variable is referenced from `apps/`. Client environment checks pass and evidence artifacts contain no credentials, card details, raw Stripe payloads, home addresses or phone numbers.
- [ ] Shared types, validation and UI are reused; business rules remain pure in `packages/domain`, tunable values come from config, and location filtering / Google Routes and Places calls stay server-side.
- [ ] KB sync is recorded below: no contradiction or undocumented rule; changed stable IDs and affected tickets are named after checking the backlog's generated traceability table. `node scripts/jira/generate-indexes.mjs --check` passes. Generated sections 8/9 were left for the reviewed automation PR (`RULE-DEV-CI`).
- [ ] The repository code audit ran; findings, fixes and triage reasons are attached below. Every Critical is resolved and remaining gaps are named.

## Data, money and state evidence

<!-- Use N/A with a reason for each untouched area. Name tests and link captured outputs. -->

- Migration files / new or changed tables:
- RLS cross-user denial tests (read + write, every exposed verb) / raw-response privacy checks:
- Auth, role and validation rejection tests:
- Integer-cent / booking snapshot / duplicate-call tests and Stripe test evidence:
- History / append-only audit / scheduled work / concurrency evidence:

## UI evidence

<!-- Attach screenshots or a screen recording for any UI change, including loading, error
and empty states. Otherwise explain N/A. Use synthetic data or redact personal information. -->

## Quality checks and audit

<!-- Exact commands, results and output links for lint, typecheck, tests, format:check,
check:client-env and graph validation. Name the audit scope, ranked findings and their disposition. -->

## Knowledge-base sync

- Changed KB stable IDs, or `None`:
- Traceability checked; affected tickets and whether each remains correct / needs follow-up:
- Backlog changes and decisions recorded upstream before implementation:

## Remaining gaps

<!-- List failures, skipped checks, unmet criteria and decisions needed, or None.
A passing CI run does not replace human review or live acceptance evidence. -->
