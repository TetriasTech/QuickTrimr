# P2-T01 / TRIMR-44 — Available Now sessions

Owner: Andrew. Backend slice; no mobile toggle or public search route is added.

Andrew approved Option A on 2026-11-20: fractional radius 1–50 km inclusive;
`serverNow < availableUntil <= serverNow + 12 hours` on every start/update.
Recorded upstream as `RULE-AVAIL-08`, `CFG-AVAIL-SESSION-RADIUS-KM` and
`CFG-AVAIL-SESSION-MAX-HOURS`; `TBC-AVAIL-SESSION-BOUNDS` remains resolved in the KB.

## Reproduce

Use the existing QuickTrimr local stack (`pnpm db:start` if stopped), apply migrations
with `pnpm db:migrate`, and run functions with `pnpm functions:serve`. Do not reset an
existing stack or replace its imported address/SAL data. No hosted credentials are
needed: verification uses disposable local Auth logins and synthetic provider facts.

```sh
node --test packages/domain/test/availability.test.mjs supabase/functions/_shared/availability/test/handler.test.mjs
node scripts/db/verify-available-now-migration.mjs
node scripts/db/verify-available-now.mjs
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
node scripts/check-client-env.mjs
node scripts/api/contracts.mjs --check
node scripts/db/seed-data.mjs --check
node scripts/jira/generate-indexes.mjs --check
```

The migration verifier creates and drops a separate scratch database in the local
QuickTrimr Postgres container. Its 20,000 synthetic sessions never enter the user's
application database. The API verifier keeps synthetic inactive session/audit rows
and two clearly labelled synthetic polygons, then soft-deletes disposable logins.
Never run these scripts against a hosted project; their target is fixed to the local
QuickTrimr stack.

## Acceptance evidence

| # | Backlog criterion | Reproducible evidence |
|---|---|---|
| 1 | Start/update/stop | Live API verifier performs all three with real local GoTrue JWTs; exact response projection assertions. |
| 2 | One active session, concurrency/index | API: five rounds × six real parallel starts; each succeeds by replacing the prior session and leaves one active row. Migration verifier independently attempts a duplicate active row and asserts SQLSTATE `23505`. |
| 3 | Separate session/Scheduled point | API captures Scheduled centre before start/update, changes session coordinates, asserts Scheduled centre unchanged. |
| 4 | Server public-area resolution | API resolves an interior point, then a shared polygon boundary (`ST_Covers`, version/interior/code tie-break). Rejects crafted area fields and unresolved points. Synthetic polygons prove resolution, not production dataset coverage. |
| 5 | Discovery exclusions | Scratch DB candidate query rejects all five non-active statuses, an active elapsed session, and a point outside its individual radius. Legacy incomplete rows also stay excluded. |
| 6 | PostGIS index | Scratch DB natural `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on 20,000 sessions; asserts `available_now_location_gist`, no session/profile/Connect sequential scan. No planner forcing. |
| 7 | Config bounds, field errors | Pure unit tests and 30 exact SQL/domain parity cases cover radius endpoints/adjacent fractions, past/equal-now/+1 ms, exactly 12 hours/+1 ms. API changes both stored configs and observes new field errors, then restores launch values. |
| 8 | Onboarding gate | API rejects absent Connect state and independent charges/payouts failures. Uses synthetic local facts, makes no external Stripe calls. |
| 9 | Restrictions and stop | API runs every level with absent, active and elapsed cooldown; start/update denied when required, stop allowed, deadline unchanged. Three parent-lock races prove committed suspension wins against queued activation; an end time expiring while queued is rejected after the wait. |
| 10 | Shared eligibility | Activation and candidate SQL use `private.barber_booking_eligibility`; 20 SQL/domain parity cases cover all levels and before/at/after deadlines. P2-T04/P2-T08/P2-T12 must reuse this helper when delivered. |
| 11 | Cross-user denial | API: B/client raw reads of A's row return `[]`, B update/stop return 404, direct table writes and authenticated RPC calls are denied. Anonymous/client/admin/unprofiled roles cannot use the functions. |

Captured outputs: [API](evidence/P2-T01-api.json), [migration and spatial plan](evidence/P2-T01-migration.json),
[453 repository tests](evidence/P2-T01-tests.txt), [lint](evidence/P2-T01-lint.txt),
[typecheck](evidence/P2-T01-types.txt), [format](evidence/P2-T01-format.txt).
The backend end-to-end evidence is the running Auth → Edge Function → PostgREST →
Postgres flow, not a simulator. The UI belongs to P2-T02.

## Contract and concurrency handoff

- The verified JWT determines identity; stored role and profile parent lock are checked again in the service-only RPC. Direct runtime table writes are revoked.
- Starts atomically close prior active sessions as `cancelled`; the partial unique index remains the final guard. Stop is idempotent for `manually_disabled`; other non-active transitions reject. Updates cannot resurrect elapsed or terminal sessions. Stopping does not cancel a booking.
- Future reliability writers and request/acceptance mutations must acquire the profile parent before reliability/session child rows. Reads never reset a cooldown; P3-T12 owns offence production/recovery. Do not add a child-first trigger that reverses this lock order.
- Pure policies live in `packages/domain`. Atomic SQL enforcement mirrors them with exact parity checks; no network or lock crosses an external call. SQL mirrors exist because database eligibility and deadline checks must remain inside the activation transaction.
- `private.available_now_candidates(point, serverNow, afterUuid, limit)` is an internal bounded candidate stream: IDs, public-area reference and demotion flag only. It is not P2-T04's final ranking or pagination contract. Its 100-row transport ceiling is not a client search setting. Pass a single sampled server instant so PostgreSQL can inline the SQL query; do not call a volatile clock once per row.
- P2-T02 must obtain current session bounds from the server config, rather than copying launch defaults into controls. P2-T03 owns state expiry/auto-disable; candidates already exclude elapsed rows without waiting for that worker. P2-T04 owns client discovery/ranking; P2-T08 and P2-T12 own request/acceptance integration. RULE-AVAIL-05 remains an acceptance invariant; this slice does not guess a booking-status set.
- Legacy foundation sessions retain their original data with nullable new fields; incomplete rows are not discoverable. New RPC writes are complete. No guessed backfill or mutable financial/audit history is introduced.
- Public areas are resolved from session points, independently of Scheduled centres. Responses and audits omit exact coordinates. Private configuration is readable only through narrowly scoped server functions, not direct client access.

## Drift and traceability

Case A: the old ticket offered replace-or-reject despite RULE-AVAIL-01 already
requiring replacement; the old shared contract advertised `session_already_active`.
Both now describe atomic replacement. The old AC demanded integration in future
entry points; it now checks this slice and explicitly hands those integrations to
its existing affected tickets.

Case C/D: missing session bounds were raised as TBC and Andrew's answer was recorded
in the KB before implementation. Generated backlog sections 8/9 were not edited.
Affected tickets checked: P2-T02, P2-T03, P2-T04, P2-T08, P2-T12 and P3-T12 remain
correct; their responsibilities are listed above. No future slice was implemented.
Jira projection updated only TRIMR-44 (other 14 Phase 2 tickets unchanged).

## Audit

Scope: P2-T01 migration, existing RLS/grants, shared controller and three wrappers,
shared contracts, pure domain policies, live/scratch verification and documentation;
reviewed against QUICKTRIMR_AUDIT_PROMPT.md A–F.

- **Major / cost — fixed:** an unparameterized security-barrier Connect view caused whole-market profile/Connect scans before joining nearby sessions. A bounded lateral lookup now follows spatial filtering; the plan test rejects those sequential scans.
- **Major / verification — fixed:** the scratch PostGIS schema was created under a different owner than the actual local stack, preventing the migration role from granting service access. The verifier now aligns ownership with the observed local `postgres` owner; the migration explicitly grants service-role usage, and fresh replay exercises the helper as that role without direct config access.
- **Verification improvement:** fully qualified invoker SQL helpers can inline, exposing the actual spatial plan and sharing reliability logic without an opaque function call per row. Security-definer boundaries retain empty search paths.

Final verdict: no unresolved Critical, Major or Minor findings. Money movement,
booking status history and UI evidence are N/A: this slice changes sessions only,
writes safe append-only audit rows and makes no external payment call. No remaining
implementation gaps in this ticket; merge and Jira closeout remain with Andrew.
