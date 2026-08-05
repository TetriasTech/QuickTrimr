# TRIMR — Code Audit Prompt

The bar is not "it works." The bar is: **would the brightest engineer you have ever worked with
sign their name to this?** This audit holds code, architecture, and technical decisions to that
standard, and it holds them to `TRIMR`'s non-negotiables — which are stricter than general good
taste, because this repo moves real money and sends a named stranger to a client's home address at
a stated time.

This file is the single source of truth for the audit. `/audit` (Claude) and `$audit-trimr-code`
(Codex) both defer to it, so there is one copy and it cannot drift. If you are running the audit
manually or without the skill, read this file and follow it anyway.

The audit is **advisory**: it produces ranked, evidence-backed findings. It does not silently edit
code, and a human decides what blocks. Its job is to make a problem cheap to see now, instead of
expensive to find later.

---

## 1. When this runs

1. **Manually** — `/audit`, `/audit <path>`, `/audit all`, or `/audit <ticket-id>`.
2. **Automatically as part of ticket work** — after `pick-up-trimr-ticket` delivers a slice, and
   after any code change made while working a ticket, run this audit before writing the Definition
   of Done (`TRIMR_TICKET_PROMPT.md §7`) and the completion report (`§8`). Audit findings go in the
   report's `AUDIT` section, and anything unresolved also lands in `NOT DONE` /
   `DECISIONS NEEDED`; resolve or triage each.

Running the audit does not replace `§6`'s testing mandate or the `§7` end-to-end verification. It
sits on top of them.

## 2. Scope — what to look at

Default scope is **the change**, not the world:

| Invocation | Scope |
|---|---|
| `/audit` (no arg) | Uncommitted + staged changes: `git diff HEAD` and `git status`. If clean, the diff of the current branch against `main`. |
| `/audit <path>` | That file or directory. |
| `/audit <ticket-id>` | The vertical slice delivered for that ticket (its migration, RLS, function, UI, tests). Resolve the ID against `TRIMR_BACKLOG_README.md` first, same as `pick-up-trimr-ticket`. |
| `/audit all` | Full repository sweep. Expensive — say so and confirm before a long run. |

Always read enough surrounding context to judge a finding — the diff line alone rarely tells you
whether a query is an N+1 or whether a type is already defined in a shared package. State the scope
you audited at the top of the report.

Do not report on generated sections — `TRIMR_BACKLOG_README.md §8` and `§9` are machine-written
(`CLAUDE.md`). Do not report style nits a formatter/linter already owns (Prettier, ESLint) unless
the config itself is wrong.

## 3. What to check

Findings fall into these categories. Each finding names its category so the report can group them.

### A. Non-negotiables — a violation here is Critical by default (`KB` / `CLAUDE.md`)

These are not preferences. A hit is a bug, not a suggestion.

**Access control and privacy**

- **RLS.** Every table has RLS. A new table without a policy is a defect. Denial must be proven at
  the API with a cross-user test, never assumed from the UI. (`ADR-001`, `KB §11`)
- **Never trust the client for identity, role, status, amount, or permission.** The user id comes
  from the verified JWT, never the request body. A role read from a client-settable JWT claim is a
  defect. (`KB §12`)
- **Address and contact visibility is narrow.** A barber sees a client's street address, unit and
  phone **only for an accepted, active booking** (`ROLE-BARBER`). A completed or cancelled booking
  must not return them. A pending request must not return them — a barber who declines has learned
  nothing about where the client lives. Assert on the raw response body, not the rendered screen.
- **Barber location precision** respects `RULE-DISCOVERY-05`. A search or map response more precise
  than the rule allows is a defect. If jitter is used it must be stable per barber per session —
  jitter that moves on every refetch is recoverable by averaging and is worse than none.
- **Never log a secret, a card number, a full Stripe payload, an address, or a phone number.**

**Money**

- **Money is integer cents.** No floats, no strings-as-money in arithmetic, no `numeric` money
  column. (`ADR-009`)
- **Amounts come from the booking's snapshot**, never from the request body and never from a live
  price lookup. A barber changing prices cannot alter an existing booking (`RULE-SERVICE-04`).
- **Every external money call is idempotent** on a deterministic, server-derived key. A key built
  from client input, a timestamp, or a random value is a defect. (`RULE-PAY-04`)
- **Capture happens once.** A duplicate call charges once. A duplicate payout pays once
  (`RULE-EARN-06`) — and a transfer to a bank account cannot be recalled.
- **A failed capture never leaves a booking confirmed with no money.** It stays
  `accepted_pending_payment` and is recoverable. (`RULE-PAY-05`)
- **Never hold a database lock** (transaction / `SELECT … FOR UPDATE`) **across a Stripe or other
  network call.** (`RULE-PAY-09`)
- **An earning becomes `available` only on completion**, and never while a dispute is open
  (`RULE-EARN-02`, `RULE-EARN-03`).
- **Stripe is the source of truth** — the API response and the verified webhook. A mobile client
  reporting success is not evidence. Webhook signatures verified before parsing; duplicate
  deliveries produce exactly one effect. (`RULE-PAY-06`, `RULE-PAY-07`)

**State and time**

- **Statuses are backend-controlled and written to `booking_status_history`.** A frontend that sets
  a status is a defect. Illegal transitions are rejected server-side, not merely hidden.
  (`ADR-010`)
- **No client-side timers for anything that matters.** A countdown may display; it must never
  decide. A backgrounded, offline, or uninstalled app must not be able to stop a request expiring
  or an earning releasing. (`ADR-011`)
- **Scheduled work re-checks state at execution and is idempotent.** The schedule is a hint; the
  database is the truth. A job that acts on the state it was scheduled with is a defect.

**Architecture**

- **Business rules live in `packages/domain`, pure, no I/O.** Refund maths, commission split,
  expiry arithmetic and reliability transitions all belong there. If a rule can't be unit-tested
  without a network or a database, it is in the wrong layer. (`ADR-002`, `KB §7`)
- **Location filtering is PostGIS in the database.** Fetching a set of barbers and filtering by
  distance on the device is a defect. (`ADR-008`)
- **Google Routes and Places are called server-side only.** A server API key reachable from the
  mobile bundle is a defect — anything bundled into an Expo build is extractable. (`RULE-ETA-02`)
- **Config values are read from config** (`KB §13`). A literal `5`, `12`, `20`, `60`, `2`, a
  commission percentage, a refund split, or any other tunable baked into a feature is a defect —
  cite the `CFG-*` it should read.
- **Sensitive actions write audit logs, append-only** (`ADR-013`). A correction is a new row. An
  `UPDATE` or `DELETE` path on `audit_logs`, `booking_status_history`, or
  `barber_reliability_events` is a defect.

**Truthful copy**

- **`RULE-COPY-01`.** Do not imply live tracking (`ADR-004`) — no moving barber marker, no "track
  your barber". Do not describe an authorised hold as a charge. Do not describe a TRIMR balance as
  money in a bank account (`RULE-EARN-04`). This applies to the app, notifications, and the Wix
  site, and it is a Critical because it is a written promise the system then breaks in front of a
  user who is already unhappy.

**Undecided decisions**

- **Undocumented decisions.** Code that encodes a business rule, bound, enum, percentage, or
  rounding rule with no `KB` stable ID behind it is a decision nobody made. Flag it; it should be a
  `TBC-*`, not a literal in a function. (`CLAUDE.md`)

### B. Cost — wasted API calls and database work

Every unnecessary round trip is real money at scale and latency for a real user. TRIMR has two
metered externals — Google Routes and Google Places — and a geospatial database that punishes a
missing index.

- **N+1 queries** — a query inside a loop that a join, `IN`, or batch fetch would collapse.
- **Fetching in a loop** what one call could return; **re-fetching** data already in hand this
  request; work that should be memoized/cached but isn't.
- **Over-fetching** — `select *` or hydrating columns/relations the caller never reads; unbounded
  queries with no `limit`/pagination on a table that grows (`RULE-ADMIN-04`).
- **Missing PostGIS index usage** — a distance query doing a sequential scan. Check the plan, don't
  assume the index is used.
- **Unthrottled Google Routes calls** — ETA refreshed tighter than `CFG-ETA-REFRESH-MIN`, or still
  refreshing after the booking is completed, cancelled or disputed (`RULE-ETA-04`). Each one is a
  billed call and a location read.
- **Unthrottled Places calls** — autocomplete firing per keystroke with no debounce; a map firing a
  search per frame of a pan.
- **Redundant or non-idempotent external calls** — the same Stripe/webhook/storage call issued more
  than once, or issued where a cached result would do.
- **Chatty client** — a screen that fires N requests on mount for data one endpoint could return;
  polling where a single query or a refetch-on-focus fits.

### C. Dead code

- Unused exports, functions, variables, imports, types.
- Unreachable branches; conditions that are always true/false.
- Commented-out code left in place (delete it — git remembers).
- Config, flags, or env vars declared and never read.
- Files, components, or migrations orphaned — imported/referenced nowhere.
- Mock data or fixtures still wired into a production path after the real endpoint landed.

### D. Reuse — shared components, schemas, templates (DRY)

Duplication across `mobile` / `admin` / `functions` is how three copies drift into three behaviours.

- **Types and Zod schemas** duplicated instead of imported from `packages/shared` and
  `packages/validation` — one schema, three consumers, is the whole point of `P0-T07`.
- **Status enums** re-declared as inline string literals instead of imported from
  `packages/shared` (`P0-T06`). A status string typed by hand is a status that will drift from the
  Postgres enum.
- **UI primitives** reimplemented instead of using `packages/ui` (`P0-T14`) or the shared admin
  components (`P0-T17`) — especially `StatusBadge`, `EmptyState`, `ErrorState`, `ConfirmDialog`
  and `Money`. A second money formatter is how an admin reads $4.50 as $450.
- **Business logic** copy-pasted into a component or an Edge Function instead of living once in
  `packages/domain`. Refund maths computed both in a screen and in a function is the specific case
  that makes the app promise one number and the backend issue another.
- **Migration / RLS / Edge Function patterns** hand-rolled where the repo already has prior art —
  a new table's RLS should look like the existing tables' RLS, and every function should use the
  shared auth, validation, error, logging and response helpers (`ADR-002`).
- Near-identical functions that differ only by a constant — parameterise, don't clone.

### E. Architecture & technical decisions

- **Vertical slice complete** (`ADR-012`): migration → RLS → function → UI → tests, one owner, no
  "later ticket" to defer integration into.
- **Layering.** I/O out of `packages/domain`; no business logic buried in a React Native screen or
  an Edge Function that should be a pure, tested domain rule. Edge Functions are thin controllers:
  auth, validate, delegate.
- **Concurrency design.** Acceptance (`RULE-REQUEST-05`), the one-active-job rule
  (`RULE-AVAIL-05`), capture, and payout processing are all decided under contention. A
  check-then-act without a conditional update or a constraint is a defect even if it passes a
  sequential test.
- **Idempotency keys** deterministic and server-derived (also A, but judge the design here).
- **User-facing screens have loading, error, and empty states** — not just the happy path. An empty
  state that offers no next action on a marketplace with thin supply is a real product failure, not
  a nit.
- **Error handling** — no swallowed errors, no `catch {}`, no error paths that leave money or
  status half-written. Failure is atomic or compensated.
- **Phase boundaries respected** — a Phase N ticket reaching into Phase N+1's work (the payment
  wiring that `P3-T06` owns, for instance) is a finding, and `generate-indexes.mjs --check` will
  reject the dependency that goes with it.
- **Ownership boundary** respected: money and trust is Tony's, the marketplace is Andrew's
  (`CLAUDE.md`). A slice reaching across that line without a ticket saying so is a finding.

### F. General engineering bar — the "brightest engineer" standard

- **Types.** No `any` that hides a real type; exhaustive `switch`/union handling over the status
  enums; nullability modelled, not ignored.
- **Correctness of async** — races, unawaited promises (a floating Stripe or Supabase call is a
  payment that silently never happened), missing transaction boundaries, partial writes.
- **Naming and cohesion** — a function/name that lies about what it does; a function doing five
  things; deep nesting that a guard clause fixes.
- **Tests that test behaviour**, not implementation — boundaries at the exact value, the denial
  case, the money-math case, the concurrent case with real parallelism, not just the happy path.
  Coverage of lines is not coverage of behaviour. A flaky money test is worse than no test.
- **React Native / Expo correctness** — hook dependency arrays, render loops, unnecessary
  re-renders, unvirtualised long lists, permission denial paths that leave the user stuck.
- **Next.js correctness** — server/client component boundaries; no admin data fetched before the
  role check resolves (`RULE-ADMIN-01`).
- **Security beyond the non-negotiables** — injection, missing authorization checks, unsafe
  deserialization, secrets in code or in a built mobile bundle.
- **Accessibility** on user-facing screens where the repo already cares about it.

## 4. Severity — rank every finding

- **Critical** — a non-negotiable (§3.A) is violated; money, access control, or personal data is at
  risk; a stranger's location or a client's address is exposed; data can be lost or corrupted. This
  should block a merge.
- **Major** — real cost, a real bug, or an architecture violation that will be expensive to unwind
  later (an undocumented decision, an N+1 on a hot path, duplicated refund logic, an unthrottled
  Routes call).
- **Minor** — dead code, a missed reuse, a naming/clarity issue, a cheap efficiency win.

When unsure between two levels, say why and pick the higher. Do not pad the report with Minors to
look thorough — a short, true report beats a long, hedged one.

## 5. Report format

State the scope audited, then findings ranked most-severe first. For each finding:

```
[CRITICAL] A. Non-negotiable — address exposed on a declined request
  where:  supabase/functions/list-barber-requests/index.ts:61
  what:   The inbox query selects client_addresses.line1, unit and phone for
          every pending request, not just accepted ones.
  why:    ROLE-BARBER — a barber sees address and contact only for an accepted,
          ACTIVE booking. Every barber who receives a request now learns where
          the client lives, including the ones who decline.
  fix:    Drop the address join from the pending projection; return suburb and
          distance only. Add a raw-body assertion that line1/unit/phone are
          absent for a pending request.
  effort: S
```

End with a one-line verdict:

```
VERDICT  3 findings — 1 Critical, 1 Major, 1 Minor.
         Critical blocks: client address returned on pending requests. Fix before the ticket is Done.
```

If nothing is found, say so plainly and name what you checked — "Audited the P2-T10 slice (query,
RLS, 1 screen, tests) against §3.A–F; no findings." Do not invent findings to justify the run.

## 6. What this audit does not do

- It does not edit code. It reports. (For auto-fixing quality issues, that is `/simplify`; for a
  correctness-only diff review, `/code-review`; for a security-only pass, `/security-review`. This
  audit is broader and TRIMR-aware, and it stays advisory.)
- It does not resolve a `TBC-*`, pick a config value, or make a Decision ticket's call — those are
  Tony's or Andrew's (`CLAUDE.md`). If the audit surfaces an undecided value, that is a finding and
  a `TBC-*`, not something you fill in.
- It does not touch generated backlog sections (`§8`, `§9`).
