# P2-T02 / TRIMR-45 — Barber Available Now toggle

Owner: Andrew. Ready: yes. P0-T14 / TRIMR-23 and P2-T01 / TRIMR-44 were both
Done; PR #56 was merged before implementation. The ticket graph passes and no
blocking TBC is open.

## Understood and delivered

A protected barber screen starts, updates and stops the existing session model.
It reads current owner session, server time, config bounds, Connect gates and
reliability restrictions together. The native toggle reflects confirmed server
state. A denied/unavailable GPS still allows manual address selection from the
existing independently licensed G-NAF directory. No Google address result is saved.

The screen shows each existing session status and its reason, the current standing,
optional recovery timing, and human reinstatement requirements. Remaining time is
explicitly a snapshot at last refresh. There is no device timer deciding expiry or
lifting a cooldown. Server state refreshes on focus, explicit refresh and writes;
a `barber_unavailable` error refreshes restrictions without enabling the switch.

## Acceptance evidence

| # | Backlog criterion | Actual evidence |
|---|---|---|
| 1 | Toggle on/off | Native iPhone flow: real local Auth → screen → Edge → Postgres, successful manual and GPS starts, then stops. [Active screenshot](evidence/P2-T02-native-manual-on.png), [GPS AX](evidence/P2-T02-native-gps-on.txt), UI test `initial loading, real empty state, displayed runtime bounds and server-confirmed start/stop`. |
| 2 | GPS and denied-permission manual path | iPhone location permission denied; typed synthetic directory query, selected result and started a real manual session. Then granted simulated GPS, confirmed its point and started. `working-location-picker.test.tsx` covers denied/restricted/unavailable GPS, an unresolved request timing out and explicit GPS confirmation. No real personal/GPS data is used. |
| 3 | Config bounds shown before submission | UI renders the live radius range and max hours; fractional radius/end-time controls use shared pure bounds validation and backend checks. API tests read 1–50/12 from config. Native changed 1 → 2.5 km and used the native picker to change the end time; both saved. |
| 4 | Active state includes remaining/radius/source | [Active screenshot](evidence/P2-T02-native-manual-on.png), [GPS AX](evidence/P2-T02-native-gps-on.txt), UI assertion `60 minutes remaining when refreshed`, persisted radius and source. Inactive sessions do not show remaining-availability copy. |
| 5 | Distinct auto-disable reasons | Tuple-driven UI test renders `expired` as time elapsed, `auto_disabled` as consecutive missed requests and `busy` as a job accepted. Live API verifier seeds each state and reads it through the real endpoint. Producers remain P2-T03/P2-T12. |
| 6 | Every session status renders | UI iterates the shared AVAIL_STATUS tuple; presentation is an exhaustive `Record<AvailStatus,...>`. API verifier covers all six stored states, plus elapsed active rows whose effective active flag is false. |
| 7 | Onboarding gate explains disabled toggle | UI test covers incomplete Connect and disabled start; live state is based on the service-only Connect eligibility view. A non-barber cannot read the projection; the existing start/update gates remain authoritative. |
| 8 | Standing/recovery, cooldown and stale denial | API covers all five levels, optional recovery time, review/reinstatement flags and unchanged stored restrictions on reads. UI tests cover normal/cooldown/restricted-but-bookable/suspended. Native seeded a cooldown after selecting an address, attempted start, received 409, remained off and refreshed standing; then server restriction was cleared and GPS activation succeeded. [Native AX](evidence/P2-T02-native-stale-cooldown.txt). No recovery date is invented when null. |
| 9 | Loading/error states; failed start stays off | UI tests cover initial load failure + retry, pending/duplicate save, network failure retaining the draft, no optimistic enablement, and stale restriction recovery. Native stale start remained off. A successful write followed by a read failure is described as unconfirmed state, not falsely as a failed write. |

## Reproduce and captured checks

Use the fixed local QuickTrimr stack; never reset the user's imported datasets.

```sh
pnpm db:migrate
pnpm functions:serve
node scripts/db/verify-available-now-mobile-migration.mjs
node scripts/db/verify-available-now-mobile.mjs
node scripts/db/verify-barber-profile.mjs
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
node scripts/check-client-env.mjs
node scripts/api/contracts.mjs --check
node scripts/db/seed-data.mjs --check
node scripts/jira/generate-indexes.mjs --check
```

- [Migration](evidence/P2-T02-migration.json): complete replay in a scratch database, seeded upgrade preserves sessions/audits, RLS retained and both new RPCs service-only.
- [Live API](evidence/P2-T02-api.json): owner/role/query rejection, strict raw projection, real directory search, manual/keep-location variants, cross-owner denial, all reliability/session states. Three real parent-lock races verify a queued keep-location edit preserves a concurrently committed point. The geodesic assertion allows only sub-micrometre double normalization, not a stale point kilometres away.
- [Repository suite](evidence/P2-T02-tests.txt): 470 passing tests — 370 Node, 74 Jest and 26 Vitest. Includes client-account switching/cancellation, strict response validation and all existing regressions.
- [Lint](evidence/P2-T02-lint.txt), [typecheck](evidence/P2-T02-types.txt), [format](evidence/P2-T02-format.txt): pass.
- [Existing barber profile flow](evidence/P2-T02-profile-regression.txt): passes after the shared address lookup correction.
- Client environment, API projection, deterministic seed and ticket-graph checks pass.

The API verifier targets only the fixed local origin and uses disposable synthetic
Auth logins/provider facts. It soft-deletes its disposable logins, preserving audit
attribution. It makes no provider calls and resets no application data.

Native verification used iPhone 17 / iOS 26.5 / Expo Go SDK 57, local backend and
Metro port 8083. The local launcher set only the local public Supabase URL/anon key
and IPv4-first DNS so Simulator could reach the loopback listener. Existing user
env files and development servers were preserved. The native fixture helper can
prepare another synthetic account:

```js
const { availabilityMobileFixtures } = await import('../../scripts/db/availability-mobile-fixtures.mjs');
const fixture = await availabilityMobileFixtures({ native: true });
await fixture.cleanup(); // Keeps only the dedicated native login, with ordinary QA logins soft-deleted.
```

Run imports relative to this document's directory, or adapt the path from the repo
root. Native credentials stay only in `/private/tmp/quicktrimr45-native.json` with
mode 0600; never commit or print that file. The Simulator's GPS was explicitly
synthetic, its injection was cleared after testing, the QA session was stopped,
and the temporary keep-awake process was stopped. Native images/AX are synthetic
probe captures; the final tests also assert the later inactive-copy cleanup.

## Contracts, privacy and handoff

- `GET start-available-now-session` accepts no query parameters or owner ID. Auth and stored barber role precede the service-only `get_available_now_state` call. The strict response omits coordinates, full addresses, contacts and provider identities. Raw owner reads are tested, not just rendered text.
- Existing coordinate POSTs remain compatible. A manual `directoryId` is resolved on the server; it cannot be mixed with coordinates/GPS. `keepLocation: true` on update reads only the verified owner's session under the parent profile lock. It delegates to P2-T01 for all status, bounds, eligibility and audit rules.
- New recovery timing is nullable, server-owned read-side evidence. P3-T12 supplies it; reads do not calculate offences, modify standing or restart deadlines. Suspended copy promises human reinstatement, not an automatic return date. P2-T03/P2-T12 retain worker/acceptance responsibilities.
- The shared location picker is reused by Scheduled onboarding and Available Now. A 10-second foreground GPS I/O timeout releases manual entry; it does not control any booking, session, expiry or recovery deadline. Late sensor results do not mutate a session.
- Address lookup still returns at most the existing eight suggestions with the same projection. Fixed parameterized dynamic SQL uses the actual tsquery for planning, avoiding the prior generic-plan timeout on the imported G-NAF dataset. No user text is concatenated into SQL.
- Existing RLS and append-only audit protections remain. No new table, payment movement, booking-status mutation, scheduler, inbox or recovery engine was added.

## Drift and knowledge-base sync

Case A: the UI ticket lacked a current-state/config read contract and manual
selection input adapter. Its scope/examples now describe those required pieces
while retaining P2-T01's state rules. It now cites RULE-AVAIL-08 and its two existing
CFG IDs from Andrew's already-approved session limits. No KB rule or business
value changed, and no decision/TBC was silently resolved.

The shared lookup fix affects P1-T05/P1-T06 without changing either contract;
P2-T11 can reuse this screen/query. P2-T03 and P3-T12 retain their documented
producer handoffs. Generated backlog sections 8/9 were not edited or regenerated
on this feature branch. Jira projection updates only TRIMR-45 plus its two existing
caller links; other Phase 2 issues are unchanged.

## Audit

Scope: P2-T02 migration/RLS/RPCs, shared controller/contracts, mobile API/screen,
shared location picker, navigation, tests and evidence, against audit prompt A–F.

Resolved during implementation/review:

- **Major / correctness:** the keep-location adapter must lock the parent before reading its point; otherwise it can restore a stale point. The parent-first adapter and three actual queued-writer races prove the committed point is preserved.
- **Major / cost:** shared address search hit the API statement timeout because of a generic full-text plan. A fixed query with a bound tsquery now plans for its actual input. Captured EXPLAINs on approximately 16.49 million directory rows show the old ID-index path and the corrected GIN search-index path. Both manual-session and existing barber-profile live flows pass.
- **Major / UX:** a never-resolving GPS sensor call could leave manual inputs disabled. The foreground I/O deadline releases them; denied, restricted, unavailable, timeout and explicit-confirmation tests pass.
- **Minor / copy:** inactive sessions showed remaining availability. That copy is now active-only; tuple-driven UI tests assert inactive states omit it. The snapshot timestamp remains explicit.

VERDICT: 0 unresolved Critical/Major/Minor findings. Business checks reuse pure
P2-T01 domain rules and authoritative SQL. Money and booking status history are
N/A; writes delegate to the existing audited session path. Every current acceptance
criterion has evidence. Remaining work is review/merge and Jira closeout, owned
by Andrew; future workers and recovery producers are their existing tickets.
