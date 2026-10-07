# QuickTrimr Product Backlog

> **Companion file:** `QUICKTRIMR_KNOWLEDGE_BASE.md` — the product and engineering source of truth. Read it first.
>
> This file is the **source of truth for tickets**. Jira is a projection of it (§4).
>
> **To implement a ticket:** paste `QUICKTRIMR_TICKET_PROMPT.md` into a fresh agent session and name the ticket id. Do not paste the ticket body — the agent reads it from here, so there is one copy and it cannot drift.
>
> Never store Jira API tokens, Supabase service-role keys, Stripe secrets, webhook secrets, Google API keys, Expo credentials, Sentry tokens, or PostHog keys in this file or anywhere in source control.

---

## Contents

1. [Project summary](#1-project-summary)
2. [Ownership](#2-ownership)
3. [Ticket format](#3-ticket-format)
4. [Jira sync rules](#4-jira-sync-rules)
5. [Definition of ready / done](#5-definition-of-ready--done)
6. [Phase map](#6-phase-map)
7. [Backlog — Phase 0 → Phase 7](#7-backlog)
8. [Traceability: knowledge base → tickets](#8-traceability-knowledge-base--tickets)
9. [Reverse dependency index](#9-reverse-dependency-index)

---

## 1. Project Summary

**Product:** QuickTrimr — a two-sided barber marketplace, mobile-first.
**Team:** Tetrias Tech — Tony and Andrew, one monorepo.
**Quality bar:** Production-quality, with secure backend-controlled marketplace logic.

Clients request a barber to come to them, either immediately (**Available Now**) or at a future time (**Scheduled**). The barber accepts or declines. Payment is authorised at request and captured on acceptance, the barber's earning holds until completion, and money reaches their bank on a batched payout run.

Deliverables: one Expo mobile app carrying both journeys, a web-only Next.js admin dashboard, Supabase (Postgres/Auth/RLS/Storage/PostGIS/Edge Functions), Stripe Payments and Connect, Google Maps/Places/Routes, Expo push notifications, and a Wix marketing site last.

Stack, architecture, and product rules are **not** repeated here. They live in the knowledge base and tickets cite them by stable ID.

---

## 2. Ownership

Ownership is **vertical** (`ADR-012`). Each ticket has exactly one named owner who delivers it end to end — migration, RLS, function, UI, tests.

**Tony — money and trust.** Stripe payments, webhooks, capture, refunds, earnings, payout batches, cancellations, disputes, reliability, the workflow engine, schema and RLS foundations, admin dashboard, roles and access control, audit logging, CI and environments.

**Andrew — the marketplace.** Auth, profiles, addresses, client and barber onboarding, service catalogue and pricing, Available Now sessions, discovery and search, booking requests, request inbox, accept/decline surfaces, booking and job views, ETA, completion flows, reviews, notifications, analytics, mobile shell and shared UI, Wix.

There is no "Shared" owner. The previous backlog's `Owner stream: Shared` produced tickets nobody owned; foundation tickets have one owner too, they are just sequenced first.

---

## 3. Ticket Format

Every ticket has a YAML header (which maps to Jira fields) followed by a description an agent can act on cold.

### 3.1 Header fields

| Field | Meaning |
|---|---|
| `id` | Permanent. Never renumber, never reuse. |
| `title` | Becomes the Jira summary. |
| `issueType` | `Story` (user-visible feature), `Task` (technical), `Spike` (investigation), `Decision` (resolves a TBC). |
| `owner` | `Tony` or `Andrew`. Exactly one. |
| `phase` | 0–7. |
| `priority` | `Highest`, `High`, `Medium`, `Low`. |
| `jiraKey` | `null` until created in Jira, then written back (§4). |
| `dependsOn` | **Ordering.** Tickets that must close before this starts. Source of truth for sequencing. |
| `affects` | **Change impact, one-way.** "If this ticket's contract or stored shape changes, revisit these." Not derivable from `dependsOn`. Never write the reverse edge — §9 is generated. |
| `knowledgeBase` | Stable IDs from the knowledge base this ticket implements. Drives §8. |
| `blockedByTbc` | Unresolved `TBC-*` IDs. **A ticket with a non-empty `blockedByTbc` cannot start.** |
| `labels` | Jira labels. |

**`dependsOn` vs `affects`** — the distinction matters. `dependsOn` is "I cannot start until this is done." `affects` is "if I change, these break." A ticket can affect something it does not depend on. Only `dependsOn` sequences work.

**Why there is no `canRunInParallelWith`.** The previous backlog carried it on every ticket. It is fully derivable from `dependsOn`, it needed a matching edit on both sides of every edge, and it decayed into entries like "Any Phase 0 ticket" and "P6 polish tickets". Parallelism is computed from the dependency graph, not hand-maintained — see §9.

**Why there are no epics.** The previous backlog had 32 epics and three-part ids (`P2-E04-T01`). The epic layer carried no information the phase and labels did not, and the third id segment made every dependency list harder to read. There is now one Jira epic per phase (§4).

### 3.2 Body sections

| Section | Purpose |
|---|---|
| **Context** | Why this exists, what it unlocks, and the non-obvious decisions behind it. An agent reads this to understand intent, not just mechanics. |
| **Scope** | Exactly what to build: migration, RLS, functions, validation, UI. Concrete enough to act on. |
| **Contract example** | Worked request, success response, and error responses. Non-negotiable for anything with an API. |
| **Acceptance criteria** | Individually checkable. Each one is a thing someone can verify, not an aspiration. |
| **Tests** | What must have automated coverage. |
| **Out of scope** | What not to build, with the ticket that owns it instead. This is what stops scope creep. |
| **Sync notes** | What `affects` means for this ticket specifically. |

### 3.3 Ticket sizing

A ticket is one vertical slice a single person delivers in roughly 1–4 days. If it is bigger, split it.

The old backlog's `P2-E04-T01` — "validate, enforce one active job, capture payment, update status, resolve conflicting requests, disable the session, notify" — is now four tickets (`P2-T12`, `P3-T02`, `P3-T06`, `P6-T02`). It also created a silent Phase 2 → Phase 3 dependency, which is exactly what §6 exists to prevent.

---

## 4. Jira Sync Rules

**This file is the source of truth. Jira is a projection.**

1. Tickets are created in Jira **one phase at a time**, when the phase is about to start.
2. On creation, the agent writes the returned key back into this file as `jiraKey: TRIMR-123`, in the same run.
3. **`jiraKey` is the idempotency guard.** Before creating any issue, the agent checks it. A ticket with a non-null `jiraKey` is skipped — this is what stops Phase 0 being duplicated when you return for Phase 1.
4. If a Jira issue and this file disagree, **this file wins.** Correct Jira, never the reverse — with one exception: if someone deliberately changed a ticket's owner or scope *in Jira* as a real decision, bring that decision back into this file, then push. The rule exists to stop silent drift, not to overrule a person.
5. Changing a ticket after its Jira issue exists means updating both, in the same change:

   ```bash
   node scripts/jira/create-tickets.mjs --update --phase 0 --dry-run   # diff first
   node scripts/jira/create-tickets.mjs --update --phase 0
   ```

   `--update` re-pushes only tickets whose backlog entry actually changed, tracked by a content fingerprint stored on each Jira issue, so a no-op run writes nothing and Jira's history stays a record of real changes. It also backfills links that could not be made at creation time — a Phase 0 ticket's `affects` edge into Phase 1 is skipped when Phase 1 does not exist yet, and creating Phase 1 later does not go back for it.

**Both scripts refuse to run against any project key except `TRIMR`.** The stable key is pinned in `create-tickets.mjs`, checked against `JIRA_PROJECT_KEY` and again against what Jira returns. The Jira project display name is QuickTrimr. myClean (key `MC`) is a different project on the same Atlassian site and both repos export identical variable names, so a stale `source` in your shell would otherwise file QuickTrimr tickets onto the myClean board.

### 4.1 Field mapping

| Backlog | Jira |
|---|---|
| `title` | Summary |
| Body sections | Description (markdown) |
| **Acceptance criteria** | Acceptance Criteria field, or the description if the field is absent |
| `issueType` | Issue Type — `Decision` and `Spike` map down to `Task` |
| `owner` | Assignee |
| `priority` | Priority |
| `labels` + `phase` | Labels (`phase-N` added automatically) |
| `dependsOn` | "is blocked by" links |
| `affects` | "relates to" links |
| `knowledgeBase`, `blockedByTbc` | Appended to the description as a **References** block |

Epics: one Jira epic per phase, named `QuickTrimr Phase N — <phase title>`.

**`Decision` and `Spike` do not survive the projection.** The Jira project has neither issue type, so both land as `Task` carrying a `decision` label. The distinction is not lost — it lives in this file, which is authoritative. Do not "fix" this by adding issue types to Jira, and never classify a ticket from Jira's issue type.

---

## 5. Definition of Ready / Done

### Ready (from `KB §6.4`)

A ticket may not start until: it has one named owner; every `dependsOn` is closed; every `blockedByTbc` is resolved; every `knowledgeBase` ID exists as a real rule and not a reserved one; contract examples exist; and every acceptance criterion is individually checkable.

If a ticket cannot meet this, fix the ticket. Do not start it.

### Done

Beyond the ticket's own acceptance criteria:

- Lint and typecheck pass.
- Tests listed in the ticket exist and pass.
- **The feature works end to end in the running app**, not just in isolation. Vertical ownership means there is no later integration ticket to defer this into.
- Any new table has RLS enabled and a cross-user denial test.
- Any sensitive action writes an audit log.
- Any booking status change writes `booking_status_history`.
- Any money movement uses integer cents and a server-derived amount.
- Any schema change is a migration; no dashboard edits.
- User-facing screens have loading, error, and empty states.
- Shared types, schemas, and components are reused, not duplicated across mobile/admin/functions.
- No secrets committed.
- Nothing in **Out of scope** was built.
- If a knowledge base rule changed, §8 was checked and affected tickets were raised.

---

## 6. Phase Map

| Phase | Title | Gate — do not start the next phase until |
|---|---|---|
| 0 | Foundations & Decisions | Every `TBC-*` blocking Phase 1–3 is resolved; monorepo, CI, Supabase, Stripe and Google sandboxes exist. |
| 1 | Auth, Profiles, Onboarding & Services | A barber can be created, Connect-verified, priced and discoverable; a client can save an address. |
| 2 | Available Now, Discovery & Booking Requests | A client can find a barber and send a request, and exactly one acceptance can win it. No money yet. |
| 3 | Payments, Earnings, Cancellations & Payouts | An accepted request captures money, creates an earning, can be refunded, and can be batched for payout. |
| 4 | Booking Lifecycle, ETA, Completion, Disputes & Reviews | A confirmed booking can run to completion, auto-completion, or dispute. |
| 5 | Admin Dashboard | Admin can see everything and resolve disputes, refunds, payouts and reliability. |
| 6 | Notifications, Analytics, QA & Release | Both sides are told what happened, the critical paths have tests, and the thing is releasable. |
| 7 | Wix Marketing Website | — |

**Phases are gates, not walls.** A ticket may depend on a later-phase ticket only if the dependency is explicit in `dependsOn` — and `generate-indexes.mjs --check` rejects that, deliberately.

The previous backlog broke this in two places, both around payment. `P2-E04-T01` (accept) captured payment, and `P2-E04-T04` (expiry) cancelled authorisations — both reaching into Phase 3 from Phase 2. Here, `P2-T12` and `P2-T15` deliberately stop short of Stripe, and `P3-T06` wires payment into all three lifecycle points at once, so the phase order actually holds.

---

## 7. Backlog

<!-- TICKETS-START -->

## Phase 0 — Foundations & Decisions

**Goal:** everything that is true regardless of unanswered product questions, plus the decisions themselves.

**What is deliberately *not* here.** No booking logic, no pricing logic, no cancellation maths, no reliability engine. Every one of those requires answers we do not have — commission, refund split, inconvenience fee funding, reliability thresholds, payout cadence and launch categories are all unresolved (`KB §14`).

The schema *is* here (`P0-T10`), because QuickTrimr's enums and table shapes are decided (`KB §10`, `KB §11`) and both engineers are blocked without them. What is not here is seeding it with categories nobody has chosen — that is why `P0-T12` waits on `P0-D01`.

The bar for a Phase 0 ticket: **doable today without inventing an answer to a TBC, and it unblocks both engineers.**

---

### Decision tickets

These resolve the `TBC-*` register. Each one's deliverable is **an edit to the knowledge base**, not code. They are `Highest` priority because roughly half the backlog is blocked behind them.

---

#### P0-D01 — Decide launch service categories and price bounds

```yaml
id: P0-D01
title: "Decide launch service categories and price bounds"
issueType: Decision
owner: Andrew
phase: 0
priority: Highest
jiraKey: TRIMR-2
dependsOn: []
affects: [P0-T12, P1-T10, P1-T11, P1-T12, P2-T04, P2-T08, P5-T11]
knowledgeBase: [RULE-SERVICE-01, RULE-SERVICE-02, RULE-SERVICE-03, RULE-SERVICE-05]
blockedByTbc: []
labels: [quicktrimr, phase-0, decision, product]
```

**Context**

`TBC-SERVICE-CATEGORIES` blocks the catalogue, barber pricing, discovery filtering, and seed data — the spine of Phase 1 and 2. Nothing downstream can be specified until it exists.

This is a product decision, not a schema decision. Categories are admin-configurable data (`RULE-SERVICE-01`), so this ticket decides **what we launch with**, not what is possible forever. Being wrong is cheap and editable; being undecided blocks everything.

The knowledge base lists *examples* — Haircut, Skin fade, Beard trim, Haircut + beard, Kids haircut. Examples are not a decision, and an agent that treats them as one has invented the catalogue.

**Scope**

Decide, and record in `KB §9` as `RULE-SERVICE-05`:

- Which categories launch, with stable slugs (`skin_fade`, not "Skin Fade").
- Valid price bounds per category — a minimum and a maximum a barber may set. Without bounds, a typo of `$4500` for `$45.00` becomes an authorisation on a real card.
- Whether any category is barber-mandatory or platform-default.
- Display order.

Recommend the smallest set with real supply. A category with no barbers is a dead end for a client, and a client who searches once and finds nothing does not search twice.

**Acceptance criteria**

- [ ] Launch categories listed in `KB §9` as `RULE-SERVICE-05`, with stable slugs.
- [ ] Every category has a minimum and maximum allowed barber price, in integer cents.
- [ ] Display order is defined.
- [ ] `TBC-SERVICE-CATEGORIES` in `KB §14` rewritten as `RESOLVED → RULE-SERVICE-05`. Not deleted.
- [ ] `RULE-SERVICE-05` removed from `KB §9`'s *Pending rules* table and written into the section above it.
- [ ] Categories deferred to post-launch are listed under `KB §16` out of scope, so the decision is not re-litigated in three weeks.

**Out of scope** — building the catalogue tables or admin CRUD (`P1-T10`); barber pricing UI (`P1-T11`); seeding the data (`P0-T12`).

**Sync notes** — `affects` lists every ticket that hardcodes an assumption about categories or price bounds. If the launch set changes after Phase 1 starts, all seven need review.

---

#### P0-D02 — Decide platform commission and Stripe fee absorption

```yaml
id: P0-D02
title: "Decide platform commission and Stripe fee absorption"
issueType: Decision
owner: Tony
phase: 0
priority: Highest
jiraKey: TRIMR-3
dependsOn: []
affects: [P0-D03, P2-T08, P3-T01, P3-T02, P3-T04, P3-T07, P3-T10, P5-T07, P5-T09]
knowledgeBase: [ADR-009, RULE-PAY-01, RULE-PAY-08, RULE-PAY-11, RULE-EARN-01, CFG-COMMISSION-PCT]
blockedByTbc: []
labels: [quicktrimr, phase-0, decision, product, stripe]
```

**Context**

**This is the highest-stakes decision in the backlog.** The commission percentage is snapshotted onto every booking (`ADR-009`) and every earning derives from it. Changing it later does not change history — it changes only new bookings, which is correct, but it means the number chosen now is baked into every financial record QuickTrimr ever produces. Getting it wrong is not a config edit; it is a conversation with every barber on the platform.

**Decision confirmed by Andrew on 2026-09-30: Option A**, now recorded in `RULE-PAY-11`. Commission is 20% of booked service price only. QuickTrimr absorbs Stripe payment-processing fees, including fees retained after refunds, without a client card surcharge or deduction from barber net. Service refunds reverse commission proportionally; QuickTrimr's commission is rounded down and the barber receives the remaining cents. Internal dispute resolution barber-paid retains the normal split.

`TBC-COMMISSION-PCT` and `TBC-STRIPE-FEES` are resolved in place. The KB contains the authoritative integer-cent examples, including QuickTrimr's negative position after a full refund. The illustrative processing fee is not a fixed Stripe rate. Cancellation/inconvenience allocation remains `P0-D03`.

**Scope**

Decide, and record in `KB §9` as `RULE-PAY-11`, with `CFG-COMMISSION-PCT` given a value in `KB §13`:

- The commission percentage.
- Whether commission is charged on the service price only, or on the total the client pays.
- **Who absorbs the Stripe processing fee** — QuickTrimr out of commission, the barber out of net, or the client as a surcharge.
- What happens to the Stripe processing fee on a **full refund** and on a **partial service refund**, without choosing `P0-D03`'s cancellation split.
- Whether commission is refunded proportionally when a booking is refunded.
- The rounding rule, in integer cents, when a percentage does not divide evenly. Name the direction explicitly — "round down to the barber" or "round down to QuickTrimr" — because unspecified rounding is where a ledger drifts by a cent per booking.

Work each of these as a **numbered example**: a $45 haircut, full refund; a $45 haircut, partial refund; a $45 haircut, disputed and resolved barber-paid. If the three examples do not reconcile against what Stripe actually captured, the decision is not finished.

**Acceptance criteria**

- [ ] `RULE-PAY-11` written in `KB §9` covering commission basis, Stripe fee absorption, refund treatment and rounding.
- [ ] `CFG-COMMISSION-PCT` has a concrete value in `KB §13`.
- [ ] A worked example table for at least: full capture, full refund, partial refund, and dispute resolved barber-paid.
- [ ] The rounding rule names a direction, not "round sensibly".
- [ ] `TBC-COMMISSION-PCT` and `TBC-STRIPE-FEES` in `KB §14` rewritten as `RESOLVED → RULE-PAY-11`. Not deleted.
- [ ] `RULE-PAY-11` removed from `KB §9`'s *Pending rules* table.

**Out of scope** — implementing the calculation (`P3-T01`, `P3-T04`); the cancellation split, which is `P0-D03`.

**Tests** — documentation checks for the concrete config, resolved TBC pointers and removal from Pending rules; pure integer-cent checks against every KB worked example, including full capture, full/partial refund, barber-paid and uneven cents. Check cumulative-refund rounding, reconciliation including retained processing fees, and preservation of the original snapshots. These are specification checks, not production money logic or proof of a Stripe integration.

**Sync notes** — every ticket in `affects` either calculates or displays a derived number or makes the remaining cancellation decision. `§8 Traceability` additionally identified `P5-T07`, now included alongside `P0-D03`. All nine were reviewed for this decision; see `docs/decisions/P0-D02.md`. Any later change requires the same review; existing bookings keep their request-time snapshots. Generated indexes are left for CI on main.

---

#### P0-D03 — Decide cancellation refund split and inconvenience fee funding

```yaml
id: P0-D03
title: "Decide cancellation refund split and inconvenience fee funding"
issueType: Decision
owner: Tony
phase: 0
priority: Highest
jiraKey: TRIMR-4
dependsOn: [P0-D02]
affects: [P2-T08, P2-T09, P3-T04, P3-T05, P3-T07, P3-T08, P3-T09, P3-T10, P5-T07, P5-T08, P5-T09, P6-T06, P6-T07]
knowledgeBase: [ADR-009, RULE-CANCEL-01, RULE-CANCEL-02, RULE-CANCEL-03, RULE-CANCEL-04, RULE-CANCEL-05, RULE-CANCEL-07, RULE-EARN-02, RULE-EARN-03, RULE-PAY-11, CFG-CANCEL-REFUND-PCT, CFG-INCONVENIENCE-FEE, CFG-LATE-CANCEL-WINDOW-HOURS]
blockedByTbc: []
labels: [quicktrimr, phase-0, decision, product, stripe]
```

**Context**

**Decision confirmed by Andrew on 2026-09-30: Option A**, recorded in `RULE-CANCEL-07`. A late Scheduled client cancellation refunds 75%; an accepted Available Now client cancellation refunds 50%. The barber receives all withheld service cents, not an additional service earning or a platform top-up. Refunds round up; QuickTrimr reverses all cancellation commission and absorbs retained processing fees.

The approved earning exception in `RULE-EARN-02` makes the adjusted inconvenience earning available only after cancellation and successful refund processing, with no open dispute. The booking remains cancelled; bank payment follows the normal payout schedule. Pre-acceptance cancellation, outside-window Scheduled cancellation and barber-cancellation refunds remain as already specified. Normal service/dispute-refund commission treatment from `P0-D02` is unchanged.

**Scope**

Decide, and record in `KB §9` as `RULE-CANCEL-07`, with values for `CFG-CANCEL-REFUND-PCT` and `CFG-INCONVENIENCE-FEE` in `KB §13`:

- The client's refund percentage on a late cancellation.
- Whether the split differs between an Available Now booking (barber may already be travelling) and a Scheduled one inside `CFG-LATE-CANCEL-WINDOW-HOURS`. Recommend that it does — a barber halfway across town has incurred a real cost that a barber with a booking tomorrow has not.
- The inconvenience fee: fixed amount, percentage, or capped percentage.
- **Which side funds it** — the client's withheld amount, or QuickTrimr.
- Whether QuickTrimr keeps commission on the cancellation/inconvenience allocation. Confirmed: zero, with full reversal of original commission, separate from `RULE-PAY-11`'s normal service-refund formula. Do not double-count a barber service entitlement and an inconvenience payment from the same retained cents.
- Show what a barber cancellation costs QuickTrimr: the client is refunded in full (`RULE-CANCEL-04`), and **QuickTrimr absorbs the retained payment-processing fee**, already decided by `RULE-PAY-11`.
- Record the approved earning-release exception and its refund-success/dispute gates in `RULE-EARN-02`, without marking a cancelled booking completed or deciding payout cadence.

**Acceptance criteria**

- [ ] `RULE-CANCEL-07` written in `KB §9` covering refund percentage, inconvenience fee, funding source, and commission treatment.
- [ ] `CFG-CANCEL-REFUND-PCT` and `CFG-INCONVENIENCE-FEE` have concrete values in `KB §13`.
- [ ] Available Now and Scheduled are each addressed, whether or not they differ.
- [ ] A worked example for each of: client cancels before acceptance, client cancels late, barber cancels late — showing client refund, barber receipt, QuickTrimr position, and Stripe fee, all in integer cents, all summing to what was captured.
- [ ] `TBC-CANCEL-SPLIT` and `TBC-INCONVENIENCE-FEE` in `KB §14` rewritten as `RESOLVED → RULE-CANCEL-07`. Not deleted.
- [ ] `RULE-CANCEL-07` removed from `KB §9`'s *Pending rules* table.
- [ ] Refund rounding direction and the exact Scheduled-window boundary are explicit; terms are snapshotted rather than changed retrospectively by config.
- [ ] `RULE-EARN-02` and affected earnings/payout tickets reflect the approved exception; pending/failed refunds and open disputes cannot release the inconvenience earning.

**Tests** — specification checks against the KB's captured/uncaptured, early/late Scheduled, accepted Available Now and barber-cancellation examples, including uneven cents; exact 12-hour boundary; full commission reversal versus unchanged service-refund policy; config/pointer checks; cancellation contract fixture parity; refund-success/dispute release conditions in the rule and downstream tickets. These are documentation regressions, not production Stripe or earning-release tests.

**Out of scope** — implementing cancellation (`P3-T07`); reliability consequences of a barber cancellation, which is `P0-D04`; admin refunds (`P5-T07`).

**Sync notes** — `P3-T07` implements this, `P3-T08`/`P3-T09` display it, and `P5-T07`/`P5-T08` handle admin outcomes without confusing cancellation with service refunds. `P2-T08` snapshots the terms, `P2-T09` discloses them before booking, and `P3-T04`/`P3-T10` must permit the approved cancellation-earning path. The cancellation contract fixture and downstream display/QA tickets are synchronized. See `docs/decisions/P0-D03.md` for the full traceability review. Generated indexes remain for CI on main. Legal review of rates/disclosure remains required before launch, not claimed by this decision.

---

#### P0-D04 — Decide barber reliability thresholds and consequences

```yaml
id: P0-D04
title: "Decide barber reliability thresholds and consequences"
issueType: Decision
owner: Tony
phase: 0
priority: Highest
jiraKey: TRIMR-5
dependsOn: []
affects: [P2-T01, P2-T02, P2-T03, P2-T04, P2-T08, P2-T12, P2-T14, P3-T07, P3-T09, P3-T12, P5-T03, P5-T13]
knowledgeBase: [RULE-CANCEL-04, RULE-AVAIL-03, RULE-RELY-01, RULE-RELY-02, RULE-RELY-03, RULE-RELY-04, RULE-RELY-05, RULE-RELY-06, ENUM-RELIABILITY-LEVEL, CFG-RELIABILITY-WINDOW-DAYS, CFG-RELIABILITY-RESET-DAYS, CFG-RELIABILITY-COOLDOWN-MIN, CFG-RELIABILITY-THRESHOLDS, CFG-RELIABILITY-SEARCH-PENALTY, CFG-MISSED-REQUEST-THRESHOLD]
blockedByTbc: []
labels: [quicktrimr, phase-0, decision, product]
```

**Context**

Andrew confirmed **Option A on 2026-10-02**, recorded in `RULE-RELY-06`; Tony remains the owner. This resolves `TBC-RELIABILITY-THRESHOLDS`: a 30-day rolling window/reset, 60-minute Available Now cooldown, warning/limited/restricted at 1/2/3 current offences and eligibility for **human** suspension review from 4. Missed requests do not count as reliability offences.

This is a livelihood decision, not a config value. A barber who is suspended stops earning. Set the window too tight and one bad week ends someone's income; too loose and a client is stood up by the same barber twice with no consequence.

`RULE-RELY-02` already commits QuickTrimr to recoverability, so the decision is bounded: this is about numbers and thresholds, not about whether to forgive.

**Scope**

Record the approved policy in `RULE-RELY-06` and the `CFG-RELIABILITY-*` rows. Include the exact rolling-window/cooldown boundaries, per-booking offence deduplication, exclusions, step-down recovery, review threshold distinct from suspension, human reinstatement, emergency/error corrections and truthful barber-facing standing/recovery information.

Restricted means **demoted after non-restricted barbers**, not excluded. An active cooldown blocks Available Now only; suspension blocks new bookings of both types. Synchronize server-side session, discovery, request and acceptance guards, not just the cancellation screen. Do not automatically cancel existing bookings or confiscate earnings.

**Acceptance criteria**

- [ ] `RULE-RELY-06` written in `KB §9` defining offences, window, per-level thresholds, per-level consequences, and recovery.
- [ ] `CFG-RELIABILITY-WINDOW-DAYS`, `CFG-RELIABILITY-RESET-DAYS` and `CFG-RELIABILITY-COOLDOWN-MIN` have concrete values in `KB §13`.
- [ ] Every level in `ENUM-RELIABILITY-LEVEL` has both an entry threshold and a defined effect.
- [ ] Whether a missed Available Now request counts as an offence is stated explicitly, either way.
- [ ] Suspension is defined as automatic or admin-gated.
- [ ] A worked example: a barber cancels late three times across the window, showing the level after each and the date they return to `good_standing`.
- [ ] `TBC-RELIABILITY-THRESHOLDS` in `KB §14` rewritten as `RESOLVED → RULE-RELY-06`. Not deleted.
- [ ] `RULE-RELY-06` removed from `KB §9`'s *Pending rules* table.
- [ ] Cooldown and window boundaries, demotion versus exclusion, human reinstatement and the existing-booking/earnings safeguards are explicit in the KB and affected tickets.

**Tests** — specification regression checks for approved config and all enum levels; every UTC worked-example row; exact 30-day and 60-minute boundaries; second-and-later offence cooldown restart; fourth offence never automatically suspended; suspended state survives aging; missed/declined/client/early cancellations excluded; append-only correction and no-confiscation requirements; downstream guard/ordering consistency. These test the decision document and test-only arithmetic, not a production reliability engine, RLS, concurrency or scheduler.

**Out of scope** — building the reliability engine (`P3-T12`); admin reliability management (`P5-T13`); the Available Now missed-request auto-disable, which is already decided (`RULE-AVAIL-03`).

**Sync notes** — `P3-T07` produces qualifying cancellation events through `P3-T12`; `P3-T09` displays the result. `P2-T03` never produces offences for misses. Phase 2 entry points consume a shared read-side eligibility policy; `P3-T12` integrates live event calculation without a later-phase dependency in Phase 2. `P5-T03`/`P5-T13` distinguish automatic standing, review and human suspension. See `docs/decisions/P0-D04.md` for the full traceability review. Generated indexes are left for CI on main.

---

#### P0-D05 — Decide payout schedule and batch cadence

```yaml
id: P0-D05
title: "Decide payout schedule and batch cadence"
issueType: Decision
owner: Tony
phase: 0
priority: High
jiraKey: TRIMR-6
dependsOn: [P0-D02]
affects: [P0-T18, P1-T07, P3-T03, P3-T05, P3-T10, P3-T11, P5-T10, P6-T02]
knowledgeBase: [RULE-EARN-04, RULE-EARN-05, RULE-EARN-06, RULE-EARN-07, CFG-PAYOUT-SCHEDULE, CFG-PAYOUT-MIN-CENTS]
blockedByTbc: []
labels: [quicktrimr, phase-0, decision, product, stripe]
```

**Context**

**Decision confirmed by Andrew on 2026-10-02: Option A**, recorded in `RULE-EARN-07`. Process weekly on Monday at 10:00 am Australia/Sydney, following daylight saving, with a strict before-run availability cut-off. Pay every positive eligible AUD balance; one global batch has independently processed per-barber items. Confirmed temporary failures retry next run; invalid bank details/restrictions hold for verified correction with barber/admin notification; unknown outcomes reconcile before retry. Show processing timing, status and an estimated bank-arrival date when known, never promise bank arrival on Monday.

The approval also covers QuickTrimr absorbing standard Connect/payout fees and correcting the transfer-versus-bank-payout mismatch in `RULE-EARN-04`/`RULE-EARN-05`. `TBC-PAYOUT-SCHEDULE` is resolved in place. Provider account support must be demonstrated in `P0-T18`; this decision does not claim that Stripe is configured or a payout system exists.

This is the number barbers will ask about before they sign up, and `RULE-EARN-04` exists because the gap between "available" and "in my bank" is the single most likely support complaint on the platform. Deciding the cadence is also deciding what the barber-facing copy is allowed to promise.

**Scope**

Decide, and record in `KB §9` as `RULE-EARN-07`, with a value for `CFG-PAYOUT-SCHEDULE` in `KB §13`:

- Payout frequency and the specific day and time, including timezone. "Weekly" without a day is not implementable.
- The cut-off: which earnings make a given run — everything `available` at the moment the batch is cut, or everything available before a stated cut-off time.
- A minimum payout balance, if any, and what happens to a balance below it — carried, or paid anyway.
- Whether payouts run per barber or as one batch across all barbers.
- What happens to a **failed** payout: retry on the next run, retry immediately, or hold for admin. A barber's bank details being wrong is common and must not silently strand money.
- Whether a barber can see the date of their next payout in the app. Recommend yes — it is the cheapest possible answer to the most common question.

**Acceptance criteria**

- [ ] `RULE-EARN-07` written in `KB §9` covering frequency, day and timezone, cut-off, minimum balance, batching model, and failure handling.
- [ ] `CFG-PAYOUT-SCHEDULE` has a concrete value in `KB §13`.
- [ ] Failure handling names a specific behaviour, not "handle failures".
- [ ] The next-payout-date question is answered, because `P3-T05` renders it.
- [ ] `TBC-PAYOUT-SCHEDULE` in `KB §14` rewritten as `RESOLVED → RULE-EARN-07`. Not deleted.
- [ ] `RULE-EARN-07` removed from `KB §9`'s *Pending rules* table.
- [ ] Cut-off equality, daylight saving, delayed runs, positive/zero balances, provider holds, fee absorption and transfer-versus-bank-payout states are explicit and reflected in affected tickets.

**Tests** — specification regression checks parse the concrete schedule/minimum config, TBC pointer and real rule; validate every UTC/Sydney cut-off example, including strict equality, both daylight-saving offsets and one cent; check zero is not paid and delayed workers retain the scheduled cut-off; check downstream failure/reconciliation, unchanged barber net, next-processing versus estimated-arrival copy and all-items-successful batch completion. These are decision-document and test-only arithmetic checks, not a production scheduler, Stripe integration, database/RLS or concurrency proof.

**Out of scope** — building batching (`P3-T10`) or processing (`P3-T11`); the workflow engine that triggers the run (`P0-D07`).

**Sync notes** — `P3-T10` and `P3-T11` implement this, `P3-T05` displays it to the barber, `P5-T10` gives admin visibility, and `P6-T02` delivers its notification events. `P0-T18`/`P1-T07` must establish compatible payout controls/fee handling; `P3-T03` routes connected-account payout events. See `docs/decisions/P0-D05.md` for the traceability review and unchanged consumers. Generated indexes are left for CI on main.

---

#### P0-D06 — Decide barber location precision and ETA refresh cadence

```yaml
id: P0-D06
title: "Decide barber location precision and ETA refresh cadence"
issueType: Decision
owner: Andrew
phase: 0
priority: High
jiraKey: TRIMR-7
dependsOn: []
affects: [P1-T06, P2-T01, P2-T04, P2-T06, P2-T07, P4-T05, P4-T06]
knowledgeBase: [ADR-004, ADR-008, RULE-DISCOVERY-02, RULE-DISCOVERY-04, RULE-DISCOVERY-05, RULE-ETA-02, RULE-ETA-03, RULE-ETA-04, CFG-ETA-REFRESH-MIN, CFG-ETA-STALE-MIN]
blockedByTbc: []
labels: [quicktrimr, phase-0, decision, product, maps, security]
```

**Context**

Two related unknowns, both about how much location QuickTrimr reveals and how often.

`TBC-LOCATION-PRECISION` — the old backlog said barber markers "do not expose private exact location where not appropriate", which decides nothing. A barber running Available Now from home has broadcast their home address to every client who searches, and self-employed barbers working from home are common. Showing an exact pin is a safety decision made by omission.

`TBC-ETA-INTERVAL` — `CFG-ETA-REFRESH-MIN` is literally written as "2 or 3" in the source material. Every Routes call costs money and every refresh is a location read, so the interval is both a bill and a privacy surface.

**Scope**

Decide, and record in `KB §9` as `RULE-DISCOVERY-05`, with values for `CFG-ETA-REFRESH-MIN` and `CFG-ETA-STALE-MIN` in `KB §13`:

- The precision at which a barber's location is exposed **before** acceptance — exact point, jittered point, suburb centroid, or distance band only ("2–3 km away"). Recommend a distance band plus an approximate area: a client picking a barber needs to know how far, not where they live.
- Whether precision increases **after** acceptance, and for whom. The client of an accepted booking arguably should see a real ETA origin; nobody else should.
- Whether the map view (`P2-T07`) renders individual barbers at all, or an area. If markers are jittered, whether the jitter is stable per session — a marker that moves on every refetch reveals the true point by averaging, which is worse than no jitter.
- The ETA refresh interval, and whether it is fixed or scales with remaining distance.
- When an ETA becomes stale rather than continuing to be presented as current.
- Whether a client sees the barber's live position during on-the-way, or only an ETA. `ADR-004` says ETA only; this ticket confirms it and states what the UI is allowed to show.

**Acceptance criteria**

- [ ] `RULE-DISCOVERY-05` written in `KB §9` defining pre-acceptance precision, post-acceptance precision, and map rendering.
- [ ] Jitter stability is addressed explicitly if jitter is chosen.
- [ ] `CFG-ETA-REFRESH-MIN` has a single concrete value in `KB §13`, not a range.
- [ ] `CFG-ETA-STALE-MIN` has a concrete value tied to the refresh interval.
- [ ] `TBC-LOCATION-PRECISION` and `TBC-ETA-INTERVAL` in `KB §14` rewritten as `RESOLVED → RULE-DISCOVERY-05`. Not deleted.
- [ ] `RULE-DISCOVERY-05` removed from `KB §9`'s *Pending rules* table.

**Out of scope** — implementing search (`P2-T04`), the map (`P2-T07`), or the ETA function (`P4-T05`).

**Sync notes** — this decision changes what the search function is allowed to return, which means `P2-T04`'s response shape depends on it. Deciding it after `P2-T04` ships means changing an API contract that the list and map views already consume.

---

#### P0-D07 — Choose the workflow and scheduling engine

```yaml
id: P0-D07
title: "Choose the workflow and scheduling engine"
issueType: Spike
owner: Tony
phase: 0
priority: Highest
jiraKey: TRIMR-8
dependsOn: []
affects: [P2-T03, P2-T15, P3-T11, P3-T12, P4-T05, P4-T11, P6-T02]
knowledgeBase: [ADR-011]
blockedByTbc: []
labels: [quicktrimr, phase-0, decision, spike, backend]
```

**Context**

`TBC-WORKFLOW-ENGINE`, now resolved to `ADR-011`. QuickTrimr is a timer product wearing a marketplace: a 5-minute Available Now expiry, a 2-hour Scheduled expiry, a session available-until, a 1-hour completion window, a 6-hour no-action warning, a further 1-hour dispute window, throttled ETA refreshes, and a payout run. Seven downstream tickets consume this architecture, including reliability recovery.

**Approved by Andrew on 2026-10-03: Option A — Supabase `pg_cron` with bounded indexed
database-backed sweeps.** Approval explicitly includes documentation-only evaluation of the
unselected Trigger.dev candidate. Supabase and Inngest have local runtime evidence; Trigger.dev
has not been run. This amendment is limited to this spike's comparison, not production tests.

The previous backlog never decided this. `P2-E04-T04` said "cron scheduling infrastructure beyond what is required for this rule" was out of scope — which left the scheduling of every timed rule owned by nobody.

**This is a `Spike`, not a `Decision`** — it has measurable criteria, so you may build the proof and recommend. It is the only ticket in Phase 0 where that is true. Record the reasoning and let Tony or Andrew confirm before it lands in `ADR-011`.

**Scope**

Evaluate the realistic options — Supabase scheduled functions / `pg_cron`, Inngest, Trigger.dev — against criteria that come from QuickTrimr's actual rules:

| Criterion | Why it matters here |
|---|---|
| Sub-minute delay accuracy | `CFG-AVAIL-EXPIRY-MIN` is 5 minutes. A scheduler with 15-minute granularity cannot implement it, and a client watching a countdown will see it expire late. |
| Per-entity scheduling | Every request needs its own persisted deadline. The approved model is a bounded periodic due-state sweep, not a recurring cron job per entity. |
| Idempotency and replay | It will fire twice. `ADR-011` requires the second fire to be a no-op. |
| Cancellation | An accepted request must cancel its own expiry job, or the sweep must re-check state. |
| Reconciliation | What catches a dropped schedule. A request that silently never expires holds a client's authorisation. |
| Observability | Can you see a failed or missed run without a customer telling you? |
| Cost at volume | Priced against a realistic booking volume, not a free tier. |
| Local development | Both engineers need to test expiry without waiting 5 real minutes. |

Build a **working proof** of the hardest case: schedule a 5-minute expiry for a specific request, cancel it when the request is accepted, prove a duplicate fire is a no-op, and prove a dropped schedule is caught by reconciliation.

Note the fallback honestly. A periodic sweep query on `pg_cron` — "expire every pending request older than its expiry" — is unglamorous, has no per-entity scheduling to lose, and is trivially idempotent. It may be sufficient, and if it is, say so.

**Acceptance criteria**

- [ ] Each option evaluated against every criterion above, with measured local Supabase/Inngest evidence and clearly labelled documentation-only Trigger.dev evaluation, as explicitly approved by Andrew on 2026-10-03. Never report unexecuted cloud/vendor behavior as tested.
- [ ] A working proof of the 5-minute expiry case, including cancel-on-accept, duplicate fire, and reconciliation.
- [ ] Cost modelled at a stated booking volume.
- [ ] Local development story demonstrated — how an engineer tests a 6-hour rule without waiting 6 hours.
- [ ] A recommendation with reasoning, plus what it would cost to switch later.
- [ ] Confirmed by Tony or Andrew, then written into `ADR-011` naming the chosen engine.
- [ ] `TBC-WORKFLOW-ENGINE` in `KB §14` rewritten as `RESOLVED → ADR-011`. Not deleted.

**Tests**

- Reproduce the isolated proof in `scripts/spikes/P0-D07/README.md`; capture engine versions,
  actual deadline/delivery timestamps and per-check results. Label documentation-only claims
  and unexecuted vendor/cloud paths explicitly; they do not satisfy runtime evidence.
- Exact deadline boundaries; a real configured five-minute expiry; accepted-state stale no-op;
  repeated parallel duplicate calls with one effect; accept/expiry race with one atomic outcome;
  a deliberately omitted schedule recovered by reconciliation; paused-sweep recovery and visible
  failed-run history. The synthetic proof does not decide acceptance priority at the boundary.
- RLS read/insert/update/delete denial through the API for anonymous and two signed users on
  every fixture table; private time-injection RPCs unavailable to mobile roles; append-only effects.
- Demonstrate the six-hour case using a private controlled clock, not a production config change.
- Recompute stated-volume costs, including reconciliation, paid-plan floors and step/compute
  sensitivity. Re-run the graph check; do not resolve the TBC before human confirmation.
- Guard the approved engine, scope amendment, TBC resolution, deadline/idempotency/recovery
  contract and all seven downstream consumers in `scripts/decisions.test.mjs`.

**Out of scope** — implementing any actual scheduled rule (`P2-T15`, `P4-T11`, `P3-T11`).

**Sync notes** — seven tickets across four phases inherit the approved `ADR-011` sweep model.
Each owning vertical slice delivers its actual schedules, protected handlers, durable recovery,
monitoring and live tests; reuse shared patterns rather than defer integration to an unowned
engine ticket. The disposable proof is not a production implementation. Research/decision and
runtime evidence: `docs/decisions/P0-D07.md`, `docs/qa/P0-D07.md`.

---

#### P0-D08 — Decide scheduled booking lead time and review eligibility

```yaml
id: P0-D08
title: "Decide scheduled booking lead time and review eligibility"
issueType: Decision
owner: Andrew
phase: 0
priority: High
jiraKey: TRIMR-9
dependsOn: []
affects: [P0-T06, P0-T10, P0-T18, P2-T05, P2-T08, P2-T09, P4-T14, P4-T15, P5-T07]
knowledgeBase: [ADR-006, RULE-SCHED-01, RULE-SCHED-02, RULE-SCHED-04, RULE-REVIEW-01, RULE-REVIEW-02, RULE-REVIEW-06, ENUM-DISPUTE-STATUS, CFG-SCHED-MIN-LEAD-MIN, CFG-SCHED-MAX-HORIZON-DAYS, CFG-REVIEW-DEADLINE-DAYS]
blockedByTbc: []
labels: [quicktrimr, phase-0, decision, product]
```

**Context**

Two smaller unknowns that both block Phase 2 and Phase 4 validation.

`TBC-SCHED-LEAD-TIME` — before this decision nothing said how far ahead a Scheduled booking must be, or how far ahead it may be. Without a minimum, a client can book for "in 4 minutes" and bypass Available Now entirely, including its one-active-request rule (`RULE-AVAIL-04`) and its 5-minute expiry. Without a maximum, the platform can capture payment months before service and accept plans likely to go stale. Under `ADR-006`, authorisation lifetime constrains the two-hour pending-request window, not the later appointment: payment is captured when the barber accepts.

`TBC-REVIEW-ELIGIBILITY` — the original `RULE-REVIEW-01` allowed a review on a completed booking without defining auto-completed, admin-resolved or cancelled outcomes. `RULE-REVIEW-06` now records Andrew's approved Option A, including both auto-completion paths, outcome-specific admin resolutions, and a 14-day deadline.

**Scope**

Decide, and record in `KB §9` as `RULE-SCHED-04` and `RULE-REVIEW-06`, with values for the corresponding configuration in `KB §13`:

Lead time:

- The minimum lead time for a Scheduled request, and what a client sees if they pick a time inside it.
- The maximum booking horizon and its interaction with `ADR-006`: authorisation covers only the pending request and capture occurs on acceptance, so the horizon controls how early QuickTrimr may take payment rather than how long it holds an authorisation.
- Whether the barber's own availability constrains it, or only these bounds.

Review eligibility:

- Whether an **auto-completed** booking is reviewable. Recommend yes — the service happened.
- Whether a **disputed then admin-resolved** booking is reviewable, and whether the outcome matters.
- Whether a **cancelled** booking is reviewable. Recommend no.
- Whether there is a deadline after completion beyond which a review can no longer be left.

**Acceptance criteria**

- [ ] `RULE-SCHED-04` written in `KB §9` with minimum lead time, maximum horizon, and the authorisation-lifetime interaction.
- [ ] `CFG-SCHED-MIN-LEAD-MIN` has a concrete value in `KB §13`.
- [ ] `CFG-SCHED-MAX-HORIZON-DAYS` has a concrete value in `KB §13`.
- [ ] `RULE-REVIEW-06` written in `KB §9` covering auto-completed, admin-resolved, and cancelled bookings, plus any review deadline.
- [ ] `CFG-REVIEW-DEADLINE-DAYS` has a concrete value in `KB §13`.
- [ ] Every listed completion, dispute-resolution and cancellation outcome is explicitly reviewable or not — none left implied.
- [ ] `TBC-SCHED-LEAD-TIME` and `TBC-REVIEW-ELIGIBILITY` in `KB §14` rewritten as `RESOLVED → RULE-SCHED-04` / `RULE-REVIEW-06`. Not deleted.
- [ ] Both reserved IDs removed from `KB §9`'s *Pending rules* table.

**Tests** — `node scripts/jira/generate-indexes.mjs --check`; inspect the three concrete config values, every outcome and deadline origin in `RULE-REVIEW-06`, both resolved TBC rows, and the Pending rules table. This Decision ticket changes documentation only; boundary and runtime tests belong to the affected build tickets.

**Out of scope** — implementing request validation (`P2-T08`) or review creation (`P4-T14`).

**Decision recorded** — Andrew approved Option A: minimum 240 minutes, maximum 30 days, the existing two-hour request expiry, manual barber availability checks, and the eligibility matrix and 14-day review window in `RULE-REVIEW-06`. Validation evidence: `node scripts/jira/generate-indexes.mjs --check` and the rule/config/TBC entries in the knowledge base. No application code is delivered by this Decision ticket.

**Sync notes** — the lead-time bounds are surfaced in `P2-T05`'s time picker, validated in `P2-T08`, and rechecked by `P2-T09` before submission; review eligibility is enforced in `P4-T14`, drives whether `P4-T15` shows a prompt at all, and requires `P5-T07` to record the resolution outcome and time used by the review window.

---

### Foundation tickets

Everything that can be built today without inventing an answer to a TBC.

---
#### P0-T01 — Scaffold the monorepo

```yaml
id: P0-T01
title: "Scaffold the monorepo"
issueType: Task
owner: Andrew
phase: 0
priority: Highest
jiraKey: TRIMR-10
dependsOn: [P0-T19]
affects: [P0-T02, P0-T04, P0-T06, P0-T13, P0-T16]
knowledgeBase: [ADR-007]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation]
```

**Context**

Everything else lands inside this. `ADR-007` and `KB §7` define the layout; this ticket creates it so that the first shared type lands in `packages/shared` rather than in whichever app needed it first and got copied.

`packages/domain` is in the structure from day one even though nothing fills it until Phase 2. It exists so that when someone writes the refund calculation, the pure place to put it already exists — a directory created after the code is written never gets used.

**Scope**

pnpm workspaces. Create `apps/mobile`, `apps/admin`, `packages/shared`, `packages/domain`, `packages/validation`, `packages/ui`, `supabase/{functions,migrations,seed}`, `scripts/{jira,db,stripe}`, `docs/{architecture,decisions,api,qa}` per `KB §7`.

Root `package.json` with workspace-wide scripts: `typecheck`, `lint`, `format`, `test`, `build`. Each script runs across every workspace, so one command at the root is the real answer to "does this repo pass".

`README.md` covering install, run mobile, run admin, run Supabase locally, typecheck, lint, test.

Package boundaries: `shared` depends on nothing; `domain` depends only on `shared`; `validation` depends on `shared`; `ui` depends on `shared`. Apps depend on all four. No cycles, and no package importing an app.

**Acceptance criteria**

- [ ] `pnpm install` succeeds from a clean clone.
- [ ] The directory structure matches `KB §7` exactly.
- [ ] Root `typecheck`, `lint`, `format`, `test` and `build` scripts exist and run across all workspaces.
- [ ] A type exported from `packages/shared` can be imported by `apps/mobile`, `apps/admin` and a Supabase function without a relative `../../..` path.
- [ ] No package imports an app; no dependency cycle exists between packages.
- [ ] `README.md` documents install, run, typecheck, lint, and test.
- [ ] No placeholder files beyond what the generators produce.

**Tests** — a smoke check that each root script exits zero on the empty workspace.

**Out of scope** — TypeScript and lint configuration (`P0-T02`); CI (`P0-T04`); app shells (`P0-T13`, `P0-T16`); any schema or feature code.

**Sync notes** — every ticket in `affects` places files inside this structure. Moving a package after Phase 1 starts means touching every import in the repo.

---

#### P0-T02 — Configure TypeScript, linting, formatting and quality scripts

```yaml
id: P0-T02
title: "Configure TypeScript, linting, formatting and quality scripts"
issueType: Task
owner: Tony
phase: 0
priority: Highest
jiraKey: TRIMR-11
dependsOn: [P0-T01]
affects: [P0-T04, P0-T05]
knowledgeBase: [ADR-007]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation]
```

**Context**

The quality bar in `KB §15` and the review checklist are only real if a machine enforces them. Rules configured now are cheap; rules added after 40 files exist mean a day of fixing violations nobody wants to review.

The rules that matter most here are the ones that catch the defects `KB §12` cares about: an unused import is cosmetic, but a floating promise around a Stripe call is a payment that silently never happened.

**Scope**

`tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`, and `exactOptionalPropertyTypes`. Per-package configs extend it. Path aliases so `@quicktrimr/shared` resolves everywhere.

ESLint flat config covering TypeScript, React, React Hooks, and import ordering. Rules that are errors, not warnings:

- `@typescript-eslint/no-floating-promises` — an unawaited Stripe or Supabase call is a defect.
- `@typescript-eslint/no-explicit-any` — `KB §15`.
- `react-hooks/exhaustive-deps`.
- `no-restricted-imports` preventing an app importing another app, and preventing `packages/domain` importing anything with I/O.

Prettier, plus `.prettierignore`. A `format:check` script CI can run.

Wire all of it into the root scripts from `P0-T01`.

**Acceptance criteria**

- [ ] `pnpm typecheck` passes across every workspace with `strict: true`.
- [ ] `pnpm lint` passes and flags a deliberately introduced `any`, floating promise, and hook-dependency violation.
- [ ] `pnpm format:check` passes and fails on unformatted input.
- [ ] `packages/domain` cannot import a network or database client — verified by a lint rule, not convention.
- [ ] An app cannot import another app.
- [ ] Path aliases resolve in mobile, admin, and Supabase functions.
- [ ] Generated and build output directories are excluded.

**Tests** — fixture files that must fail lint, asserted as failing. A rule nobody proved fires is a rule that is not configured.

**Out of scope** — CI wiring (`P0-T04`); the PR checklist (`P0-T05`).

**Sync notes** — `P0-T04` runs exactly these scripts. If a script is renamed, CI breaks.

---

#### P0-T03 — Environment variable strategy

```yaml
id: P0-T03
title: "Environment variable strategy"
issueType: Task
owner: Tony
phase: 0
priority: Highest
jiraKey: TRIMR-12
dependsOn: [P0-T01]
affects: [P0-T04, P0-T09, P0-T18, P1-T07, P4-T05, P6-T03, P6-T04, P6-T09]
knowledgeBase: [ADR-001, ADR-008, RULE-PAY-10, RULE-ETA-02]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, security]
```

**Context**

QuickTrimr holds four categories of secret that must never reach a client bundle: the Supabase service-role key, the Stripe secret and webhook secret (`RULE-PAY-10`), and the Google server API key used for Routes (`RULE-ETA-02`, `ADR-008`).

A mobile bundle is not a secure environment. Anything shipped in an Expo build is extractable from the app, and a Google server key found in a bundle is billed to QuickTrimr until someone notices. This ticket makes the public/private split structural instead of a thing each engineer remembers.

**Scope**

`.env.example` at the root and in `apps/mobile`, `apps/admin`, and `supabase/`, listing every variable with a comment on what it is and where it may be read.

Document and enforce the split:

| Tier | May appear in | Examples |
|---|---|---|
| Public | Mobile bundle, admin browser | Supabase URL, Supabase anon key, Google **client** Maps key (referrer/bundle-restricted) |
| Server-only | Edge Functions, CI secrets | Supabase service-role, Stripe secret, Stripe webhook secret, Google **server** key for Routes |

A typed environment accessor per app that reads only its own tier. Mobile and admin cannot reference a server-only variable because the accessor does not expose one.

A `scripts/check-client-env.mjs` that fails if a server-only variable name appears anywhere under `apps/`, run in CI.

Document local, staging, and production setup, and how each engineer gets their own values without sharing a `.env`.

**Acceptance criteria**

- [ ] `.env.example` files exist and cover every variable the repo reads.
- [ ] No real secret is committed anywhere, including in examples.
- [ ] The public/server-only split is documented per variable.
- [ ] Mobile and admin code cannot reference the Supabase service-role key, the Stripe secret, the webhook secret, or the Google server key — enforced by the typed accessor.
- [ ] `check-client-env.mjs` fails on a deliberately planted server-only reference under `apps/`.
- [ ] Google client and server keys are separate variables with different restrictions documented.
- [ ] Local, staging and production setup documented.

**Tests** — `check-client-env.mjs` asserted against a fixture that plants a service-role reference in `apps/mobile`.

**Out of scope** — creating the actual third-party accounts (`P0-T18`); CI secret configuration (`P0-T04`); staging (`P6-T09`).

**Sync notes** — every ticket in `affects` reads a variable defined here. Renaming one breaks the app that reads it and the CI that injects it.

---

#### P0-T04 — GitHub Actions CI

```yaml
id: P0-T04
title: "GitHub Actions CI"
issueType: Task
owner: Tony
phase: 0
priority: High
jiraKey: TRIMR-13
dependsOn: [P0-T02, P0-T03]
affects: [P0-T05, P6-T08]
knowledgeBase: [ADR-007, RULE-DEV-CI]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation]
```

**Context**

Two engineers merging into one monorepo need the machine, not each other, to catch a broken typecheck. CI also runs the docs workflow that validates this backlog's own ticket graph.

**Scope**

`.github/workflows/ci.yml` running on pull requests and pushes to `main`: install with a pnpm cache, `typecheck`, `lint`, `format:check`, `test`, and `check-client-env.mjs`.

Jobs run in parallel where they do not depend on each other, and the workflow fails on any error. No secrets are required for these checks — a fork PR must still be able to run them.

A composite action for the repeated setup steps, so adding a job later does not mean copying six lines.

Branch protection on `main`: CI must pass, and at least one review.

Approved scope extension (`RULE-DEV-CI`): adapt the existing docs workflow to generate indexes
from `main` after merge and open/update a dedicated PR instead of pushing directly to `main`.
The generated PR requires the same CI and human review; no protection bypass or auto-merge.
Document GitHub's workflow-execution approval step for bot-created PRs.

**Acceptance criteria**

- [ ] CI runs on every PR to `main` and on push to `main`.
- [ ] Typecheck, lint, format check, tests and the client-env check all run.
- [ ] A failure in any one fails the workflow.
- [ ] No secret is required for the quality checks.
- [ ] Dependency install is cached; a no-change run completes in a reasonable time.
- [ ] Branch protection requires CI to pass before merge.
- [ ] `README.md` documents what CI enforces.
- [ ] Generated-index updates use a scoped, reusable PR branch with no direct write to `main`,
      automated approval, or merge; generation is restricted to validated pushes on `main`.

**Tests** — parse and assert workflow triggers, independent checks, cached frozen setup and
read-only/no-secret permissions; execute the required-check gate against success, failure,
cancelled and skipped results; run the workflow on a PR and repeat it unchanged to inspect
cache reuse; read back `main` protection to confirm required CI and at least one review.
Assert docs generation is main-only, validation-gated and serialized; generated commits are
restricted to the backlog file and use the default repository token, without bypasses.
After merge, observe the first generated-index PR and approve its workflow runs before review.

**Out of scope** — deployment (`P6-T09`, `P6-T10`); Playwright (`P6-T08`); changing the index generator or Jira synchronisation scripts.

**Sync notes** — CI invokes the script names from `P0-T02`. They are a contract.

---

#### P0-T05 — PR template and review checklist

```yaml
id: P0-T05
title: "PR template and review checklist"
issueType: Task
owner: Tony
phase: 0
priority: High
jiraKey: TRIMR-14
dependsOn: [P0-T01]
affects: []
knowledgeBase: [ADR-012, ADR-013, RULE-ADMIN-01]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation]
```

**Context**

Vertical ownership (`ADR-012`) means one person delivers migration through UI, and the other reviews all of it. The checklist is what stops a review from being a glance at the diff — particularly for the parts that are invisible in a diff, like whether RLS denial was actually tested at the API rather than assumed.

**Scope**

`.github/pull_request_template.md` with the ticket id, a summary, and checkboxes that mirror `KB §15` and the ticket prompt's Definition of Done:

- Ticket id, and confirmation that nothing in **Out of scope** was built.
- Evidence per acceptance criterion — the command or test name, not "verified".
- Migration and RLS notes: new tables listed, cross-user denial test named.
- Money: integer cents, server-derived amount, idempotency key deterministic.
- Screenshots or a screen recording for any UI change.
- Loading, error and empty states.
- Secrets: none added; no server-only variable referenced from `apps/`.
- Knowledge-base sync: any rule changed, `§8 Traceability` checked, affected tickets named.

`docs/qa/review-checklist.md` with the longer version and the reasoning, linked from the template.

**Acceptance criteria**

- [ ] PR template exists and applies automatically to new PRs.
- [ ] Template asks for evidence, not assertion.
- [ ] Template covers migrations, RLS, money, secrets, UI states and KB sync.
- [ ] Template asks for screenshots or a recording on UI changes.
- [ ] Template includes the out-of-scope confirmation.
- [ ] `docs/qa/review-checklist.md` exists and is linked.

**Tests**

- Check that GitHub's default template discovery locations contain exactly one PR template, at `.github/pull_request_template.md`, with unchecked checkboxes.
- Resolve the template's review-guide link and the guide's repository links; fail on a missing target.
- Review the rendered template against each acceptance criterion and the ticket prompt's Definition of Done; record the evidence in `docs/qa/P0-T05.md`.
- After merge to the default branch, open a new PR form without a `template` query parameter or supplied body and confirm GitHub inserts the template automatically. Record this separately from local structural checks.

**Out of scope** — automated review bots; CI checks (`P0-T04`).

---

#### P0-T06 — Shared constants, enums and types

```yaml
id: P0-T06
title: "Shared constants, enums and types"
issueType: Task
owner: Andrew
phase: 0
priority: Highest
jiraKey: TRIMR-15
dependsOn: [P0-T01]
affects: [P0-T07, P0-T10, P0-T14, P0-T17, P1-T03, P2-T01, P2-T08, P3-T01, P3-T04, P4-T07]
knowledgeBase: [ADR-007, ADR-010, ENUM-USER-ROLE, ENUM-VERIFICATION-STATUS, ENUM-BOOKING-TYPE, ENUM-BOOKING-STATUS, ENUM-REQUEST-STATUS, ENUM-PAYMENT-STATUS, ENUM-EARNING-STATUS, ENUM-PAYOUT-STATUS, ENUM-AVAIL-STATUS, ENUM-DISPUTE-STATUS, ENUM-RELIABILITY-LEVEL]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, database]
```

**Context**

Eleven status sets (`KB §10`) are consumed by mobile, admin, Edge Functions and the database. Defined once here, they are one source of truth; defined per consumer, they drift, and the first symptom is an admin dashboard rendering a status the mobile app cannot produce.

These must land before the schema (`P0-T10`), because the Postgres enum types are generated from the same list. A mismatch between a Postgres enum and a TypeScript union is a runtime error that typecheck cannot see.

**Scope**

In `packages/shared`, one module per enum, each exporting a `const` tuple and the derived union type:

```ts
export const BOOKING_STATUS = ['requested', 'expired', /* ... */] as const;
export type BookingStatus = (typeof BOOKING_STATUS)[number];
```

Every set in `KB §10`, verbatim — `ENUM-USER-ROLE`, `ENUM-VERIFICATION-STATUS`, `ENUM-BOOKING-TYPE`, `ENUM-BOOKING-STATUS`, `ENUM-REQUEST-STATUS`, `ENUM-PAYMENT-STATUS`, `ENUM-EARNING-STATUS`, `ENUM-PAYOUT-STATUS`, `ENUM-AVAIL-STATUS`, `ENUM-DISPUTE-STATUS`, `ENUM-RELIABILITY-LEVEL`.

Shared money types: an integer-cents branded type so a raw `number` cannot be passed where cents are expected. This is the cheapest possible guard against `ADR-009` being violated by accident.

A generator or test that asserts the Postgres enum values in `P0-T10`'s migration match these tuples exactly.

**Acceptance criteria**

- [ ] Every enum in `KB §10` is exported from `packages/shared` with values matching the knowledge base character for character.
- [ ] Each exports both a runtime tuple and a TypeScript union.
- [ ] An integer-cents type exists and a plain `number` cannot be assigned to it without an explicit conversion.
- [ ] Mobile, admin and a Supabase function each import and use one, proving resolution in all three runtimes.
- [ ] No status string literal is duplicated anywhere outside this package.
- [ ] No circular dependency between shared packages.

**Tests** — an assertion per enum that the exported tuple equals the knowledge base list; a compile-time test that a raw number is rejected where cents are required.

**Out of scope** — Zod schemas (`P0-T07`); the migration (`P0-T10`).

**Sync notes** — ten tickets import these. Adding a status is safe; renaming or removing one breaks the database enum, every function, and both apps at once.

---

#### P0-T07 — Shared Zod schemas for core contracts

```yaml
id: P0-T07
title: "Shared Zod schemas for core contracts"
issueType: Task
owner: Andrew
phase: 0
priority: Highest
jiraKey: TRIMR-16
dependsOn: [P0-T06]
affects: [P0-T08, P1-T03, P2-T08, P2-T12, P3-T01, P4-T07, P4-T09, P4-T14]
knowledgeBase: [ADR-007, RULE-PAY-01, RULE-ADMIN-01]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, backend]
```

**Context**

One schema, three consumers: the mobile form validates with it, the Edge Function validates the request with it, and the type is inferred from it. That is what makes `KB §12`'s "validate input with Zod" a single implementation instead of three that disagree at the edges.

**The rule that matters most:** no request schema may contain a field the server calculates. A schema with `commissionAmount` or `netAmount` in the request body is an invitation to send one, and `RULE-PAY-01` says the server ignores it. If it cannot be sent, it cannot be trusted by mistake.

**Scope**

In `packages/validation`, request and response schemas for the contracts Phase 2–4 will implement: create booking request, accept, decline, cancel, mark on the way, ETA update, mark complete by barber, confirm complete by client, open dispute, create review, start/update/stop Available Now session, and upsert barber service.

Shared primitives reused across all of them: integer cents, a Postgres-safe uuid, a geographic point, a timestamp, and the enums from `P0-T06`.

A shared error response schema — a stable `{ error, fields? }` shape every function returns, so both apps handle errors uniformly rather than each parsing a different body.

Types inferred from schemas, never declared alongside them.

**Acceptance criteria**

- [ ] Schemas exist for every contract listed in Scope, exported from `packages/validation`.
- [ ] Types are inferred with `z.infer`, not hand-written in parallel.
- [ ] **No request schema accepts a server-calculated financial field** — no commission, no net amount, no payout, no total the server derives.
- [ ] Amount fields are integer cents and reject decimals and negatives.
- [ ] Enum fields reference `packages/shared`, not inline string literals.
- [ ] A shared error response schema exists and is used by every contract.
- [ ] Valid and invalid example payloads exist for each schema.

**Tests** — per schema, a valid example passing and at least three invalid ones failing with a field-level error, including a decimal amount and an out-of-set enum value.

**Out of scope** — implementing any function; contract documentation (`P0-T08`).

**Sync notes** — eight tickets validate against these. Changing a schema changes an API contract that a mobile screen already submits.

---

#### P0-T08 — API contract documentation

```yaml
id: P0-T08
title: "API contract documentation"
issueType: Task
owner: Andrew
phase: 0
priority: High
jiraKey: TRIMR-17
dependsOn: [P0-T07]
affects: []
knowledgeBase: [ADR-002, RULE-ADMIN-01]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, backend]
```

**Context**

`KB §6.3` — the worked example is what unblocks the other engineer. Andrew builds a request screen against a documented response shape while Tony builds the function behind it, and neither waits.

The documentation is only load-bearing if it is honest about **errors**. A screen built against the success shape alone has no empty state, no expired state, and no "someone else accepted first" state — which is exactly the state `RULE-REQUEST-05` guarantees will happen.

**Scope**

`docs/api/contracts.md`, one section per function from `KB §12`'s inventory. For each: required role, the Zod schema from `P0-T07`, a worked success request and response, and **every** error response with its status code and stable error string.

Document the shared error envelope and the standard failures every function has — `401 unauthenticated`, `403 forbidden`, `422 validation_failed` with field errors.

Mock fixtures under `docs/api/fixtures/` that mobile and admin can import while a function does not exist yet, so mock mode is real data in the real shape rather than a hand-written object.

**Acceptance criteria**

- [ ] Every function in `KB §12`'s inventory has a documented contract.
- [ ] Each states its required role.
- [ ] Each has a worked request and success response with realistic values.
- [ ] Each documents every error case, with status code and stable error string — not just the happy path.
- [ ] Mock fixtures exist and are importable by mobile and admin.
- [ ] Fixtures validate against the `P0-T07` schemas, asserted in a test.

**Tests** — every documented fixture parsed against its schema. A fixture that has drifted from its schema fails CI.

**Out of scope** — implementing the functions.

**Sync notes** — this is documentation of contracts owned by later tickets. When a function ships and its contract differs, the owning ticket updates this file in the same PR.

---

#### P0-T09 — Supabase local development and migration workflow

```yaml
id: P0-T09
title: "Supabase local development and migration workflow"
issueType: Task
owner: Tony
phase: 0
priority: Highest
jiraKey: TRIMR-18
dependsOn: [P0-T01, P0-T03]
affects: [P0-T10, P0-T11, P0-T12]
knowledgeBase: [ADR-001, ADR-002, ADR-008]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, database, supabase]
```

**Context**

Both engineers need a database they can break. Local Supabase with PostGIS, plus a migration workflow that makes "no dashboard edits" (`KB §7`) enforceable rather than aspirational.

The discipline this establishes: a schema change is a file in a PR. A schema change made in the hosted dashboard is invisible, unreviewable, and silently absent from the next engineer's local database.

**Scope**

`supabase/config.toml` and an infrastructure-only migration enabling PostGIS, since every discovery query depends on it (`ADR-008`) and a local database without it fails differently from production. The extension is enabled by the migration, not a manual dashboard step. Use a distinct QuickTrimr project ID and local ports so another project's stack can run alongside it.

Document and script: start and stop local Supabase, create a migration, apply migrations, reset to a clean state, and serve Edge Functions locally.

Root scripts: `db:start`, `db:reset`, `db:migrate`, `db:new`, `functions:serve`.

Migration naming and review conventions, and the rule that a migration is never edited after merge — a correction is a new migration.

Document how to link and push to the hosted project, and that only `main` does so.

Make the existing `workspace-contract` foundation probe invokable through the local Edge runtime, reusing its shared workspace identity. It returns no user, booking or financial data, and does not add a marketplace API. Keep gateway JWT verification enabled; no production credentials or role-specific access are needed for this constant-only probe.

**Contract example — local foundation probe**

`GET /functions/v1/workspace-contract` with the local stack's valid anon JWT in `Authorization: Bearer <local-anon-jwt>` returns `200` and `{"product":"QuickTrimr","surface":"function"}`. Missing or forged JWTs are denied by the gateway with `401`. An authenticated non-GET request returns `405` with `{"error":"Use GET."}`. The probe accepts no request fields and accesses no data or external service.

**Acceptance criteria**

- [ ] Local Supabase starts from a clean clone with a documented command.
- [ ] PostGIS is available locally, verified by a query.
- [ ] Creating, applying and resetting migrations each have a root script and documentation.
- [ ] Edge Functions can be served and invoked locally.
- [ ] `db:reset` produces an identical database from migrations alone — no manual step.
- [ ] Migration naming convention documented, including that merged migrations are never edited.
- [ ] No production credentials are required for any local workflow.

**Tests**

- Exercise the local command runner with a fake CLI: verify fixed local targets, reject remote/unknown flags, validate migration names, and propagate child failures. These tests run without Docker or credentials.
- From a clean checkout, start the isolated local stack; query `PostGIS_Full_Version()` and perform a geography calculation, then create and apply a scratch migration using the root commands.
- Reset twice and compare normalized schema fingerprints and migration history, with seed loading disabled for this foundation ticket. Confirm the same extension-only schema returns without a dashboard edit.
- Serve and invoke the real local foundation probe; assert its exact response, missing/forged JWT denial and method rejection. Do not print local private keys.
- Keep live Docker checks explicit and separate from the existing credential-free CI suite; document commands and observed outputs in `docs/qa/P0-T09.md`.

**Out of scope** — the schema itself (`P0-T10`); RLS (`P0-T11`); seed data (`P0-T12`); staging (`P6-T09`).

**Sync notes** — `P0-T10` through `P0-T12` all run through this workflow. `P0-T10` follows the extension migration and uses `extensions`-qualified PostGIS types/functions; `P0-T11` adds application RLS; `P0-T12` enables committed seed paths in config when it adds seed data. Local command wrappers never accept a hosted target. Generated traceability is left to the reviewed automation PR after merge.

---

#### P0-T10 — Core schema migration

```yaml
id: P0-T10
title: "Core schema migration"
issueType: Task
owner: Tony
phase: 0
priority: Highest
jiraKey: TRIMR-19
dependsOn: [P0-T06, P0-T09]
affects: [P0-T11, P0-T12, P1-T03, P2-T01, P2-T08, P3-T01, P3-T04, P4-T12, P4-T14]
knowledgeBase: [ADR-001, ADR-005, ADR-008, ADR-009, ADR-010, ADR-013, RULE-AVAIL-01, RULE-EARN-01, RULE-EARN-07, RULE-REVIEW-02, RULE-RELY-01, ENUM-USER-ROLE, ENUM-VERIFICATION-STATUS, ENUM-BOOKING-TYPE, ENUM-BOOKING-STATUS, ENUM-REQUEST-STATUS, ENUM-PAYMENT-STATUS, ENUM-EARNING-STATUS, ENUM-PAYOUT-STATUS, ENUM-AVAIL-STATUS, ENUM-DISPUTE-STATUS, ENUM-RELIABILITY-LEVEL]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, database, supabase]
```

**Context**

The starting tables, core relationships and enum sets are decided (`KB §10`, `KB §11`), so this is buildable now. This is the minimal foundation, not a full feature schema: profile/contact fields, catalogue content, deadlines, provider references and payout allocation/retry mappings ship with their owning features (`KB §6.3`).

What is **not** baked in here: any undecided number. No commission default, no refund percentage, no reliability threshold. Those are config (`KB §13`) and per-booking snapshots (`ADR-009`), and a column default is not the place to record a business rule nobody has agreed — a default silently becomes the rule, and nobody reviews a default.

Money columns are integer cents throughout. A `numeric` money column in this migration is the defect `ADR-009` exists to prevent, and it is far cheaper to prevent here than to migrate after the first real payment.

**Scope**

Enable `postgis` and `pgcrypto`.

Postgres enum types from `packages/shared` (`P0-T06`) — values must match exactly.

The tables in `KB §11`: `profiles`, `client_profiles`, `barber_profiles`, `client_addresses`, `service_categories`, `barber_services`, `available_now_sessions`, `booking_requests`, `bookings`, `booking_services`, `booking_status_history`, `payments`, `barber_earnings`, `payout_batches`, `payout_batch_items`, `disputes`, `reviews`, `notifications`, `audit_logs`, `barber_reliability_events`, `barber_reliability_state`.

Shape requirements:

- Every monetary column is `integer` cents. Name them so the unit is unmissable: `gross_cents`, `commission_cents`, `barber_net_cents`, `refunded_cents`.
- `bookings` carries its own snapshots: `service_price_cents`, `commission_pct_snapshot`, and the derived amounts (`ADR-009`).
- Location columns are `geography(Point, 4326)`, with GiST indexes on `available_now_sessions` and `barber_profiles` service area.
- `booking_status_history` records booking, from-status, to-status, actor id, actor role, reason, timestamp (`ADR-010`).
- `audit_logs` records actor id, actor role, action, entity type, entity id, previous value, new value, reason, timestamp, metadata (`ADR-013`).
- `payments` and `barber_earnings` are separate tables. They hold different numbers and must not be merged.
- Foreign keys everywhere, with deliberate `on delete` behaviour. A booking is never cascade-deleted by removing a user — financial history outlives an account.
- `created_at` / `updated_at` on every table, with an `updated_at` trigger.
- Unique constraints that enforce a rule rather than describing one: one earning per booking (`RULE-EARN-01`), one review per booking (`RULE-REVIEW-02`), one active Available Now session per barber (`RULE-AVAIL-01`, partial unique index on status).
- Indexes for the access patterns in `KB §11`: booking status, barber id, client id, booking type, created date, session status, payment status, dispute status.
- Enable RLS immediately on all 21 tables, with no access policies yet: deny-all is the foundation (`ADR-001`). `P0-T11` adds authorised access, not the first moment data becomes protected. Revoke client `TRUNCATE`, which RLS does not govern.
- Enforce append-only `booking_status_history`, `audit_logs` and `barber_reliability_events`; reject update, delete and truncate, including through privileged application paths. They still carry both timestamps, but a correction is another row, never an update.
- Use conservative `ON DELETE RESTRICT` relationships. This prevents accidental loss, not a completed account-erasure workflow. Actor references may be null for server-originated events; do not invent a fourth user role or attribute a timer to a human. Later handlers must record truthful reasons/metadata.

**Contract example — baseline API denial**

With a real local authenticated user A's JWT, `GET /rest/v1/bookings?select=*&id=eq.<user-B-booking-id>` returns `200 []`; `PATCH`/`DELETE` of that row with `Prefer: return=representation` return `200 []` and leave the stored row unchanged. `POST` of an otherwise valid new row returns `403` with PostgreSQL code `42501`. The same deny-all contract applies to every starting table, including a user's own rows, until `P0-T11` introduces access policies. The verifier uses disposable local users/fixtures and never hosted credentials.

**Acceptance criteria**

- [ ] Migration applies cleanly to an empty database and `db:reset` reproduces it exactly.
- [ ] Every Postgres enum matches its `packages/shared` tuple exactly — asserted by a test, not by eye.
- [ ] **Every monetary column is an integer type.** A `numeric`, `float` or `money` column anywhere in the migration fails this criterion.
- [ ] Booking price and commission snapshot columns exist on `bookings`.
- [ ] PostGIS is enabled and location columns are `geography(Point, 4326)` with GiST indexes.
- [ ] A partial unique index prevents a second active Available Now session per barber.
- [ ] Unique constraints prevent a second earning per booking and a second review per booking.
- [ ] `booking_status_history` and `audit_logs` carry every field listed in `ADR-010` and `ADR-013`.
- [ ] No column default encodes an undecided value — no commission, refund, or reliability number appears anywhere in the migration.
- [ ] Foreign keys exist with deliberate delete behaviour; deleting a user does not cascade-delete bookings or payments.
- [ ] All 21 tables have RLS enabled; real authenticated cross-user API requests cannot read, insert, update or delete rows, and denied writes leave the database unchanged.
- [ ] History, audit and reliability events reject privileged update/delete/truncate; mutable tables' update triggers advance `updated_at`.

**Tests** — enum parity against `packages/shared` both in committed SQL and live PostgreSQL catalogs; column-type assertions; duplicate inserts and repeated genuinely parallel inserts proving each unique constraint; live FK/delete-retention tests, timestamp and append-only checks; authenticated API denial for all 21 tables/every verb, asserting raw bodies and unchanged database state. Keep Docker tests explicit, separate from credential-free CI; record reset/replay and test output in `docs/qa/P0-T10.md`.

**Out of scope** — RLS policies (`P0-T11`); seed data (`P0-T12`); any feature-specific column, which ships with its feature (`KB §6.3`).

**Sync notes** — nine tickets write to these tables. Later tickets add columns via their own migrations; this one establishes the shape and the conventions they follow. `P0-T11` must preserve immediate deny-all protection and append-only enforcement while adding policies; `P0-T12` seeds only fields actually delivered. Payout items are per-barber obligations (`RULE-EARN-07`); `P3-T10` owns their earning-allocation and retry guards, not this foundation. Generated sections 8/9 remain untouched on this feature branch.

---

#### P0-T11 — Baseline RLS policies

```yaml
id: P0-T11
title: "Baseline RLS policies"
issueType: Task
owner: Tony
phase: 0
priority: Highest
jiraKey: TRIMR-20
dependsOn: [P0-T10]
affects: [P0-T12, P1-T01, P1-T02, P1-T03, P2-T10, P4-T01, P4-T02, P5-T02]
knowledgeBase: [ADR-001, ADR-013, ROLE-CLIENT, ROLE-BARBER, ROLE-ADMIN, RULE-ADMIN-01, RULE-ONBOARD-01, RULE-ONBOARD-05]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, database, security]
```

**Context**

RLS is the access model (`ADR-001`), not a second layer behind the API. A missing policy leaks a client's home address to a barber who was never booked — a privacy breach under the Australian Privacy Act, and a physical safety problem before it is a legal one.

**Enable RLS on every table, without exception.** A table with RLS enabled and no policy denies everything, which is the correct failure mode: a feature that cannot read its own table gets noticed in an hour. A table with RLS off leaks silently for months.

The role comes from the verified JWT and the server's own lookup, never a claim the client can set.

**Scope**

`alter table ... enable row level security` on all 21 tables from `P0-T10`.

A security-definer helper that resolves the current user's role from `profiles`, used by every policy. Never read a role from JWT app metadata a client can influence.

Baseline policies per `KB §11`:

- **Client** — own `profiles`, `client_profiles`, `client_addresses`, own `booking_requests`, `bookings`, own `payments` in safe form, own `disputes`, own `reviews`.
- **Barber** — own `profiles`, `barber_profiles`, `barber_services`, own `available_now_sessions`, requests addressed to them, own `bookings`, own `barber_earnings`, own reviews.
- **Public barber data** — exposed through a view or a policy returning public columns only (`RULE-ONBOARD-05`). Never by a client selecting fewer columns.
- **Admin** — read access to operational tables, gated on the resolved admin role.
- **No table is broadly readable.** `payments`, `payout_batches`, `payout_batch_items`, `audit_logs`, `booking_status_history`, `barber_reliability_events` are not client- or barber-readable except where a rule says so.
- **`audit_logs` has no update or delete policy at all** (`ADR-013`). The absent policy is the enforcement.

This baseline is **read-only** for authenticated application users, including admins. There are no insert/update/delete policies: identity, role, verification, status, money and sensitive writes remain with authorised server handlers. Feature-specific non-sensitive write policies, if required, ship with their feature. Preserve P0-T10's append-only triggers and revoked `TRUNCATE`.

Use explicit read grants for the columns delivered by P0-T10, not a table-wide grant that silently exposes a later private column. `public_barber_profiles` is a read-only, security-barrier projection of barber IDs only: no public name/photo fields exist yet, and exact service-area coordinates are private. This is not discovery or a claim of Connect eligibility. Future profile fields require explicit publication in their owning migration.

`client_payments` is a read-only, security-barrier projection of the caller's own booking-linked payments: `id`, `booking_id`, `status`, `gross_cents`, `refunded_cents`, `created_at`, `updated_at`. Clients have no base-table payment read policy; provider/private fields added later cannot leak through a direct select or this explicit projection. Admin reads the base table through its role-gated policy.

Other non-admin baseline reads are exactly the lists above. Categories, booking services, notifications, reliability tables and payout internals stay deny-all for non-admins until their owning feature adds the required policy. Client addresses/contact are never exposed to barbers by this foundation; the accepted-active projection belongs to booking-view features once those fields/relationships exist.

**Contract examples — actual local PostgREST**

- Authenticated client A: `GET /rest/v1/bookings?id=eq.<own-booking-id>&select=*&limit=1` returns `200 [{...own booking...}]`; the same query for B's booking returns `200 []`.
- A: `GET /rest/v1/client_payments?booking_id=eq.<own-booking-id>&select=*&limit=1` returns only the seven safe columns above; B's payment returns `200 []`. Direct `GET /rest/v1/payments?select=*&limit=1` returns `200 []` for clients/barbers.
- Client/barber with a database profile: `GET /rest/v1/public_barber_profiles?id=eq.<barber-id>&select=*&limit=1` returns `200 [{"id":"<barber-id>"}]`, never service area or private fields. A missing profile is fail-closed; anonymous access is denied.
- Database-authorised admin: `GET /rest/v1/audit_logs?select=*&limit=1` can return operational rows. Client/barber A returns `200 []`, even with signed JWT user/app metadata claiming admin.
- Every authenticated role: direct `POST` of a structurally valid table row returns `403`, code `42501`; `PATCH`/`DELETE` with `Prefer: return=representation` return `200 []`, leaving rows unchanged, including own rows. Views grant SELECT only and reject all writes. Forged JWTs fail authentication with `401`.

A reusable test helper that runs a query as a given user and asserts denial.

**Acceptance criteria**

- [ ] RLS is enabled on all 21 tables — asserted by a query against `pg_tables`, not by inspection.
- [ ] Client A cannot read or write client B's profile, addresses, bookings, requests, payments, disputes or reviews — **verified at the API for every verb**.
- [ ] Barber A cannot read barber B's profile, services, sessions, bookings or earnings.
- [ ] A barber cannot read a booking request not addressed to them.
- [ ] A client cannot read any barber's private columns; public barber data comes only from the view or public-column policy.
- [ ] A non-admin cannot read `audit_logs`, `payout_batches`, `payout_batch_items` or `booking_status_history`.
- [ ] **No client can update or delete an `audit_logs` row** — no such policy exists.
- [ ] No policy reads a role from a client-settable JWT claim.
- [ ] A cross-user denial test helper exists and is reused by later tickets.
- [ ] Own-user and admin positive reads are proven alongside denials; no-profile, anonymous and forged-JWT callers fail closed, and signed metadata cannot elevate a role.
- [ ] All direct writes remain denied, even for own rows/admins; view writes and newly added private-column reads fail closed, with unchanged stored-row evidence.

**Tests** — real authenticated cross-user denial for every table/every verb plus own-user/admin positives, including HEAD count privacy and denied PUT/merge-upsert routes; raw projection field allowlists and base-table/embedding bypass attempts; signed user/app metadata privilege forgery, database role grant/revocation without JWT refresh, missing profiles, anon and invalid JWTs; denied own/admin writes and unchanged database snapshots; read-only view grants, private-column additions and preserved immutable evidence. Reuse local target/reset/Auth/HTTP tooling; keep Docker tests explicit, with commands/output in `docs/qa/P0-T11.md`. A UI-only denial does not count.

**Out of scope** — feature-specific policies, which ship with their feature; admin dashboard implementation (Phase 5).

**Sync notes** — every later ticket that adds a table adds its policies and its denial test. This ticket establishes the helper and the pattern they follow. `P0-T10` already enables RLS, revokes application `TRUNCATE`, and enforces append-only history/audit/reliability events. Preserve those guards; the core verifier now exercises own-user/admin positives and cross-user negatives through the reusable `scripts/db/api-test-helpers.mjs`. The role helper is private, not a public RPC: `P1-T02` can query its verified caller's own profile role, with RLS invoking that same database-backed resolver. New fields need deliberate column grants and public/safe projections. Any feature enabling direct writes must narrow writable columns before adding a policy; never let a profile form update role/verification or a booking form update status/money. `P0-T12` seeds with privileged local SQL, not by relaxing client policies. `P2-T10`/`P4-T01`/`P4-T02` must preserve raw embedding/contact/location boundaries; accepted-active contact exposure remains with its owning feature. Generated indexes update only through the reviewed main automation.

---

#### P0-T12 — Seed data for local development

```yaml
id: P0-T12
title: "Seed data for local development"
issueType: Task
owner: Tony
phase: 0
priority: Medium
jiraKey: TRIMR-21
dependsOn: [P0-D01, P0-T10, P0-T11]
affects: [P0-T17, P5-T01, P5-T04]
knowledgeBase: [ADR-001, ADR-008, ADR-009, ADR-010, ADR-013, RULE-SERVICE-05, RULE-PAY-11, ENUM-USER-ROLE, ENUM-VERIFICATION-STATUS, ENUM-BOOKING-TYPE, ENUM-BOOKING-STATUS, ENUM-REQUEST-STATUS, ENUM-PAYMENT-STATUS, ENUM-EARNING-STATUS, ENUM-PAYOUT-STATUS, ENUM-AVAIL-STATUS, ENUM-DISPUTE-STATUS, ENUM-RELIABILITY-LEVEL]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, database]
```

**Context**

Admin pages and mobile screens are built against seed data long before real bookings exist (`KB §6.3`). Seed data that only covers the happy path produces UIs that break on the first refund.

**This depends on `P0-D01`** — seeding service categories requires knowing which categories launch (`RULE-SERVICE-05`). Seeding invented categories means every screen is built against a catalogue that changes, and price bounds that do not exist.

**Scope**

User-confirmed foundation-only scope (Option A, 2026-10-08), consistent with P0-T10/P0-T11's Sync notes. Idempotent, re-runnable SQL under `supabase/seed/`, loaded by local `db:reset`, with name-derived deterministic UUIDs and fixed timestamps. A non-destructive `db:seed` applies the same committed file to the named local QuickTrimr database. Existing IDs are never updated or deleted, including immutable evidence; reset is how to restore modified fixtures.

Populate all 21 delivered tables: synthetic Auth/profile identities including an admin, two clients, and barbers spanning every verification/reliability level; address geography; five category identities explicitly mapped to the approved `RULE-SERVICE-05` slugs in the fixture source; barber services with in-bound example prices; every request, booking, payment, earning, payout, Available Now and dispute status; booking-service snapshots; a history row per booking; payout items; reviews; notifications; reliability events; and audit logs. Share enum tuples and SQL serialization with the existing verifiers. Amounts are illustrative snapshots of the documented worked example, not a second financial rules engine or defaults.

Geography is synthetic, clustered around one Sydney metro origin at varying offsets. A documented test-only radius query uses PostGIS and returns some but not all fixture barbers, with a bounded result. It does not implement discovery eligibility, precision or production radius rules.

Auth emails use `@example.com`; no passwords, provider IDs, credentials, real names, phones or street/unit addresses are committed. Seed Auth rows are relationship fixtures, not login-ready accounts. Tests obtain disposable, real local Auth sessions without committed passwords. No client policies, role assignment API, schema columns or provider integrations are added.

Explicitly deferred until their owning feature migrations: catalogue slug/name/order/bounds columns (`P1-T10`), profile/contact fields (`P1-T04`/`P1-T06`), address text (`P1-T05`), Connect IDs/capabilities/restrictions (`P1-T07`/`P1-T09`), and review content/visibility (`P4-T14`). Verification and reliability enum fixtures do not prove Stripe eligibility, restricted-Connect exclusion or hidden-review behaviour. Those tickets must extend the seed and its tests in the same feature PR.

**Acceptance criteria**

- [ ] Local `db:reset` loads the committed seed; a second `db:seed` changes no seeded row, count or timestamp, proven by a full application/Auth-fixture data fingerprint. A second clean reset reproduces that fingerprint.
- [ ] Exactly five category IDs map to the approved `RULE-SERVICE-05` slugs in the fixture source, and seeded service prices lie within those approved bounds. No absent catalogue fields are invented or claimed.
- [ ] **Every value of `ENUM-BOOKING-STATUS` has at least one booking.** A status with no seed row is a UI state nobody sees before production.
- [ ] Every value of `ENUM-PAYMENT-STATUS` and `ENUM-EARNING-STATUS` is represented, including `capture_failed` and `reversed`.
- [ ] Every verification, request, Available Now, payout, dispute and reliability enum value is represented; every delivered table has at least one row. No fixture claims to enforce future Connect/discovery/review behaviour.
- [ ] A bounded PostGIS radius query on clustered fixture geography returns both in-radius and out-of-radius cases; the live plan can use the existing GiST index.
- [ ] All Auth-fixture emails are synthetic `@example.com`; no committed passwords, tokens, real contact fields or provider identifiers. Geography is generated from documented synthetic offsets, not copied from customer data.
- [ ] UUIDs derive from stable case names, not enum order/randomness; timestamps are fixed. Regeneration and two resets preserve identities.
- [ ] RLS/column grants and append-only guards remain unchanged. Real local authenticated own/admin positive and cross-user read/write denial checks run on seeded rows; immutable records reject privileged mutation.
- [ ] Re-running the seed preserves an edited mutable fixture, an appended correction, and unrelated rows. A failed seed application rolls back atomically; seed commands reject target overrides.
- [ ] The seed is documented, including restoring fixtures, adding a case, verifier cleanup and the feature-owned deferred coverage.

**Tests** — credential-free deterministic generation/committed-SQL parity, enum coverage, approved catalogue mapping/bounds, FK/snapshot consistency and local-command safety; explicit Docker reset/reseed/reset full-data fingerprints, non-destructive rerun/atomic rollback, bounded PostGIS/plan evidence, real authenticated seeded-row RLS/API checks and immutable-evidence denials. Preserve and re-run core/RLS/replay checks; they use an explicit unseeded local reset and clean up disposable rows. Record per-criterion output in `docs/qa/P0-T12.md`.

**Out of scope** — production or staging data; performance-volume data; feature schema, APIs/UI, business transitions, Stripe calls, discovery eligibility and review moderation.

**Sync notes** — `P0-T17`/`P5-T01`/`P5-T04` consume stable IDs, core relationships and full status coverage only; rendered contact/catalogue/provider/review fields remain feature-owned. Adding an enum value requires a coherent seed case and tests, not automatically inventing its financial meaning. `P1-T04`/`P1-T05`/`P1-T06`/`P1-T07`/`P1-T09`/`P1-T10`/`P4-T14` extend the committed seed with their delivered fields and safe grants; preserve category IDs and existing evidence. Reruns insert missing IDs only, never repair evidence by mutation. P0-T10/P0-T11 verifiers explicitly reset without seed data so their isolated constraint/denial fixtures remain meaningful. No upstream product rule changes; generated indexes remain for the reviewed main automation.

---

#### P0-T13 — Expo mobile app shell

```yaml
id: P0-T13
title: "Expo mobile app shell"
issueType: Task
owner: Andrew
phase: 0
priority: Highest
jiraKey: TRIMR-22
dependsOn: [P0-T01]
affects: [P0-T14, P0-T15, P1-T01, P6-T01, P6-T10]
knowledgeBase: [ADR-003, ADR-007]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, mobile]
```

**Context**

One Expo app carries both journeys, role-switched (`KB §3.1`). The routing structure decided here determines whether "client" and "barber" are two coherent apps sharing a binary, or one app with role checks scattered through every screen.

**Scope**

Expo with TypeScript and Expo Router. Route groups: `(auth)` for unauthenticated, `(client)` and `(barber)` for the two authenticated journeys, and a shared `(modals)` group.

A root layout that routes on auth state and role, with a defined state for authenticated-but-onboarding-incomplete — a user who signed up and closed the app mid-onboarding is the common case, not the edge case.

Feature folder structure under `src/features` per `KB §7`.

Verify that `@quicktrimr/shared`, `@quicktrimr/validation` and `@quicktrimr/ui` all resolve inside the Expo bundler, which is the integration most likely to need Metro configuration.

**Acceptance criteria**

- [ ] The app runs on iOS simulator and Android emulator from a clean clone.
- [ ] Expo Router is configured with `(auth)`, `(client)`, `(barber)` and `(modals)` groups.
- [ ] The root layout routes on auth state and role, with placeholders behind each.
- [ ] An authenticated user with incomplete onboarding lands somewhere defined, not a blank screen.
- [ ] All four shared packages import and resolve through the Expo bundler.
- [ ] Feature folder structure matches `KB §7`.
- [ ] No feature implementation beyond placeholders.

**Tests** — a route-access matrix covering signed-out, incomplete-onboarding, client and barber
states; a structural test asserting every required route group exists and every shared workspace
package is imported; Android and iOS bundle exports; launch from a clean clone on both an iOS
simulator and Android emulator.

**Out of scope** — auth (`P1-T01`); UI primitives (`P0-T14`); state management (`P0-T15`); push (`P6-T01`).

**Sync notes** — every mobile ticket adds routes inside these groups.

---

#### P0-T14 — Shared mobile UI primitives

```yaml
id: P0-T14
title: "Shared mobile UI primitives"
issueType: Task
owner: Andrew
phase: 0
priority: High
jiraKey: TRIMR-23
dependsOn: [P0-T06, P0-T13]
affects: [P1-T04, P1-T06, P2-T05, P2-T09, P2-T11, P3-T05, P4-T01, P4-T10]
knowledgeBase: [ADR-007, ENUM-BOOKING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, mobile]
```

**Context**

Every user-facing screen in this backlog requires loading, error and empty states (backlog §5). If those are not primitives, they are reimplemented per screen, inconsistently, and the empty state is the one that gets skipped.

`StatusBadge` matters more than it looks: booking status appears on at least eight screens across both journeys, and a status the badge does not know about must render as something rather than nothing.

**Scope**

In `packages/ui`, typed and composable: `Button` with loading and disabled states, `TextInput` with error display, `Screen` wrapper handling safe area and keyboard, `Card`, `Badge`, `StatusBadge` mapping every `ENUM-BOOKING-STATUS` value to a label and colour, `Avatar`, `LoadingState`, `EmptyState` taking a message and an optional action, `ErrorState` with a retry callback, `BottomSheet`, and `ConfirmDialog`.

`ConfirmDialog` supports a body that states a consequence, because `RULE-CANCEL-06` requires the financial outcome to be shown before a cancellation is confirmed.

A theme module for colour, spacing and typography — no hardcoded hex values in feature code.

An example screen or Storybook-equivalent demonstrating each.

**Acceptance criteria**

- [ ] Every primitive listed exists in `packages/ui`, typed, with no `any`.
- [ ] `Button` renders a loading state that is not tappable.
- [ ] `StatusBadge` maps **every** `ENUM-BOOKING-STATUS` value; an unknown value renders a defined fallback rather than crashing or rendering blank.
- [ ] `EmptyState` and `ErrorState` both take an action, and `ErrorState`'s retry is wired.
- [ ] `ConfirmDialog` supports a consequence body and a destructive variant.
- [ ] Theme values are centralised; no hex literal appears in a feature folder.
- [ ] An example surface demonstrates each primitive.

**Tests** — a render test per primitive; a test asserting `StatusBadge` covers every enum value, driven from the `packages/shared` tuple so adding a status fails the test until the badge handles it.

**Out of scope** — final branding; animation; admin components (`P0-T17`).

**Sync notes** — eight feature tickets compose these. A prop change ripples through all of them.

---

#### P0-T15 — Mobile state management foundations

```yaml
id: P0-T15
title: "Mobile state management foundations"
issueType: Task
owner: Andrew
phase: 0
priority: High
jiraKey: TRIMR-24
dependsOn: [P0-T07, P0-T13]
affects: [P2-T05, P2-T06, P2-T09, P4-T01, P4-T06]
knowledgeBase: [ADR-003]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, mobile]
```

**Context**

`ADR-003` splits state by kind, and the split only holds if the wiring makes the wrong choice inconvenient. The failure mode it prevents is real: booking status copied into a Zustand store, then rendered from there after the server has already moved on — a client looking at a stale "pending" for a booking that was accepted two minutes ago.

**Scope**

TanStack Query provider with deliberate defaults: retry policy, stale time, and refetch-on-focus set with booking data in mind. A booking screen that does not refresh on focus shows a stale status; one that refetches aggressively burns battery and quota.

A query-key factory in one module, so invalidation after a mutation is a call rather than a guess at a key someone typed elsewhere.

A typed mutation helper that calls an Edge Function, parses the response with the `P0-T07` schema, and surfaces the shared error envelope — so every screen handles errors the same way.

Zustand store pattern with an example booking-draft store: selected barber, service, address, booking mode. Draft state, not server state.

React Hook Form with the Zod resolver, demonstrated on one real form using a `packages/validation` schema.

`docs/architecture/state.md` stating the rule plainly: **server truth is never mirrored into Zustand.**

**Acceptance criteria**

- [ ] TanStack Query provider is configured with documented, deliberate defaults.
- [ ] A query-key factory exists and is the only place keys are constructed.
- [ ] A typed Edge Function mutation helper parses responses with a shared schema and surfaces the shared error shape.
- [ ] An example booking-draft Zustand store exists holding only draft state.
- [ ] React Hook Form with Zod resolver works on a real form using a shared schema.
- [ ] No Redux.
- [ ] `docs/architecture/state.md` documents the TanStack-versus-Zustand rule and the no-mirroring prohibition.

**Tests** — the mutation helper returning a typed error on a `422`; the query-key factory producing stable keys.

**Out of scope** — feature stores and queries, which ship with their features.

**Sync notes** — five tickets use the key factory and mutation helper.

---

#### P0-T16 — Next.js admin dashboard shell

```yaml
id: P0-T16
title: "Next.js admin dashboard shell"
issueType: Task
owner: Andrew
phase: 0
priority: Highest
jiraKey: TRIMR-25
dependsOn: [P0-T01]
affects: [P0-T17, P1-T02, P5-T01]
knowledgeBase: [ADR-007, RULE-ADMIN-01]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, admin]
```

**Context**

Admin is web-only (`KB §3.2`) and is the most sensitive surface in QuickTrimr: it can refund money, resolve disputes and override booking statuses.

The structural decision made here is that **admin data is fetched server-side after the role is verified** (`RULE-ADMIN-01`). A client-side fetch that a guard hides is not access control — the data has already crossed the network to a browser that was never entitled to it.

**Scope**

Next.js App Router with TypeScript, Tailwind and shadcn/ui.

Route structure with an `(admin)` group behind a layout that verifies the admin role **server-side** before rendering or fetching. A placeholder guard now; `P1-T02` makes it real.

Server component by default. A client component requires a reason — interactivity — not convenience.

Verify shared package resolution through the Next bundler.

Vercel deployment configuration, without deploying.

**Acceptance criteria**

- [ ] The admin app runs locally from a clean clone.
- [ ] Tailwind and shadcn/ui are configured and render a component.
- [ ] An `(admin)` route group exists behind a layout that checks the role server-side.
- [ ] **No admin data is fetched before the role check resolves** — verified by inspecting the network on an unauthorised load, which must contain no operational data.
- [ ] Shared packages resolve through the Next bundler.
- [ ] Server components are the default; any client component is justified in a comment.
- [ ] Vercel configuration exists.

**Tests**

- Clean install, typecheck, lint and production build; serve the built app locally.
- Guard unit tests: deny missing sessions and each non-admin role; allow only the server-resolved admin role; never continue rendering while verification is pending or fails.
- Direct HTTP and React Server Component requests, including forged role headers/cookies/query parameters, expose no protected content or operational data.
- Browser test of the public access screen and denied dashboard navigation; Tailwind styling and shadcn button render. Loading, error/retry and protected empty states have component tests.
- Shared-package imports execute through the Next bundler; server/client boundaries and Vercel configuration have regression checks.

**Out of scope** — real auth (`P1-T02`); admin components (`P0-T17`); any data screen (Phase 5).

**Sync notes** — every Phase 5 ticket mounts inside this group and inherits its guard. Next layouts and nested pages can render independently: `P0-T17`, `P1-T02` and `P5-T01` must also call the server-only guard at every protected page, data loader and action boundary before fetching. `P1-T02` replaces the deny-all session resolver with verified identity and a database role lookup; this shell has no authentication bypass.

---

#### P0-T17 — Admin layout and shared admin components

```yaml
id: P0-T17
title: "Admin layout and shared admin components"
issueType: Task
owner: Tony
phase: 0
priority: High
jiraKey: TRIMR-26
dependsOn: [P0-T06, P0-T16]
affects: [P5-T01, P5-T02, P5-T03, P5-T04, P5-T06, P5-T09, P5-T11, P5-T12]
knowledgeBase: [ADR-007, ADR-013, ENUM-BOOKING-STATUS, ENUM-PAYMENT-STATUS, ENUM-DISPUTE-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, admin]
```

**Context**

Eight Phase 5 tickets are list-and-detail screens over different entities. Built as primitives once, they are consistent and each screen is a day; built per screen, they are eight different tables with eight pagination bugs.

`ConfirmDialog` here carries real weight: it is what stands between an admin and an irreversible refund. `RULE-ADMIN-02` and `RULE-DISPUTE-04` both require a recorded reason, so the dialog must be able to demand one.

**Scope**

Admin shell: sidebar, header with the signed-in admin, and content area.

Components: `DataTable` wrapping TanStack Table with server-side pagination, sorting and filtering — never client-side over a full fetch (`RULE-ADMIN-04`); `StatusBadge` covering booking, payment, earning, payout and dispute statuses; `PageHeader`; `DetailPanel`; `ConfirmDialog` supporting a **required reason field** and a financial-impact summary; `LoadingState`; `EmptyState`; `ErrorState`; and a `Money` component rendering integer cents in a consistent format.

The `Money` component is the only place cents become a displayed string. A number formatted ad hoc in one screen and differently in another is how an admin reads $4.50 as $450.

All of it works against `P0-T12`'s seed data.

**Acceptance criteria**

- [ ] The admin shell renders with sidebar, header and content area.
- [ ] `DataTable` paginates, sorts and filters **server-side**; no screen fetches a full table and filters in the browser.
- [ ] `StatusBadge` covers every value of every status enum it is used with, with a defined unknown fallback.
- [ ] `ConfirmDialog` can require a reason and block confirmation until it is provided.
- [ ] `ConfirmDialog` can display a financial-impact summary.
- [ ] `Money` renders integer cents consistently and is the only formatter used.
- [ ] Every component renders correctly against seed data, including empty and error cases.
- [ ] No duplicate table or badge implementation exists outside `packages/ui` or the admin component folder.

**Tests** — a render test per component; a `StatusBadge` coverage test driven from the shared enum tuples; a `Money` test covering zero, a round dollar, a partial cent boundary and a negative.

**Out of scope** — real data integration (Phase 5); admin auth (`P1-T02`).

**Sync notes** — eight Phase 5 tickets compose these. A `DataTable` prop change touches all of them.

---

#### P0-T18 — Provision Stripe test mode, Connect and Google Cloud

```yaml
id: P0-T18
title: "Provision Stripe test mode, Connect and Google Cloud"
issueType: Task
owner: Tony
phase: 0
priority: Highest
jiraKey: TRIMR-27
dependsOn: [P0-D05, P0-T03]
affects: [P1-T07, P1-T09, P2-T04, P3-T01, P3-T03, P3-T11, P4-T05, P6-T09]
knowledgeBase: [ADR-006, ADR-008, RULE-PAY-10, RULE-ETA-02, RULE-ONBOARD-04, RULE-EARN-05, RULE-EARN-07]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, stripe, maps, security]
```

**Context**

Six tickets across Phases 1 to 4 assume a Stripe account with Connect enabled and a Google Cloud project with three APIs. The previous backlog never created either — `P1-E03-T02` simply began calling Stripe Connect.

These have lead time. Stripe Connect requires platform settings and a completed platform profile; Google requires billing and per-API enablement. Discovering that on the morning someone starts `P1-T07` costs a day.

**Scope**

**Stripe test mode:**

- Enable Connect and choose the account configuration, informed by `ADR-006`, `RULE-EARN-05` and `RULE-EARN-07`. Demonstrate platform-controlled bank payouts compatible with the Monday run, platform-borne standard Connect/payout fees, separate transfer/payout identities and connected-account webhook delivery. Independent automatic payouts or on-demand controls must not bypass the approved policy. Record applicable settlement/minimum/holding constraints and secure bank-detail correction; stop if the actual configuration cannot support the policy, rather than silently changing it.
- Confirm manual-capture PaymentIntents are available, since `ADR-006` depends on them.
- Configure the Connect onboarding branding and return/refresh URLs.
- Create a webhook endpoint for local development and note the signing secret handling (`RULE-PAY-07`).
- Record which test cards exercise which failure: successful auth, auth that fails at capture, and a card requiring authentication. `P3-T02` and `P6-T07` both need a capture that genuinely fails.
- **Confirm the authorisation hold period on the account for supported payment methods.** It must cover the pending-request window through acceptance under `ADR-006`. Capture occurs on acceptance, so the appointment date and maximum booking horizon do not extend this hold.

**Google Cloud:**

- Project with billing, and Maps SDK, Places API and Routes API enabled.
- **Two separate keys.** A client key restricted by bundle id and referrer for map rendering; a server key with no client restriction, restricted by API, used only from Edge Functions (`ADR-008`, `RULE-ETA-02`).
- Quotas and budget alerts, so a throttling bug in `P4-T05` produces an alert rather than an invoice.

Record every variable name in `P0-T03`'s `.env.example`. **No key value is committed** — this ticket produces documentation and configuration, not secrets in the repo.

**Acceptance criteria**

- [ ] Stripe test-mode account exists with Connect enabled and the account type recorded with its reasoning.
- [ ] Test-mode evidence demonstrates the `RULE-EARN-07` payout controls and fee responsibility, distinguishes transfer funding from bank payout, and records applicable provider limits plus the bank-detail correction path without committing secrets or bank details.
- [ ] A manual-capture PaymentIntent can be created and captured in test mode, demonstrated.
- [ ] The **authorisation hold period is recorded** in `docs/architecture/` and checked against the configured pending-request windows. Any mismatch is raised before payment integration; it is not solved by changing the appointment horizon.
- [ ] Connect onboarding return and refresh URLs are configured.
- [ ] A test webhook endpoint receives a signed event locally, with signature verification demonstrated.
- [ ] Test cards for success, capture failure and authentication-required are documented.
- [ ] Google Cloud project exists with Maps SDK, Places and Routes enabled.
- [ ] **Two distinct Google keys exist**, client-restricted and server-restricted, documented with their restrictions.
- [ ] Quota limits and budget alerts are configured.
- [ ] Every variable name appears in `.env.example`; **no key value is committed anywhere.**

**Out of scope** — implementing Connect onboarding (`P1-T07`); payment code (Phase 3); live mode (`P6-T11`); staging projects (`P6-T09`).

**Sync notes** — eight tickets consume these credentials. The authorisation hold period discovered here informs `P3-T01`, `P3-T02` and `P3-T06`'s authorise-to-capture lifecycle; `P0-D08`'s maximum booking horizon is an operational limit on advance capture.

---

#### P0-T19 — Rename the product and repository to QuickTrimr

```yaml
id: P0-T19
title: "Rename the product and repository to QuickTrimr"
issueType: Task
owner: Andrew
phase: 0
priority: Highest
jiraKey: TRIMR-28
dependsOn: []
affects: []
knowledgeBase: [ADR-014]
blockedByTbc: []
labels: [quicktrimr, phase-0, foundation, product]
```

**Context**

The customer changed the product from its former name to QuickTrimr before implementation began. The
repository, source-of-truth documents, automation, package namespace, agent instructions and Jira
projection must agree before more tickets are created or implementation starts.

Jira is the one deliberate exception to a blind string replacement: the existing project key
`TRIMR` and issue keys such as `TRIMR-21` are stable external identifiers. Recreating issues to
change those keys would lose history and create duplicates.

**Scope**

Rename the canonical documents, product copy, GitHub repository, repo layout examples, package
scope, skills, labels, Jira epic summaries, and sync metadata to QuickTrimr. Update local Git remotes
after the GitHub repository rename. Update existing Jira issues in place and migrate legacy sync
metadata without forcing duplicate issue creation.

**Acceptance criteria**

- [ ] The knowledge base records QuickTrimr as the product name under `ADR-014`.
- [ ] Canonical document filenames and every internal reference use `QUICKTRIMR_*`.
- [ ] The GitHub repository is `TetriasTech/QuickTrimr`, and the local `origin` points to it.
- [ ] New package names use `@quicktrimr/*`, the repo layout uses `quicktrimr/`, and labels use `quicktrimr`.
- [ ] The Jira project key and every existing `TRIMR-*` issue key remain unchanged.
- [ ] The Jira project display name, epic summaries, issue content, and labels use QuickTrimr.
- [ ] Existing Jira tickets are updated in place; no existing ticket is recreated or duplicated.
- [ ] Repository search finds no stale former-brand use outside documented stable Jira identifiers and legacy migration compatibility.
- [ ] `node scripts/jira/generate-indexes.mjs --check` passes.
- [ ] Phase 0 create and update dry runs are reviewed before any Jira write.

**Tests** — ticket-graph validation; Phase 0 create dry run; Phase 0 update dry run with Jira credentials; repository-wide stale-brand search; Git remote verification.

**Out of scope** — changing the Jira project key or existing issue keys; implementing the mobile app, admin dashboard, backend, or Wix site.

**Sync notes** — this ticket changes the projection text for every existing Jira ticket. Run the
Phase 0 update in place before creating later phases, then update each later phase as it is created.

---
## Phase 1 — Auth, Profiles, Onboarding & Services

**Goal:** a barber can be created, Connect-verified, priced and made discoverable; a client can sign up and save an address. No bookings yet.

**Gate:** a barber exists end to end — profile, photo, service area, services with prices, Stripe Connect satisfied — and a client exists with a saved address. Until both are true, Phase 2 has nothing to search for.

---

#### P1-T01 — Client and barber authentication

```yaml
id: P1-T01
title: "Client and barber authentication"
issueType: Story
owner: Andrew
phase: 1
priority: Highest
jiraKey: null
dependsOn: [P0-T11, P0-T13, P0-T14, P0-T15]
affects: [P1-T03, P1-T04, P1-T06, P6-T01]
knowledgeBase: [ADR-001, ROLE-CLIENT, ROLE-BARBER, RULE-ONBOARD-01]
blockedByTbc: []
labels: [quicktrimr, phase-1, mobile, security]
```

**Context**

The entry point for both journeys. The decision that shapes everything downstream is **when and how a role is chosen**, because a user who picks "barber" and abandons onboarding must not be stuck, and a user must not be able to become a barber by editing a request.

`RULE-ONBOARD-01` — the profile row is created server-side from the verified JWT (`P1-T03`), never by the mobile app inserting into `profiles`. This ticket owns the auth surface; the profile row is `P1-T03`'s.

**Scope**

Sign up with email and password, log in, log out, and password reset, using Supabase Auth in `apps/mobile`.

Role selection at signup — client or barber — passed to `P1-T03`, which validates it against the allowed set server-side.

Session persistence across app restarts using secure storage. A session token in plain `AsyncStorage` is a token any other process on a rooted device can read.

Routing on auth state and role into the `(client)` / `(barber)` groups from `P0-T13`, including the incomplete-onboarding state.

Errors that are safe and useful: wrong password and unknown email must not be distinguishable, because a distinguishable response enumerates who has an account.

**Contract example** — sign-in failure surfaces

```jsonc
// invalid credentials — identical response for wrong password and unknown email
{ "error": "invalid_credentials" }

// email not confirmed
{ "error": "email_not_confirmed" }

// rate limited
{ "error": "too_many_attempts", "retryAfterSeconds": 60 }
```

**Acceptance criteria**

- [ ] A user can sign up as a client or as a barber, log in, and log out.
- [ ] Session persists across app restart and is stored in secure storage, not plain async storage.
- [ ] The app routes to `(client)` or `(barber)` by role, and to an onboarding route when the profile is incomplete.
- [ ] **A wrong password and an unknown email produce an identical response** — no account enumeration.
- [ ] Repeated failed attempts are rate limited with a safe message.
- [ ] Password reset works end to end.
- [ ] Loading states cover the auth check on cold start; the app never flashes a signed-out screen for a signed-in user.
- [ ] No auth secret appears in the bundle.
- [ ] A user cannot set their own role by modifying a request — role is validated server-side in `P1-T03`.

**Tests** — identical response for wrong-password versus unknown-email; session survives a restart; routing for each of client, barber, and incomplete-onboarding; a crafted request attempting to self-assign `admin` is rejected.

**Out of scope** — the profile row itself (`P1-T03`); profile completion forms (`P1-T04`, `P1-T06`); admin auth (`P1-T02`); social login; push registration (`P6-T01`).

**Sync notes** — `P1-T03` receives the role this screen collects. `P6-T01` registers a push token against the session established here.

---

#### P1-T02 — Admin authentication and route guard

```yaml
id: P1-T02
title: "Admin authentication and route guard"
issueType: Story
owner: Tony
phase: 1
priority: Highest
jiraKey: null
dependsOn: [P0-T11, P0-T16]
affects: [P5-T01, P5-T02, P5-T03, P5-T04, P5-T06, P5-T09, P5-T11, P5-T12, P5-T13]
knowledgeBase: [ROLE-ADMIN, RULE-ADMIN-01, ADR-013]
blockedByTbc: []
labels: [quicktrimr, phase-1, admin, security]
```

**Context**

Every Phase 5 ticket sits behind this guard. It is the single point where "admin" is decided, and it must be decided from the database, server-side, on every request.

The failure this prevents: a guard implemented client-side, where the browser has already received the booking list before deciding not to render it. Nine tickets inherit whichever way this is built.

**Scope**

Admin login in `apps/admin` using Supabase Auth against the same `profiles` table, with the role resolved by the security-definer helper from `P0-T11`.

A server-side guard in the `(admin)` layout that resolves the role **before** any data is fetched or rendered. Reusable, so a Phase 5 screen cannot accidentally opt out.

An unauthorised visitor gets a redirect or a safe error, never a partial render and never an error revealing whether the account exists.

Admin sign-in and sign-out write audit logs (`ADR-013`) — who accessed the operational dashboard and when is itself operational information.

Session expiry shorter than the mobile app's. An admin session that lives for weeks on a laptop is a standing risk that a barber's session is not.

**Contract example** — guard outcomes

```jsonc
// authenticated admin       → 200, page renders
// authenticated non-admin   → 403, redirect to /forbidden, no operational data in the response
// unauthenticated           → 302 to /login
// expired session           → 302 to /login?reason=expired
```

**Acceptance criteria**

- [ ] An admin can log in and log out of the admin dashboard.
- [ ] **A client or barber account cannot reach any `(admin)` route** — verified by logging in as each and requesting an admin URL directly.
- [ ] **No operational data appears in the response body for a non-admin request** — asserted on the raw response, not the rendered page.
- [ ] The role is resolved server-side from the database on every request, never from a client-settable claim.
- [ ] The guard is reusable and applied by the layout, so a new page inherits it without opting in.
- [ ] Admin sign-in and sign-out write audit log entries.
- [ ] Admin sessions expire on a shorter window than mobile, with the value documented.
- [ ] An expired session redirects to login rather than erroring.

**Tests** — direct URL requests as client, barber, unauthenticated and expired-session, each asserted on the raw response body for absence of operational data; a crafted request with a forged role claim is rejected.

**Out of scope** — admin feature screens (Phase 5); admin user management; SSO or MFA.

**Sync notes** — nine Phase 5 tickets inherit this guard. Weakening it weakens all of them at once.

---

#### P1-T03 — Profile creation and sync function

```yaml
id: P1-T03
title: "Profile creation and sync function"
issueType: Task
owner: Andrew
phase: 1
priority: Highest
jiraKey: null
dependsOn: [P0-T07, P0-T10, P0-T11, P1-T01]
affects: [P1-T04, P1-T06, P5-T02, P5-T03]
knowledgeBase: [ADR-002, ADR-013, RULE-ONBOARD-01, ROLE-CLIENT, ROLE-BARBER, ENUM-USER-ROLE, ENUM-VERIFICATION-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-1, backend, security]
```

**Context**

The one place a `profiles` row is created. `RULE-ONBOARD-01` puts it server-side because the alternative — the mobile app inserting its own profile — means the app chooses the user id and the role, and both are things a crafted request can lie about.

**Idempotency is the requirement, not a nicety.** This runs on every sign-in and on app resume. It must create on first call and be a no-op afterwards, including when two calls race on a cold start with a slow network.

**Scope**

`create-or-sync-profile` Edge Function.

The user id comes from the verified JWT. A user id in the request body is ignored — and if present and different, that is worth logging as a signal.

Role comes from the request but is validated against `ENUM-USER-ROLE` **minus `admin`**. A self-assigned admin role is rejected. Admin is granted out-of-band, never through a signup path.

Creates `profiles` plus the matching `client_profiles` or `barber_profiles` row, with `verification_status` at `not_started` (`ADR-005`).

Idempotent on the user id: create if absent, return existing otherwise. Safe under concurrent calls — use an upsert with a unique constraint, not check-then-insert.

Audit log on creation (`ADR-013`), not on every sync — an audit row per app resume is noise that buries the events that matter.

**Contract example** — `create-or-sync-profile`

```jsonc
// request — note: no userId. It comes from the JWT.
{ "role": "barber" }

// 200 — created
{ "id": "9f2c...", "role": "barber", "verificationStatus": "not_started",
  "onboardingComplete": false, "createdAt": "2026-08-05T04:11:22Z" }

// 200 — already existed, unchanged
{ "id": "9f2c...", "role": "barber", "verificationStatus": "verified",
  "onboardingComplete": true, "createdAt": "2026-07-02T09:14:00Z" }

// 422 — role not in the allowed set
{ "error": "validation_failed", "fields": { "role": "Must be client or barber" } }

// 403 — attempted admin self-assignment
{ "error": "forbidden" }

// 401
{ "error": "unauthenticated" }
```

**Acceptance criteria**

- [ ] Creates `profiles` and the role-specific profile row on first call.
- [ ] **The user id comes from the verified JWT; a `userId` in the body is ignored** — proven by sending another user's id and observing no effect.
- [ ] **A request with `role: "admin"` is rejected with 403** and creates nothing.
- [ ] A role outside `ENUM-USER-ROLE` returns 422 naming the field.
- [ ] Idempotent: the second call returns the existing profile and creates nothing.
- [ ] **Concurrent first calls create exactly one profile** — tested with real parallel requests, not sequential ones.
- [ ] An existing profile's role is never silently changed by a later call with a different role.
- [ ] Audit log written on creation only, not on every sync.
- [ ] `verification_status` starts at `not_started`.
- [ ] Unauthenticated calls return 401.

**Tests** — parallel first-call race producing one row; body-supplied user id ignored; admin self-assignment rejected; role-change attempt on an existing profile rejected; idempotent repeat call.

**Out of scope** — profile completion forms (`P1-T04`, `P1-T06`); Stripe Connect (`P1-T07`); admin role assignment.

**Sync notes** — `P1-T04` and `P1-T06` fill the rows this creates. `P5-T02` and `P5-T03` render them.

---

#### P1-T04 — Client profile onboarding

```yaml
id: P1-T04
title: "Client profile onboarding"
issueType: Story
owner: Andrew
phase: 1
priority: High
jiraKey: null
dependsOn: [P0-T14, P1-T03]
affects: [P1-T05, P2-T08, P5-T02]
knowledgeBase: [ADR-005, RULE-ONBOARD-02, ENUM-VERIFICATION-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-1, mobile]
```

**Context**

`ADR-005` — no identity verification at launch. The friction is not worth it for a client who is trying to book a haircut.

**What this ticket must not do is design it away.** The schema carries `verification_status` from `P0-T10`, and this flow leaves it at `not_started` rather than removing it. Turning Stripe Identity on later must be a flow change, not a migration across every client profile.

**Scope**

Client profile completion in `apps/mobile`: display name, mobile number, and optional avatar. Validated with a shared schema from `packages/validation`.

Mobile number format validated for the launch market and stored normalised, so `P4-T03`'s barber-facing contact display does not have to parse four formats.

The flow is resumable: a client who closes the app mid-onboarding returns to where they left off, which is the state `P0-T13`'s routing already anticipates.

Completion updates `client_profiles` and marks onboarding complete, which is what unlocks the `(client)` journey.

**Contract example** — `complete-client-profile`

```jsonc
// request
{ "displayName": "Sam Rivera", "mobile": "+61412345678" }

// 200
{ "id": "9f2c...", "displayName": "Sam Rivera", "mobile": "+61412345678",
  "onboardingComplete": true, "verificationStatus": "not_started" }

// 422
{ "error": "validation_failed",
  "fields": { "mobile": "Enter a valid Australian mobile number" } }

// 401
{ "error": "unauthenticated" }
```

**Acceptance criteria**

- [ ] A client can complete their profile and reach the client journey.
- [ ] Required fields are enforced; the client cannot proceed while one is missing.
- [ ] The form uses React Hook Form with a shared Zod schema — the same schema the function validates against.
- [ ] An invalid mobile number is rejected with a field-level message, both client-side and at the API.
- [ ] Mobile numbers are stored normalised.
- [ ] The flow is resumable after the app is closed mid-onboarding.
- [ ] `verification_status` remains `not_started` and the field is not removed (`ADR-005`).
- [ ] Loading and error states exist; a failed submit does not lose entered data.

**Tests** — mobile number validation including boundary formats; resume after interruption; profile completion unlocking the client journey; the API rejecting an invalid number that a modified client sent anyway.

**Out of scope** — addresses (`P1-T05`); Stripe Identity; payment methods (`P3-T01`).

**Sync notes** — `P1-T05` continues this flow. `P2-T08` requires a complete profile before a request.

---

#### P1-T05 — Client address management

```yaml
id: P1-T05
title: "Client address management"
issueType: Story
owner: Andrew
phase: 1
priority: High
jiraKey: null
dependsOn: [P0-T18, P1-T04]
affects: [P2-T05, P2-T08, P4-T03, P5-T02]
knowledgeBase: [ADR-008, RULE-ONBOARD-02, ROLE-CLIENT]
blockedByTbc: []
labels: [quicktrimr, phase-1, mobile, maps, security]
```

**Context**

A client address is where a stranger is sent. It is the most sensitive data QuickTrimr holds, and every downstream ticket that displays it does so under a narrow rule: a barber sees it only for an accepted, active booking (`ROLE-BARBER`).

Addresses need coordinates, because discovery is a PostGIS distance query from the service address (`ADR-008`, `RULE-DISCOVERY-01`). An address without a resolved point cannot be booked against, so geocoding is part of saving, not a later enrichment.

**Archive, never delete.** A booking snapshots its address, but the client's address list must not lose an entry that historical bookings and `P5-T02` still reference.

**Scope**

Address list, add, edit, and archive in `apps/mobile`.

Google Places autocomplete for entry, with the resulting place resolved to a `geography(Point, 4326)` stored on the row. Manual entry as a fallback, because autocomplete fails on new developments and rural addresses.

"Use my current location" where the permission is granted, with graceful handling of denial — a client who denies location must still be able to type an address and book.

Fields beyond the address itself: a label ("Home", "Mum's"), unit or apartment number, and access notes. Access notes matter more here than they look: a barber standing outside a locked apartment building calls the client, and that is the moment the product feels broken.

RLS: select, insert and update on `auth.uid() = client_id`. **No delete policy** — archiving is an update, and the absent policy is the enforcement.

**Contract example** — `create-client-address`

```jsonc
// request
{ "label": "Home", "line1": "12 Smith St", "unit": "4B",
  "suburb": "Richmond", "state": "VIC", "postcode": "3121",
  "lat": -37.8226, "lng": 144.9980,
  "accessNotes": "Buzzer 4B, gate code 1942" }

// 200
{ "id": "a71f...", "label": "Home", "line1": "12 Smith St", "unit": "4B",
  "suburb": "Richmond", "archivedAt": null, "createdAt": "2026-08-05T04:11:22Z" }

// 422 — coordinates missing or outside the supported region
{ "error": "validation_failed",
  "fields": { "lat": "Address could not be located" } }

// 409 — editing an archived address
{ "error": "address_archived" }

// 401
{ "error": "unauthenticated" }
```

**Acceptance criteria**

- [ ] A client can add, edit, archive and list addresses.
- [ ] Every saved address has resolved coordinates; an address that cannot be geocoded is rejected with a field-level message rather than saved unusable.
- [ ] Places autocomplete works, and manual entry works when it does not.
- [ ] "Use current location" works, and **denying the location permission still allows manual entry and booking.**
- [ ] Archiving removes the address from pickers; a booking referencing it still renders.
- [ ] Editing an archived address returns `409 address_archived`, not a 500.
- [ ] Archive is idempotent.
- [ ] **Client A cannot read, update or archive client B's address** — verified by calling as A with B's id, expecting denial rather than a leaked row.
- [ ] **No client can delete an address row** — no delete policy exists.
- [ ] The Google client key is used for autocomplete; no server key reaches the bundle.
- [ ] List, add and edit each have loading, error and empty states; the empty state prompts a first address.

**Tests** — cross-client denial on all four verbs; archive idempotency; archived addresses absent from the picker; geocode failure rejected; permission-denied path reaching a successful manual save.

**Out of scope** — booking (`P2-T08`); barber-facing address display (`P4-T03`); map rendering (`P2-T07`).

**Sync notes** — `P2-T08` snapshots these fields onto a request, `P4-T03` reveals them to a barber under a narrow rule, `P5-T02` renders them to admin. Changing the stored shape reaches all three.

---

#### P1-T06 — Barber profile and service area

```yaml
id: P1-T06
title: "Barber profile and service area"
issueType: Story
owner: Andrew
phase: 1
priority: High
jiraKey: null
dependsOn: [P0-D06, P0-T14, P1-T03]
affects: [P1-T11, P1-T12, P2-T01, P2-T04, P5-T03]
knowledgeBase: [ADR-008, RULE-ONBOARD-03, RULE-ONBOARD-05, RULE-DISCOVERY-03, RULE-DISCOVERY-05]
blockedByTbc: []
labels: [quicktrimr, phase-1, mobile]
```

**Context**

The barber's public identity and their Scheduled-booking reach. `RULE-DISCOVERY-03` uses the configured service area for Scheduled discovery, distinct from the live session location Available Now uses (`RULE-DISCOVERY-02`) — two different geographies for two different flows, and conflating them is the most likely bug in Phase 2.

`RULE-ONBOARD-05` splits public from private fields. The split is defined here, and `P1-T12` and `P2-T04` both depend on it being right: a private field that leaks into the public projection is exposed to every client who searches.

**Scope**

Barber profile completion in `apps/mobile`: display name, bio, profile photo, years of experience, and service area with travel radius.

Photo upload to Supabase Storage with a size and dimension limit, served through a signed URL rather than a public bucket.

Service area as a private `geography(Point, 4326)` centre plus a radius, entered via Places autocomplete or current location.

A feature migration creates an RLS-protected `public_areas` table, and an idempotent loader imports
the current Australian Bureau of Statistics Suburbs and Localities (SAL) boundary dataset into
PostGIS with its source, licence attribution, checksum and dataset vintage. Each area stores its
public code, label, boundary and a representative map point computed with `ST_PointOnSurface`,
rather than from barber positions. On profile save, the server resolves the private service-area
point to one SAL and stores that public-area reference. The raw Google Places label or geometry is
not persisted as the public area projection.

**An explicit public/private field split**, documented and enforced by the view or policy from `P0-T11`. Public: display name, bio, photo, experience, approximate area, ratings. Private: exact service-area centre, contact details, Stripe identifiers, verification internals.

A radius bound, so a barber cannot set 500 km and appear in every search.

**Contract example** — `complete-barber-profile`

```jsonc
// request
{ "displayName": "Marcus T", "bio": "10 years, fades and beard work.",
  "yearsExperience": 10, "serviceAreaLat": -37.8136, "serviceAreaLng": 144.9631,
  "serviceRadiusKm": 12 }

// 200 — note what comes back is the public projection
{ "id": "3b90...", "displayName": "Marcus T", "bio": "10 years, fades and beard work.",
  "yearsExperience": 10, "photoUrl": null, "serviceRadiusKm": 12,
  "approximateArea": { "id": "sal:2021:example", "label": "Richmond",
    "mapPoint": { "lat": -37.82, "lng": 145.00 } },
  "onboardingComplete": false, "publishable": false }

// 422 — radius outside bounds
{ "error": "validation_failed",
  "fields": { "serviceRadiusKm": "Must be between 1 and 50" } }

// 401
{ "error": "unauthenticated" }
```

**Acceptance criteria**

- [ ] A barber can complete their profile, upload a photo, and set a service area with a radius.
- [ ] The service area is stored as a PostGIS point with a radius, distinct from any Available Now session location.
- [ ] The private service-area point resolves server-side to one versioned ABS SAL; the public projection returns only that area's code, label and representative map point, never the private point.
- [ ] The SAL source, dataset vintage and required attribution are recorded; no Google Places content is persisted as the public area projection.
- [ ] `public_areas` has RLS enabled; mobile roles cannot directly read or write its reference rows, and discovery accesses the projection only through its authorised server path.
- [ ] The travel radius is bounded; values outside the bounds are rejected with a field-level message.
- [ ] Photo upload enforces a size and dimension limit and is served through a signed URL, not a public bucket.
- [ ] **Public and private barber fields are separated**, and the public projection is documented.
- [ ] **A client querying barber data receives public fields only** — asserted on the raw response body, field by field, not on what the screen renders.
- [ ] Barber A cannot read or write barber B's profile.
- [ ] The form uses React Hook Form with a shared schema.
- [ ] Loading and error states exist; a failed photo upload does not lose the rest of the form.

**Tests** — the public projection asserted field by field for absence of private fields; SAL resolution at both sides of a boundary; shared representative point for two barbers in the same SAL; direct mobile-role reads and writes to `public_areas` denied at the API; cross-barber denial; radius bounds at and either side of the limits; oversized photo rejected.

**Out of scope** — Stripe Connect (`P1-T07`, `P1-T08`); services and pricing (`P1-T11`); Available Now sessions (`P2-T01`); publishing to discovery, which requires Connect (`RULE-ONBOARD-04`).

**Sync notes** — `P1-T12` and `P2-T04` both consume the public projection defined here. Adding a field means deciding which side of the split it is on, and getting that wrong exposes it to every client.

---

#### P1-T07 — Stripe Connect onboarding function

```yaml
id: P1-T07
title: "Stripe Connect onboarding function"
issueType: Task
owner: Tony
phase: 1
priority: Highest
jiraKey: null
dependsOn: [P0-D05, P0-T03, P0-T18, P1-T03]
affects: [P1-T08, P1-T09, P3-T11, P5-T03]
knowledgeBase: [ADR-002, ADR-013, RULE-ONBOARD-04, RULE-PAY-10, RULE-EARN-07, ENUM-VERIFICATION-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-1, backend, stripe, security]
```

**Context**

A barber cannot be paid without a Connect account, and `RULE-ONBOARD-04` says they cannot receive a paid booking until it satisfies charges-enabled and payouts-enabled. This function creates the account and the hosted onboarding link.

**Idempotency matters here in a way it usually does not.** Creating a second Connect account for a barber who already has one means their payouts route to an account nobody is watching, and Stripe will happily create as many as you ask for. The account id must be stored and checked before every create.

**Scope**

`create-stripe-connect-onboarding-link` Edge Function.

Authenticated barber only. Client and admin roles rejected.

If the barber has no `stripe_account_id`, create the Connect account of the type chosen in `P0-T18` and **store the id before returning**. If they have one, reuse it.

Apply and verify `P0-T18`'s payout-control and fee configuration for each account (`RULE-EARN-07`), including reused accounts; no default automatic schedule or on-demand control may bypass the approved run. This configures the account, not the Phase 3 payout worker. Bank details remain in Stripe's secure correction flow, never a QuickTrimr log or client-supplied payout destination.

Create an account link with the return and refresh URLs from `P0-T18`, and return the URL. Account links are short-lived, so this is called each time onboarding is opened or resumed — which is exactly why account creation must not repeat.

The Stripe secret key is read server-side only (`RULE-PAY-10`). Stripe identifiers are stored but not returned to the mobile app beyond what the flow needs.

Audit log on account creation and on each link issue (`ADR-013`).

**Contract example** — `create-stripe-connect-onboarding-link`

```jsonc
// request
{}

// 200 — first call, account created
{ "onboardingUrl": "https://connect.stripe.com/setup/s/...",
  "expiresAt": "2026-08-05T04:16:22Z", "accountStatus": "not_started" }

// 200 — resumed, existing account reused
{ "onboardingUrl": "https://connect.stripe.com/setup/s/...",
  "expiresAt": "2026-08-05T05:02:10Z", "accountStatus": "pending" }

// 403 — caller is not a barber
{ "error": "forbidden" }

// 409 — onboarding already complete
{ "error": "onboarding_complete", "accountStatus": "verified" }

// 502 — Stripe unavailable; nothing was created
{ "error": "stripe_unavailable" }
```

**Acceptance criteria**

- [ ] An authenticated barber receives a working hosted onboarding URL.
- [ ] New and reused accounts match the verified `RULE-EARN-07` payout-control and fee configuration, demonstrated in Stripe test mode; unsupported configuration is surfaced, never silently accepted.
- [ ] **A second call reuses the existing Connect account** — proven by asserting one account id in Stripe after repeated calls.
- [ ] The account id is persisted before the function returns, so a crash after creation does not orphan an account.
- [ ] **Concurrent first calls create exactly one Connect account** — tested with real parallel requests.
- [ ] A client or admin caller is rejected with 403.
- [ ] The Stripe secret key never appears in a response or a log.
- [ ] A Stripe outage returns `502 stripe_unavailable` and leaves no partial state.
- [ ] Audit logs are written for account creation and link issue.
- [ ] Errors are typed and reveal no Stripe internals to the caller.

**Tests** — parallel first-call race producing one Stripe account; repeated calls asserted against the Stripe test dashboard; role rejection for client and admin; Stripe failure path leaving no orphan record.

**Out of scope** — the onboarding UI (`P1-T08`); status refresh and webhooks (`P1-T09`); payouts (`P3-T11`).

**Sync notes** — `P1-T08` opens the URL this returns; `P1-T09` refreshes the status of the account it creates.

---

#### P1-T08 — Barber Stripe Connect onboarding UI

```yaml
id: P1-T08
title: "Barber Stripe Connect onboarding UI"
issueType: Story
owner: Tony
phase: 1
priority: High
jiraKey: null
dependsOn: [P1-T06, P1-T07]
affects: [P1-T11, P3-T05]
knowledgeBase: [RULE-ONBOARD-04, RULE-COPY-01, ENUM-VERIFICATION-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-1, mobile, stripe]
```

**Context**

Hosted onboarding leaves the app and comes back, and the return is where this usually breaks: Stripe redirects to the return URL **regardless of whether onboarding actually completed**, so a barber who abandons halfway returns to a screen that must not claim success.

`RULE-ONBOARD-04` means an incomplete barber cannot receive paid bookings, so this screen has to say that plainly. A barber who thinks they are live and receives nothing for a week concludes the platform has no clients.

**Scope**

An onboarding card in the barber journey showing current status from `ENUM-VERIFICATION-STATUS` and a start-or-resume action.

Open the hosted URL from `P1-T07` in a browser session, handle the return and refresh URLs, and **re-fetch status from the server on return** rather than assuming completion.

Status states rendered distinctly: `not_started`, `pending`, `verified`, `failed`, `requires_review`. Each says what the barber should do next.

A persistent, non-dismissible indication while onboarding is incomplete that the barber cannot receive paid bookings (`RULE-COPY-01`).

Handle: abandonment mid-flow, an expired account link, a Stripe outage, and a returning barber who is already verified.

**Acceptance criteria**

- [ ] A barber can start onboarding, and resume it after abandoning.
- [ ] **Returning from Stripe re-fetches status from the server**; the app never infers success from the redirect alone.
- [ ] Every `ENUM-VERIFICATION-STATUS` value renders a distinct state with a clear next action.
- [ ] While onboarding is incomplete, the barber is told **plainly** they cannot receive paid bookings (`RULE-ONBOARD-04`).
- [ ] An expired account link is handled by requesting a fresh one, not by showing an error.
- [ ] A Stripe outage shows a safe retry state.
- [ ] A verified barber sees a completed state and no start action.
- [ ] Loading and error states exist throughout.

**Tests** — return-without-completion showing pending, not verified; expired link recovery; each status rendering; the incomplete-state warning present whenever status is not `verified`.

**Out of scope** — the link function (`P1-T07`); status refresh backend (`P1-T09`); earnings display (`P3-T05`); admin verification override.

**Sync notes** — `P3-T05` shows the same account's payout state. Both surfaces must agree about what "verified" means, or a barber reads two different answers.

---

#### P1-T09 — Stripe Connect status refresh and webhook foundation

```yaml
id: P1-T09
title: "Stripe Connect status refresh and webhook foundation"
issueType: Task
owner: Tony
phase: 1
priority: High
jiraKey: null
dependsOn: [P0-T18, P1-T07]
affects: [P2-T04, P3-T03, P3-T11, P5-T03]
knowledgeBase: [ADR-013, RULE-ONBOARD-04, RULE-PAY-07, RULE-PAY-10, ENUM-VERIFICATION-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-1, backend, stripe, security]
```

**Context**

Connect status changes without the barber doing anything: Stripe re-verifies, requests documents, or restricts an account days after onboarding. Polling on app open is not enough — a barber restricted overnight would keep receiving bookings QuickTrimr cannot pay out.

This ticket establishes the **webhook pattern** the whole payment phase inherits: signature verification, idempotent handling of duplicate deliveries, and a stored event id. `P3-T03` extends the same handler rather than writing a second one.

**Scope**

`refresh-stripe-connect-status` Edge Function: fetch the account, map `charges_enabled`, `payouts_enabled`, `details_submitted` and requirements to `ENUM-VERIFICATION-STATUS`, and persist.

A webhook endpoint handling `account.updated`, establishing:

- **Signature verification against the webhook secret** before any parsing (`RULE-PAY-07`). An unverified body is not data.
- Event id persistence, so a duplicate delivery is a no-op — Stripe retries, and it will deliver twice.
- Safe logging: event type and id, never the full payload (`ADR-013`).
- A fast acknowledgement, with work done in a way that does not risk a Stripe timeout and retry storm.

Status changes write audit logs, and a transition **into** a restricted state is the one worth alerting on.

**Contract example** — webhook handling

```jsonc
// valid signed account.updated → 200
{ "received": true }

// duplicate delivery of the same event id → 200, no state change
{ "received": true, "duplicate": true }

// invalid or missing signature → 400, nothing parsed, nothing written
{ "error": "invalid_signature" }
```

**Acceptance criteria**

- [ ] Status refresh maps Stripe account flags to `ENUM-VERIFICATION-STATUS` and persists the result.
- [ ] **A request with an invalid or missing signature is rejected with 400 and writes nothing.**
- [ ] **A duplicate event id produces exactly one effect** — replaying the same event twice leaves identical state.
- [ ] Event ids are persisted for deduplication.
- [ ] A barber whose account becomes restricted stops satisfying `RULE-ONBOARD-04` and is excluded from discovery.
- [ ] Audit logs are written for status changes.
- [ ] No full Stripe payload, secret, or account token is logged.
- [ ] The endpoint acknowledges quickly enough to avoid Stripe retry timeouts.

**Tests** — signature rejection with a tampered body; the same event delivered twice producing one effect; a restriction event removing the barber from a discovery query; audit log written on transition.

**Out of scope** — payment webhooks (`P3-T03`), which extend this handler; payouts (`P3-T11`); admin status views (`P5-T03`).

**Sync notes** — `P3-T03` builds on this handler's verification and deduplication. `P2-T04` filters on the status this maintains, so a mapping error here silently changes who is discoverable.

---

#### P1-T10 — Service category management

```yaml
id: P1-T10
title: "Service category management"
issueType: Task
owner: Andrew
phase: 1
priority: High
jiraKey: null
dependsOn: [P0-D01, P0-T10, P0-T11]
affects: [P1-T11, P1-T12, P2-T04, P5-T11]
knowledgeBase: [ADR-013, RULE-SERVICE-01, RULE-SERVICE-03, RULE-SERVICE-05, RULE-ADMIN-01]
blockedByTbc: []
labels: [quicktrimr, phase-1, backend, admin]
```

**Context**

Categories are global, admin-managed data (`RULE-SERVICE-01`) — the spine both barber pricing and client discovery hang from.

**Archive, never delete** (`RULE-SERVICE-03`). A deleted category orphans every `barber_services` row and every historical booking that referenced it. Archiving hides it from new selections while keeping history readable.

Depends on `P0-D01` for the launch set and the price bounds (`RULE-SERVICE-05`) — do not invent them.

**Scope**

Edge Functions: `create-service-category`, `update-service-category`, `archive-service-category`, and a list query.

Admin role required for all three mutations, verified server-side (`RULE-ADMIN-01`). Barbers and clients read the active list; neither can mutate it.

Category fields: slug, display name, description, display order, min and max allowed barber price in integer cents (`RULE-SERVICE-05`), and `archived_at`.

Slug immutable after creation — it is what `barber_services` and historical bookings reference.

RLS: active categories readable by any authenticated user; writes restricted to admin. **No delete policy.**

Audit log for every admin mutation (`ADR-013`).

**Contract example** — `update-service-category`

```jsonc
// request
{ "id": "c14a...", "displayName": "Skin Fade", "displayOrder": 2,
  "minPriceCents": 2500, "maxPriceCents": 12000 }

// 200
{ "id": "c14a...", "slug": "skin_fade", "displayName": "Skin Fade",
  "displayOrder": 2, "minPriceCents": 2500, "maxPriceCents": 12000,
  "archivedAt": null }

// 422 — bounds inverted
{ "error": "validation_failed",
  "fields": { "maxPriceCents": "Must be greater than minPriceCents" } }

// 403 — caller is not an admin
{ "error": "forbidden" }

// 409 — attempting to change an immutable slug
{ "error": "slug_immutable" }
```

**Acceptance criteria**

- [ ] An admin can create, update and archive a category.
- [ ] Categories match `RULE-SERVICE-05` — slugs, display order and price bounds.
- [ ] **A barber or client calling any mutation receives 403** — verified by calling the endpoint directly, not by checking the UI.
- [ ] Any authenticated user can read the active list.
- [ ] Archiving removes a category from new barber selections; existing `barber_services` rows and bookings still resolve it.
- [ ] Archive is idempotent.
- [ ] **No client can delete a category row** — no delete policy exists.
- [ ] A slug cannot be changed after creation.
- [ ] `maxPriceCents` must exceed `minPriceCents`; inverted bounds are rejected.
- [ ] Every admin mutation writes an audit log with the previous and new values.

**Tests** — role denial at the API for barber and client on all three mutations; archive idempotency; archived category absent from selection but resolvable historically; slug immutability; inverted price bounds rejected.

**Out of scope** — the admin UI (`P5-T11`); barber pricing (`P1-T11`).

**Sync notes** — `P1-T11` prices against these bounds, `P1-T12` and `P2-T04` display and filter on them. Narrowing a price bound after barbers have set prices leaves existing rows outside the new range — decide what happens to them before changing a bound.

---

#### P1-T11 — Barber services and pricing

```yaml
id: P1-T11
title: "Barber services and pricing"
issueType: Story
owner: Andrew
phase: 1
priority: High
jiraKey: null
dependsOn: [P0-D01, P1-T06, P1-T10]
affects: [P1-T12, P2-T04, P2-T08, P5-T03]
knowledgeBase: [ADR-009, RULE-SERVICE-02, RULE-SERVICE-04, RULE-SERVICE-05, RULE-ONBOARD-04]
blockedByTbc: []
labels: [quicktrimr, phase-1, mobile, database]
```

**Context**

Where the barber sets what a client pays. `RULE-SERVICE-04` is the rule that matters and the one most easily broken: **changing a price must never change an existing booking.** The booking's snapshot governs (`ADR-009`), so this ticket must not update anything downstream when a price changes.

Prices are integer cents. A price entry field is the single most likely place a float enters the system, and `$45.50` typed into a decimal input that reaches Stripe as `45.5` is a real defect.

**Scope**

A screen in the barber journey listing active categories with a toggle and a price field per category.

`upsert-barber-service` and `archive-barber-service` Edge Functions. A barber may only write their own rows.

Prices validated against the category's `minPriceCents` and `maxPriceCents` (`RULE-SERVICE-05`), server-side as well as in the form. A barber who bypasses the form must still be bounded.

Price entry in dollars and cents, converted to integer cents at the boundary and never held as a float.

Disabling a service archives the row rather than deleting it, so historical bookings still resolve.

The screen states that a price change does not affect existing bookings (`RULE-SERVICE-04`) — a barber who raises prices and expects tomorrow's confirmed booking to follow will otherwise raise it as a bug.

**Contract example** — `upsert-barber-service`

```jsonc
// request
{ "serviceCategoryId": "c14a...", "priceCents": 4500, "enabled": true }

// 200
{ "id": "77de...", "serviceCategoryId": "c14a...", "priceCents": 4500,
  "enabled": true, "archivedAt": null }

// 422 — outside the category's bounds
{ "error": "validation_failed",
  "fields": { "priceCents": "Must be between 2500 and 12000" } }

// 422 — non-integer amount
{ "error": "validation_failed",
  "fields": { "priceCents": "Must be a whole number of cents" } }

// 404 — category archived or unknown
{ "error": "category_unavailable" }
```

**Acceptance criteria**

- [ ] A barber can enable a service, set a price, change a price, and disable a service.
- [ ] Prices are stored as integer cents; **no float appears in the path from input to database.**
- [ ] A price outside the category bounds is rejected with a field-level message, **at the API as well as in the form**.
- [ ] A non-integer cent value is rejected.
- [ ] **Changing a price does not alter any existing booking** — verified against a booking created before the change.
- [ ] Disabling archives rather than deletes; historical bookings still resolve the service.
- [ ] Barber A cannot read or write barber B's services.
- [ ] An archived category cannot have a new price set against it.
- [ ] The screen states that price changes do not affect existing bookings.
- [ ] Loading, error and empty states exist; the empty state explains that services must be priced before the barber is discoverable.

**Tests** — price bounds at and either side of both limits; a crafted out-of-bounds request rejected server-side; a decimal rejected; an existing booking's amount unchanged after a price change; cross-barber denial.

**Out of scope** — the client-facing profile (`P1-T12`); booking price snapshots (`P2-T08`); discovery (`P2-T04`).

**Sync notes** — `P2-T08` snapshots the price this sets. The snapshot is what makes `RULE-SERVICE-04` true, so a change to how price is stored reaches request creation directly.

---

#### P1-T12 — Client-facing barber profile

```yaml
id: P1-T12
title: "Client-facing barber profile"
issueType: Story
owner: Andrew
phase: 1
priority: Medium
jiraKey: null
dependsOn: [P0-D01, P1-T10, P1-T11]
affects: [P2-T06, P2-T09, P4-T15]
knowledgeBase: [RULE-ONBOARD-05, RULE-DISCOVERY-04, RULE-REVIEW-04]
blockedByTbc: []
labels: [quicktrimr, phase-1, mobile]
```

**Context**

What a client sees before deciding to send a request, and therefore the surface where a private field leaking is most costly — it is visible to every client who browses, not just one who books.

The rating aggregate appears here but reviews do not exist until Phase 4, so this ticket renders a placeholder that is honest about having no reviews rather than showing "5.0" for a barber nobody has rated.

**Scope**

A barber profile screen in the client journey: photo, display name, bio, years of experience, services with prices, approximate area, and rating aggregate.

Data comes from the **public projection** defined in `P1-T06` (`RULE-ONBOARD-05`). This screen must not have a query path to private fields.

Location rendered at whatever precision `P0-D06` decides — until then, an approximate area, never an exact point (`RULE-DISCOVERY-04`).

An empty rating state for a barber with no reviews that does not imply a score.

Works against mock fixtures from `P0-T08` so it can be built before search exists.

**Acceptance criteria**

- [ ] A client can open a barber profile and see photo, name, bio, experience, services with prices, and approximate area.
- [ ] **The response body contains no private barber field** — asserted field by field on the raw response, not on the rendered screen.
- [ ] No exact barber location is exposed (`RULE-DISCOVERY-04`).
- [ ] A barber with no reviews shows an honest empty rating state, not a default score.
- [ ] Prices shown are the barber's current prices, formatted from integer cents.
- [ ] Loading, error and empty states exist; a barber with no active services renders sensibly.
- [ ] The screen runs against mock fixtures without a live backend.

**Tests** — raw response asserted for absence of every private field; empty-review rendering; a barber with no active services rendering without a crash.

**Out of scope** — search and discovery (`P2-T04`, `P2-T06`); sending a request (`P2-T09`); review listing (`P4-T15`).

**Sync notes** — `P2-T06` renders a summary card from the same projection. If they use different queries they will drift, and one will eventually return a field the other filters out.

---
## Phase 2 — Available Now, Discovery & Booking Requests

**Goal:** a client can find a barber and send a request; exactly one acceptance can win it.

**No money in this phase.** `P2-T12` accepts a request and stops short of Stripe; `P2-T15` expires one and stops short of cancelling an authorisation. `P3-T06` wires payment into both. That split is deliberate — the previous backlog had acceptance capturing payment, which made Phase 2 depend on Phase 3 and the phase gates a fiction.

**Gate:** a client sends a request, a barber sees it, exactly one acceptance wins under concurrent attempts, and unanswered requests expire on their own.

---

#### P2-T01 — Available Now session model and queries

```yaml
id: P2-T01
title: "Available Now session model and queries"
issueType: Task
owner: Andrew
phase: 2
priority: Highest
jiraKey: null
dependsOn: [P0-D04, P0-D06, P0-T06, P0-T10, P1-T06]
affects: [P2-T02, P2-T03, P2-T04, P2-T08, P2-T12, P3-T12]
knowledgeBase: [ADR-008, RULE-AVAIL-01, RULE-AVAIL-02, RULE-DISCOVERY-05, RULE-RELY-06, ENUM-AVAIL-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-2, backend, database, maps]
```

**Context**

The session is what makes a barber findable right now. `RULE-AVAIL-01` allows exactly one active session per barber, and that has to be enforced by a database constraint rather than application logic — two devices, or one device with a retry, will both try to start a session.

The session location is **not** the barber's service area (`P1-T06`). `RULE-DISCOVERY-02` uses this live location; `RULE-DISCOVERY-03` uses the configured area. Conflating them is the most likely bug in this phase.

**Scope**

Edge Functions `start-available-now-session`, `update-available-now-session`, `stop-available-now-session`.

A shared server-side read-side eligibility helper for `RULE-RELY-06`, reused by discovery, request creation and acceptance: read effective server-owned restrictions and evaluate deadlines against server time. Suspension or an active cooldown prevents Available Now activation; stopping a session remains allowed. Never accept a client-supplied standing/deadline or invent a new session status. Phase 2 tests use seeded restriction state; live offence production, recovery and integration are owned by `P3-T12`, not a Phase 3 dependency added to this ticket.

Session row: barber id, private `geography(Point, 4326)` location, server-resolved public-area reference from `P1-T06`, location source (`gps` or `manual`), radius, available-until timestamp, status (`ENUM-AVAIL-STATUS`), and timestamps. Starting or updating a session resolves the private point against the versioned SAL polygons server-side; the client cannot choose or override the public area.

The partial unique index from `P0-T10` enforces one `active` session per barber. Starting a session while one is active either replaces it or is rejected — decide, document, and make it the same answer every time.

A discovery query helper that returns sessions which are `active`, not past their available-until, and within radius of a client point — using a PostGIS distance operator against the GiST index, never a full scan.

Radius and available-until bounds, so a session cannot be set to 500 km or 30 days.

RLS: a barber reads and writes only their own sessions; the discovery path reads through the search function, not directly.

**Contract example** — `start-available-now-session`

```jsonc
// request
{ "lat": -37.8136, "lng": 144.9631, "locationSource": "gps",
  "radiusKm": 8, "availableUntil": "2026-08-05T09:00:00Z" }

// 200
{ "id": "5c22...", "status": "active", "radiusKm": 8,
  "availableUntil": "2026-08-05T09:00:00Z", "locationSource": "gps",
  "approximateArea": { "id": "sal:2021:example", "label": "Melbourne" } }

// 409 — a session is already active
{ "error": "session_already_active", "activeSessionId": "5c22..." }

// 422 — available-until in the past
{ "error": "validation_failed",
  "fields": { "availableUntil": "Must be in the future" } }

// 403 — barber does not satisfy RULE-ONBOARD-04
{ "error": "onboarding_incomplete" }

// 409 — RULE-RELY-06 prevents Available Now activation
{ "error": "barber_unavailable" }
```

**Acceptance criteria**

- [ ] A barber can start, update and stop a session.
- [ ] **A second active session cannot exist for a barber** — enforced by the database index and proven under real parallel start calls.
- [ ] The session location is stored separately from the barber's service area and the two are never read interchangeably.
- [ ] The session point resolves server-side to a public area and the client cannot supply or override that area.
- [ ] Discovery excludes sessions that are expired, `busy`, `manually_disabled`, `auto_disabled` or `cancelled`.
- [ ] The discovery query uses a PostGIS index — verified by an `EXPLAIN` showing an index scan, not a sequential scan.
- [ ] Radius and available-until are bounded; out-of-bounds values are rejected with field-level errors.
- [ ] A barber not satisfying `RULE-ONBOARD-04` cannot start a session.
- [ ] Direct start/update activation calls reject a suspended barber or active cooldown with `409 barber_unavailable`; a stop is still permitted. Evaluate server-owned deadlines, never client state, without restarting cooldowns.
- [ ] The shared eligibility helper is reused at the other Phase 2 entry points; seeded tests cover every reliability level and just before/at/after a cooldown deadline.
- [ ] Barber A cannot read or write barber B's session.

**Tests** — parallel start calls producing one active session; server-side public-area resolution including a boundary case; crafted public-area input ignored or rejected; `EXPLAIN` asserting index usage; each excluded status absent from discovery; bounds at and either side of the limits; onboarding-incomplete rejection.

**Out of scope** — the toggle UI (`P2-T02`); auto-disable (`P2-T03`); the search function (`P2-T04`).

**Sync notes** — `P2-T04` queries these sessions and `P2-T12` transitions one to `busy`. Changing the status semantics changes who is discoverable.

---

#### P2-T02 — Barber Available Now toggle

```yaml
id: P2-T02
title: "Barber Available Now toggle"
issueType: Story
owner: Andrew
phase: 2
priority: Highest
jiraKey: null
dependsOn: [P0-T14, P2-T01]
affects: [P2-T11]
knowledgeBase: [RULE-AVAIL-01, RULE-AVAIL-02, RULE-AVAIL-03, RULE-RELY-06, RULE-COPY-01, ENUM-AVAIL-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-2, mobile, maps]
```

**Context**

The barber's "I'm working" switch. It reads as one toggle but carries four inputs — location, location source, radius and available-until — and the barber is usually standing in the street when they use it.

Location permission denial must not block it. `RULE-AVAIL-02` allows a manual location precisely so a barber who declines GPS can still work.

**Scope**

A toggle in the barber journey with: GPS or manual location, a radius control, and an available-until picker.

Handle permission denied, permission restricted, and location unavailable — each falling back to manual entry rather than an error.

Show the active session state: how long remains, current radius, and how the location was set.

Show the barber's current reliability standing and recovery information from the server, including a cooldown end or human-review/reinstatement requirement. A cooldown/suspension is a separate eligibility restriction, not a new session status or missed-request auto-disable reason. A display countdown cannot lift a restriction; refresh server state.

When a session auto-disables (`RULE-AVAIL-03`), the barber is told **why** — time elapsed, missed requests, or a job accepted. A toggle that silently flips off reads as a bug and gets reported as one.

Copy must not promise QuickTrimr notifies the barber of every nearby client (`RULE-COPY-01`).

**Acceptance criteria**

- [ ] A barber can toggle Available Now on and off.
- [ ] GPS location works, and **denying the permission still allows a manual location and a working session.**
- [ ] Radius and available-until are settable within the bounds from `P2-T01`, with bounds shown before submission.
- [ ] The active session state shows remaining time, radius and location source.
- [ ] **An auto-disabled session shows the reason**, distinguishing time elapsed, missed requests, and job accepted.
- [ ] Every `ENUM-AVAIL-STATUS` value renders a defined state.
- [ ] The toggle is disabled with an explanation when the barber does not satisfy `RULE-ONBOARD-04`.
- [ ] `RULE-RELY-06` standing and recovery remain visible outside a cancellation flow; cooldown/suspension explains why activation is unavailable, and a stale-screen `409 barber_unavailable` refreshes server state. Test normal, cooldown, restricted-but-bookable and suspended states.
- [ ] Loading and error states exist; a failed start does not leave the toggle showing on.

**Tests** — permission-denied path reaching an active session via manual location; each auto-disable reason rendering distinctly; the toggle reflecting server state after a failed start.

**Out of scope** — the session backend (`P2-T01`); auto-disable logic (`P2-T03`); the request inbox (`P2-T11`).

**Sync notes** — the reasons this screen displays are set by `P2-T03`. A new auto-disable reason needs a case here or it renders as unknown.

---

#### P2-T03 — Available Now auto-disable rules

```yaml
id: P2-T03
title: "Available Now auto-disable rules"
issueType: Task
owner: Andrew
phase: 2
priority: High
jiraKey: null
dependsOn: [P0-D04, P0-D07, P2-T01]
affects: [P2-T02, P2-T12, P3-T12]
knowledgeBase: [ADR-011, ADR-013, RULE-AVAIL-03, RULE-AVAIL-05, RULE-RELY-06, ENUM-AVAIL-STATUS, CFG-MISSED-REQUEST-THRESHOLD]
blockedByTbc: []
labels: [quicktrimr, phase-2, backend]
```

**Context**

`RULE-AVAIL-03` gives four auto-disable triggers, and three of them are timers or counters that must run server-side (`ADR-011`). A barber whose phone is in their pocket must still stop appearing in searches when their available-until passes.

**`P0-D04` resolved the interaction:** missed requests auto-disable the session here but **never count as reliability offences** (`RULE-RELY-06`). A barber who steps away from their phone twice is not also penalised as if they abandoned an accepted booking.

**Scope**

Four triggers, each setting a distinct status and reason:

| Trigger | Result |
|---|---|
| Available-until passes | `expired` |
| `CFG-MISSED-REQUEST-THRESHOLD` consecutive misses | `auto_disabled`, reason `missed_requests` |
| Barber accepts an Available Now booking | `busy` (`RULE-AVAIL-05`) |
| Barber toggles off | `manually_disabled` |

The expiry trigger uses Supabase `pg_cron` with a bounded indexed due-session sweep (`ADR-011`),
not one recurring job per session. Persist the available-until deadline; re-check current state
atomically and behave idempotently. This slice owns its versioned schedule setup, server-only
handler permissions, safe run evidence, independent stale-heartbeat/overdue-session alerts and
recovery of missed ticks/interrupted claims. Reuse shared patterns; do not build or defer to an
unowned generic workflow engine. Record operational settings and prove peak-load expiry timing.

A consecutive-miss counter that **resets on a response** — accept or decline. Counting non-consecutive misses over a session would disable a busy barber who answered nine of eleven requests.

Audit log for each transition, with the reason (`ADR-013`).

**Acceptance criteria**

- [ ] A session past its available-until becomes `expired` without any barber action.
- [ ] `CFG-MISSED-REQUEST-THRESHOLD` consecutive misses sets `auto_disabled` with reason `missed_requests`.
- [ ] **Responding to a request resets the consecutive-miss counter** — a barber who declines one and misses one is not disabled at a threshold of two.
- [ ] Accepting an Available Now booking sets the session `busy`.
- [ ] A manual toggle-off sets `manually_disabled`.
- [ ] **Every trigger is idempotent** — firing twice leaves identical state.
- [ ] The expiry job re-checks state at execution; a session stopped manually before the job fires is not overwritten.
- [ ] Missed and declined requests produce no reliability offence (`RULE-RELY-06`); test repeated expiry/delivery and the unchanged two-consecutive-miss auto-disable rule.
- [ ] Threshold values are read from config; no literal appears in the logic.
- [ ] Each transition writes an audit log with its reason.
- [ ] The pg_cron sweep and its independent monitoring work in the deployed test environment; missing ticks/interrupted claims recover without overwriting stopped or busy sessions, including under a stated peak workload (`ADR-011`).

**Tests** — expiry firing once and again as a no-op; consecutive-miss counter reset on decline; a manually stopped session not resurrected or overwritten by a later expiry job; config value change altering behaviour without a code change; repeated parallel sweep/transition calls; stopped cron and interrupted-claim recovery; server-only API denial; independent heartbeat/overdue alerts and peak-load timing.

**Out of scope** — the reliability engine (`P3-T12`); the toggle UI (`P2-T02`); acceptance (`P2-T12`).

**Sync notes** — `P2-T12` sets `busy` through this module rather than writing the status itself, so all four transitions stay in one place.

---

#### P2-T04 — Nearby barber search

```yaml
id: P2-T04
title: "Nearby barber search"
issueType: Task
owner: Andrew
phase: 2
priority: Highest
jiraKey: null
dependsOn: [P0-D01, P0-D04, P0-D06, P1-T09, P1-T11, P2-T01]
affects: [P2-T05, P2-T06, P2-T07, P2-T09]
knowledgeBase: [ADR-008, RULE-DISCOVERY-01, RULE-DISCOVERY-02, RULE-DISCOVERY-03, RULE-DISCOVERY-04, RULE-DISCOVERY-05, RULE-ONBOARD-04, RULE-SERVICE-05, RULE-RELY-06, CFG-RELIABILITY-SEARCH-PENALTY]
blockedByTbc: []
labels: [quicktrimr, phase-2, backend, maps, security]
```

**Context**

The query the whole client journey starts from, and the one place where **two different geographies** must not be confused: Available Now searches the live session location (`RULE-DISCOVERY-02`), Scheduled searches the configured service area (`RULE-DISCOVERY-03`).

It is also the highest-volume privacy surface in QuickTrimr. Every client who searches receives barber data, so a private field in this response is exposed broadly rather than to one booking counterparty. `RULE-DISCOVERY-05` from `P0-D06` decides the location precision this may return — which is why this ticket cannot start before that decision.

**Scope**

`search-available-now-barbers` and the Scheduled equivalent, or one function branching on booking type.

Filters: booking type, service category, client point, radius, and eligibility. Eligibility excludes barbers who fail `RULE-ONBOARD-04`, have no active price for the category, or are `suspended`. An active reliability cooldown excludes Available Now only. Use the shared read-side eligibility helper from `P2-T01`. `restricted` alone is **demotion, not exclusion** (`RULE-RELY-06`).

PostGIS distance query against the GiST index (`ADR-008`). Results bounded and paginated — never "fetch all and sort".

Response carries the **public projection only** (`RULE-ONBOARD-05`), at the precision `RULE-DISCOVERY-05` allows, with the price for the requested category, a distance band, and the server-resolved approximate area. The exact distance remains server-side for filtering and ordering. The area label and representative map point come from the versioned public SAL data established by `P1-T06`, not from Google or from a barber coordinate.

Ordering documented and deliberate: per `CFG-RELIABILITY-SEARCH-PENALTY`, otherwise eligible restricted barbers follow non-restricted barbers in both booking types, before normal deterministic distance/price/rating ordering within each group. Apply that ordering in the bounded database query before pagination, never re-sort a fetched page or expose private offence history in public results.

**Contract example** — `search-available-now-barbers`

```jsonc
// request
{ "bookingType": "available_now", "serviceCategoryId": "c14a...",
  "lat": -37.8226, "lng": 144.9980, "radiusKm": 10, "limit": 20, "cursor": null }

// 200 — note: distance band, not coordinates (RULE-DISCOVERY-05)
{ "results": [
    { "barberId": "3b90...", "displayName": "Marcus T", "photoUrl": "https://...",
      "priceCents": 4500, "distanceBand": "2-5km",
      "approximateArea": { "id": "sal:2021:example", "label": "Richmond",
        "mapPoint": { "lat": -37.82, "lng": 145.00 } },
      "rating": 4.8, "ratingCount": 37,
      "availableUntil": "2026-08-05T09:00:00Z" }
  ],
  "nextCursor": "eyJvZmZ..." }

// 200 — no matches is a success, not an error
{ "results": [], "nextCursor": null }

// 422
{ "error": "validation_failed",
  "fields": { "radiusKm": "Must be between 1 and 50" } }
```

**Acceptance criteria**

- [ ] Available Now search returns barbers by **live session location**; Scheduled search returns them by **configured service area**. The two are never interchanged.
- [ ] Results are filtered by service category and exclude barbers with no active price for it.
- [ ] **A barber failing `RULE-ONBOARD-04` never appears** — verified with a seeded Connect-restricted barber (distinct from the reliability level `restricted`).
- [ ] Expired, busy and disabled sessions are excluded from Available Now results.
- [ ] Suspended barbers are excluded from both booking types; active cooldowns exclude Available Now only. Restricted barbers outside a cooldown remain discoverable and bookable, after non-restricted barbers across page boundaries, without leaking reliability history.
- [ ] Every result returns exactly one of `under-2km`, `2-5km`, `5-10km`, or `10km+`, with boundary behaviour matching `RULE-DISCOVERY-05`.
- [ ] **The response contains no private barber field, exact distance, barber coordinate, or location more precise than `RULE-DISCOVERY-05` allows** — asserted field by field on the raw body. The only coordinate returned is the shared public-area map point.
- [ ] Results are paginated and bounded; there is no unbounded response.
- [ ] The query uses a PostGIS index — `EXPLAIN` shows an index scan.
- [ ] Ordering is documented and deterministic for equal values, so pagination does not repeat or skip a barber.
- [ ] An empty result is a 200 with an empty array, not an error.
- [ ] The Google server key is not involved; this is a database query.

**Tests** — raw response asserted for absence of private fields, exact distance and barber coordinates; distance-band boundaries at 2 km, 5 km and 10 km on both sides; two barbers in one SAL returning the same area map point; Connect-ineligible and suspended barbers excluded; restricted barber demoted but present; cooldown just before/at/after its deadline in both booking types; `EXPLAIN` index assertion; pagination stability across reliability groups and tied ordering values; Available Now versus Scheduled returning different sets and approximate areas for a barber whose session location and service area differ.

**Out of scope** — filter UI (`P2-T05`); result rendering (`P2-T06`, `P2-T07`); ETA (`P4-T05`).

**Sync notes** — three screens consume this response shape. Changing the precision or the projection after they ship changes all three, which is why `P0-D06` gates this ticket.

---

#### P2-T05 — Client discovery filters

```yaml
id: P2-T05
title: "Client discovery filters"
issueType: Story
owner: Andrew
phase: 2
priority: High
jiraKey: null
dependsOn: [P0-D08, P0-T15, P1-T05, P2-T04]
affects: [P2-T06, P2-T07, P2-T09]
knowledgeBase: [ADR-003, RULE-DISCOVERY-01, RULE-SCHED-04, ENUM-BOOKING-TYPE, CFG-SCHED-MIN-LEAD-MIN, CFG-SCHED-MAX-HORIZON-DAYS]
blockedByTbc: []
labels: [quicktrimr, phase-2, mobile]
```

**Context**

Where the client chooses Available Now or Scheduled, a service, and a location. These selections are **draft state**, not server state (`ADR-003`) — they live in the Zustand booking-draft store from `P0-T15` and become a request in `P2-T09`.

The mode choice changes what everything else means: Scheduled needs a date and time, Available Now does not, and the two searches query different geographies.

**Scope**

A filter surface: booking mode, service category, service address or current location, and radius.

Scheduled mode adds a date and time picker bounded by `RULE-SCHED-04`. It loads the public minimum-lead and maximum-horizon values through a read-only server endpoint or projection backed by platform config; the mobile bundle does not hard-code them and does not receive unrelated or sensitive configuration. Those server values remain TanStack Query data rather than being mirrored into the draft store. A time inside the minimum explains that Scheduled bookings need four hours' notice and points the client to Available Now. Pre-acceptance copy calls the time **requested**, never available or booked, because QuickTrimr has no barber calendar at launch.

Address selection reuses the picker from `P1-T05`. Do not build a second one.

Filters persist in the draft store across navigation, so a client who opens a barber profile and comes back has not lost their selection.

Invalid combinations are prevented rather than submitted: no service selected, no address, or a past time.

**Acceptance criteria**

- [ ] A client can choose booking mode, service category, address or current location, and radius.
- [ ] Scheduled mode shows date and time; Available Now does not.
- [ ] The Scheduled picker reads both bounds from server-backed config, enforces them, presents too-soon guidance to Available Now, and never claims an unaccepted time is available or booked.
- [ ] Filters live in the Zustand draft store and survive navigation away and back.
- [ ] **No server data is mirrored into the draft store** (`ADR-003`).
- [ ] Invalid combinations cannot be submitted, with the reason shown.
- [ ] The address picker from `P1-T05` is reused, not reimplemented.
- [ ] Changing a filter invalidates the search query and refetches.
- [ ] Loading, error and empty states exist.

**Tests** — server-provided minimum-lead and maximum-horizon boundaries at, just inside and just outside; too-soon guidance; requested-time copy before acceptance; no hard-coded fallback when config loading fails; draft persistence across navigation; invalid combinations blocked; query invalidation firing on each filter change.

**Out of scope** — the search function (`P2-T04`); results (`P2-T06`, `P2-T07`); submission (`P2-T09`).

**Sync notes** — the draft shape defined here is what `P2-T09` submits. Adding a filter means adding it to the request contract too.

---

#### P2-T06 — Barber results list

```yaml
id: P2-T06
title: "Barber results list"
issueType: Story
owner: Andrew
phase: 2
priority: High
jiraKey: null
dependsOn: [P0-T15, P1-T12, P2-T04, P2-T05]
affects: [P2-T09]
knowledgeBase: [RULE-DISCOVERY-04, RULE-DISCOVERY-05, RULE-ONBOARD-05]
blockedByTbc: []
labels: [quicktrimr, phase-2, mobile]
```

**Context**

The list a client picks from. The empty state carries more weight than the populated one: "no barbers available right now" is the single most likely first experience for an early-stage marketplace, and it must suggest what to do — widen the radius, try Scheduled, pick another service — rather than showing a blank screen.

**Scope**

A list of result cards: photo, name, price for the selected service, approximate area, distance band at the allowed precision, rating, and availability.

Pagination via the cursor from `P2-T04`, loading further pages on scroll.

Tapping a card opens the `P1-T12` profile, carrying the selected service so the price shown does not change between screens.

An empty state offering concrete next actions. Distinguish "no barbers matched" from "search failed" — they need different responses from the client.

Refetch on filter change, and pull-to-refresh for the Available Now case, where availability changes minute to minute.

**Acceptance criteria**

- [ ] Results render with photo, name, price for the selected service, approximate area, distance band and rating.
- [ ] Distance and area are shown at the `RULE-DISCOVERY-05` precision; no exact distance or barber location is rendered.
- [ ] Pagination loads further pages without duplicating or skipping a barber.
- [ ] Tapping a card opens the profile with the selected service preserved and the same price.
- [ ] **The empty state offers next actions** and is distinct from the error state.
- [ ] Pull-to-refresh works; changing a filter refetches.
- [ ] No unnecessary re-render on scroll — the list is virtualised.
- [ ] Loading, error and empty states exist.

**Tests** — pagination stability across pages; empty and error states rendering distinctly; price consistency between card and profile.

**Out of scope** — map view (`P2-T07`); submission (`P2-T09`).

**Sync notes** — this card and `P1-T12` render the same projection. They must read the same fields or one will show a price the other does not.

---

#### P2-T07 — Client map view

```yaml
id: P2-T07
title: "Client map view"
issueType: Story
owner: Andrew
phase: 2
priority: Medium
jiraKey: null
dependsOn: [P0-D06, P2-T04, P2-T05]
affects: []
knowledgeBase: [ADR-004, ADR-008, RULE-DISCOVERY-04, RULE-DISCOVERY-05]
blockedByTbc: []
labels: [quicktrimr, phase-2, mobile, maps, security]
```

**Context**

A map of nearby barbers, and the surface where `RULE-DISCOVERY-05` is most easily violated — a marker is a coordinate, and a coordinate is exactly the thing the rule limits.

`RULE-DISCOVERY-05` deliberately forbids per-barber markers. A marker is a coordinate, and a
randomly jittered marker still exposes a barber-shaped point that can be probed across searches.
The map communicates supply by approximate area instead.

**Scope**

Google Maps renders the client's service location and one shared cluster for each approximate area
returned by `P2-T04`. The cluster uses the public SAL representative point and shows the number of
matching barbers. It is not calculated from barber positions, and no individual barber marker or
jitter is used.

Selecting an area cluster opens the matching `P2-T06` barber cards for that area.

Refetch throttled on pan and zoom. An unthrottled map fires a search on every frame of a drag, which is a cost problem and a rate-limit problem.

Handle a denied location permission by centring on the selected service address instead.

Uses the **client** Google key from `P0-T18`, bundle-restricted. The server key is not involved.

**Acceptance criteria**

- [ ] The map renders the client's service location and one cluster per approximate area containing matching barbers.
- [ ] **No individual barber marker is rendered.** Every cluster uses the shared public SAL representative point from `P2-T04`, never a point derived from barber positions.
- [ ] No jitter is generated or accepted anywhere in the map data path.
- [ ] Selecting a cluster opens the matching barber cards for that area.
- [ ] Pan and zoom refetches are throttled; a drag does not fire a search per frame.
- [ ] A denied location permission centres on the selected address rather than failing.
- [ ] Only the bundle-restricted client key is used; no server key appears in the bundle.
- [ ] Loading, error and empty states exist, including a map with no results.

**Tests** — two barbers in one SAL produce one cluster at the shared public point; raw map data contains no barber coordinate or jitter; selecting a cluster shows only its matching cards; throttling asserted by counting requests during a simulated drag; permission-denied fallback.

**Out of scope** — live tracking, which `ADR-004` forbids; on-the-way ETA (`P4-T06`); submission (`P2-T09`).

**Sync notes** — this and `P2-T06` consume the same search response. A precision change in `P2-T04` changes what this may render.

---

#### P2-T08 — Create booking request

```yaml
id: P2-T08
title: "Create booking request"
issueType: Task
owner: Andrew
phase: 2
priority: Highest
jiraKey: null
dependsOn: [P0-D01, P0-D02, P0-D03, P0-D04, P0-D08, P0-T07, P0-T10, P1-T04, P1-T05, P1-T11, P2-T01]
affects: [P2-T09, P2-T10, P2-T12, P2-T13, P2-T15, P3-T01, P3-T06, P4-T01]
knowledgeBase: [ADR-006, ADR-009, ADR-013, RULE-REQUEST-01, RULE-REQUEST-02, RULE-REQUEST-03, RULE-REQUEST-04, RULE-AVAIL-04, RULE-SCHED-01, RULE-SCHED-03, RULE-SCHED-04, RULE-PAY-11, RULE-CANCEL-07, RULE-SERVICE-05, RULE-RELY-06, ENUM-REQUEST-STATUS, ENUM-BOOKING-TYPE, CFG-AVAIL-EXPIRY-MIN, CFG-SCHED-EXPIRY-HOURS, CFG-SCHED-MIN-LEAD-MIN, CFG-SCHED-MAX-HORIZON-DAYS, CFG-COMMISSION-PCT, CFG-CANCEL-REFUND-PCT, CFG-INCONVENIENCE-FEE, CFG-LATE-CANCEL-WINDOW-HOURS]
blockedByTbc: []
labels: [quicktrimr, phase-2, backend, database]
```

**Context**

The centre of the product. Everything downstream reads what this writes.

**The snapshots are the reason this ticket is careful** (`ADR-009`, `RULE-REQUEST-02`). The service price and the commission percentage are captured **here**, before any payment call, and never looked up again. That is what makes `RULE-SERVICE-04` true — a barber changing prices tomorrow cannot alter this booking — and it is why the commission decision (`P0-D02`) gates this ticket.

**This ticket deliberately does not call Stripe.** `ADR-006` authorises payment at request time, and `P3-T01` builds that; `P3-T06` wires it in. Keeping Stripe out of Phase 2 is what stops this phase depending on the next one.

**Scope**

`create-booking-request` Edge Function.

Validate: authenticated client with a complete profile, an owned and unarchived address, an eligible barber (`RULE-ONBOARD-04`), an active barber service for the category, and a price within `RULE-SERVICE-05` bounds.

Use the shared read-side eligibility helper from `P2-T01` to enforce `RULE-RELY-06` on direct requests: suspension blocks both types; a current cooldown blocks Available Now only; restricted outside a cooldown remains bookable. Re-check server-owned state rather than trusting a stale search result. Reuse `409 barber_unavailable` without disclosing private reliability history to the client.

Booking-type rules — Available Now: reject if the client already holds an active pending Available Now request (`RULE-AVAIL-04`). Scheduled: reject a duplicate intent (`RULE-SCHED-03`) and enforce the lead time and horizon from `RULE-SCHED-04`.

Write the request plus its snapshots: service price cents, commission percentage (`RULE-PAY-11`), derived gross, commission and barber net, the address, and the barber's details at request time. Read the percentage from `CFG-COMMISSION-PCT`; round commission down and give the barber the remainder. Do not deduct payment-processing fees from barber net or add a client card surcharge.

Snapshot the booking-type-specific cancellation terms and Scheduled window from config (`RULE-CANCEL-07`) at the same point. Later config edits cannot change this booking's refund, inconvenience allocation or cancellation deadline. These are server-owned snapshots, not client-supplied policy values.

Set the expiry: `CFG-AVAIL-EXPIRY-MIN` or `CFG-SCHED-EXPIRY-HOURS` from config, never a literal.

Double-submit protection on a deterministic, server-derived key (`RULE-REQUEST-03`) — a double tap creates one request.

Audit log (`ADR-013`).

**Contract example** — `create-booking-request`

```jsonc
// request — no amounts. The server derives every one of them.
{ "bookingType": "available_now", "barberId": "3b90...",
  "serviceCategoryId": "c14a...", "clientAddressId": "a71f...",
  "notes": "Buzzer 4B" }

// 200
{ "id": "d5e1...", "status": "pending", "bookingType": "available_now",
  "servicePriceCents": 4500, "commissionPct": 20,
  "grossCents": 4500, "commissionCents": 900, "barberNetCents": 3600,
  "expiresAt": "2026-08-05T04:16:22Z", "createdAt": "2026-08-05T04:11:22Z" }

// 409 — RULE-AVAIL-04
{ "error": "active_request_exists", "existingRequestId": "b334..." }

// 409 — RULE-SCHED-03
{ "error": "duplicate_request_intent", "existingRequestId": "c901..." }

// 409 — barber ineligible
{ "error": "barber_unavailable" }

// 422 — outside RULE-SCHED-04 bounds; example uses current config values
{ "error": "validation_failed",
  "fields": { "scheduledFor": "Must be between 4 hours and 30 days from now" } }

// 401
{ "error": "unauthenticated" }
```

**Acceptance criteria**

- [ ] A valid Available Now and a valid Scheduled request are each created with correct snapshots.
- [ ] **Every monetary value is server-derived** — a request body containing an amount, commission or net is ignored, proven by sending one.
- [ ] Price and commission snapshots are written before any other work and are integer cents.
- [ ] Cancellation terms and Scheduled window are snapshotted server-side at request time; tests change current config and prove the existing booking's terms remain unchanged.
- [ ] A second active pending Available Now request for the same client returns `409 active_request_exists` (`RULE-AVAIL-04`).
- [ ] A duplicate Scheduled intent returns `409 duplicate_request_intent` (`RULE-SCHED-03`).
- [ ] A Scheduled time inside the lead time or beyond the horizon is rejected per `RULE-SCHED-04`.
- [ ] Scheduled validation applies only the global bounds at launch; it does not invent a barber calendar, working hours, service duration or overlap check.
- [ ] A barber failing `RULE-ONBOARD-04`, or with no active price for the category, returns `409 barber_unavailable`.
- [ ] Direct requests enforce `RULE-RELY-06` even after an earlier successful search; test both types, every level, cooldown boundaries, and forged client standing/deadline fields. Denial creates no request or payment side effect.
- [ ] An address belonging to another client, or archived, is rejected.
- [ ] Expiry is set from config; **no literal 5 or 2 appears in the code.**
- [ ] **A double-submit creates exactly one request** — tested with real parallel calls.
- [ ] An audit log is written.
- [ ] No Stripe call is made by this function.

**Tests** — parallel double-submit producing one request; a body-supplied amount ignored; `RULE-AVAIL-04` and `RULE-SCHED-03` conflicts; minimum-lead and maximum-horizon boundaries at, just inside and just outside; cross-client address rejected; ineligible barber rejected; snapshot values asserted exactly.

**Out of scope** — payment authorisation (`P3-T01`, wired by `P3-T06`); the submission UI (`P2-T09`); notifications (`P6-T02`); acceptance (`P2-T12`).

**Sync notes** — eight tickets read what this writes. The snapshot fields in particular are read by every payment, earning, refund and admin surface — changing their shape reaches all of Phase 3.

---

#### P2-T09 — Client booking request submission

```yaml
id: P2-T09
title: "Client booking request submission"
issueType: Story
owner: Andrew
phase: 2
priority: Highest
jiraKey: null
dependsOn: [P0-D08, P0-T14, P1-T12, P2-T05, P2-T08]
affects: [P3-T08, P4-T01]
knowledgeBase: [ADR-006, RULE-REQUEST-03, RULE-REQUEST-04, RULE-AVAIL-06, RULE-SCHED-02, RULE-SCHED-04, RULE-CANCEL-07, RULE-COPY-01, ENUM-REQUEST-STATUS, CFG-AVAIL-EXPIRY-MIN, CFG-SCHED-EXPIRY-HOURS, CFG-SCHED-MIN-LEAD-MIN, CFG-SCHED-MAX-HORIZON-DAYS]
blockedByTbc: []
labels: [quicktrimr, phase-2, mobile]
```

**Context**

The confirmation screen and the waiting state after it.

Two things must be honest here. First, `RULE-REQUEST-04` — a request cannot be edited, so the review screen is the last chance to change anything and must say so. Second, `ADR-006` means the client's card is authorised at this moment, not charged; `RULE-COPY-01` forbids describing a hold as a payment, and a client who sees a pending amount on their statement and was told they were "charged" will dispute it.

**Scope**

A review screen showing barber, service, price, address, requested time for Scheduled, and — stated plainly — that the amount is held, not taken, until the barber accepts. Because time passes and config can change after selection in `P2-T05`, revalidate the draft against the current server-provided bounds before submission and surface the backend's field error without replacing it with a hard-coded limit.

Submit, with the button disabled while in flight. `RULE-REQUEST-03` protects the server; this protects the client from seeing two requests.

A pending state with a live countdown to expiry (`RULE-AVAIL-06`, `RULE-SCHED-02`). The countdown is **display only** — the server expires the request (`ADR-011`), and the screen re-checks rather than deciding.

Terminal states rendered honestly: accepted, declined, expired, cancelled — each with a next action.

**Acceptance criteria**

- [ ] The review screen shows barber, service, price, address, and time for Scheduled bookings.
- [ ] A Scheduled draft is revalidated against the current server-provided bounds before submission; stale or newly invalid selections retain the draft and show the server's field error.
- [ ] The screen states the amount is **held, not charged**, until acceptance (`RULE-COPY-01`, `ADR-006`).
- [ ] The screen states the request cannot be edited after submission (`RULE-REQUEST-04`).
- [ ] The applicable cancellation terms are disclosed before submission (`RULE-CANCEL-07`), using server-provided terms consistent with the request-time snapshot; test both booking types without describing a hold as a refund.
- [ ] The submit button is disabled while in flight; **a double tap produces one request.**
- [ ] The pending state shows a countdown to expiry.
- [ ] **The countdown does not expire the request** — it re-checks server state, and a client whose app was closed sees the correct terminal state on return.
- [ ] Accepted, declined, expired and cancelled each render distinctly with a next action.
- [ ] `409 active_request_exists` is handled with a message pointing at the existing request, not a generic error.
- [ ] Loading and error states exist; a failed submit does not lose the draft.

**Tests** — a selected time aging inside the minimum before submission; a config change invalidating a draft without losing it; requested-time copy before acceptance; double tap producing one request; countdown reaching zero without a client-side status change; each terminal state rendering; the `409` conflict path.

**Out of scope** — request creation (`P2-T08`); payment UI (`P3-T01`); cancellation (`P3-T08`).

**Sync notes** — `P3-T06` adds a payment step to this flow. The screen must be written so a payment-method step can be inserted before submission without a redesign.

---

#### P2-T10 — Barber request inbox query

```yaml
id: P2-T10
title: "Barber request inbox query"
issueType: Task
owner: Andrew
phase: 2
priority: High
jiraKey: null
dependsOn: [P0-T11, P2-T08]
affects: [P2-T11, P2-T12, P2-T13]
knowledgeBase: [ROLE-BARBER, RULE-DISCOVERY-04, ENUM-REQUEST-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-2, backend, security]
```

**Context**

What a barber sees before deciding. The privacy line sits exactly here: a barber deciding whether to accept needs distance, service, price and timing — **not the client's street address or phone number.** Those are revealed on acceptance (`ROLE-BARBER`), and a barber who declines has learned nothing about where the client lives.

Getting this wrong means every barber who receives a request learns an address, including the ones who decline, which is a far larger exposure than the accepted case.

**Scope**

A query or function returning pending requests addressed to the authenticated barber.

Returns: request id, booking type, service category, price snapshot, distance from the barber, expiry, client display name and rating, scheduled time for Scheduled requests, and any access notes that do not identify the location.

**Does not return:** street address, unit number, phone number, email, or exact coordinates.

Excludes expired, accepted, declined and cancelled requests, or marks them clearly.

Filtered and indexed on barber id and status; ordered so the soonest expiry is most visible.

RLS: a barber reads only requests addressed to them.

**Contract example** — barber inbox response

```jsonc
// 200 — note the absence of address and contact fields
{ "requests": [
    { "id": "d5e1...", "bookingType": "available_now",
      "serviceName": "Skin Fade", "priceCents": 4500,
      "clientDisplayName": "Sam R.", "clientRating": 4.9,
      "distanceKm": 3.2, "suburb": "Richmond",
      "expiresAt": "2026-08-05T04:16:22Z", "status": "pending" }
  ] }
```

**Acceptance criteria**

- [ ] A barber sees pending requests addressed to them, with service, price, distance, suburb, client display name and expiry.
- [ ] **The response contains no street address, unit, phone number, email or exact coordinate** — asserted field by field on the raw body.
- [ ] **Barber A cannot read a request addressed to barber B** — verified by calling with B's request id as A.
- [ ] Expired, accepted, declined and cancelled requests are excluded or clearly marked.
- [ ] The query is filtered and indexed; `EXPLAIN` shows an index scan on barber id and status.
- [ ] Ordering surfaces the soonest expiry first.
- [ ] A barber with no requests receives an empty array, not an error.

**Tests** — raw response asserted for absence of every identifying field; cross-barber denial; `EXPLAIN` index assertion; ordering by expiry.

**Out of scope** — the inbox UI (`P2-T11`); accept and decline (`P2-T12`, `P2-T13`); post-acceptance detail (`P4-T02`).

**Sync notes** — `P4-T02` shows the fuller detail after acceptance. The difference between the two responses **is** the privacy rule, so any field added here must be checked against `ROLE-BARBER`.

---

#### P2-T11 — Barber request inbox UI

```yaml
id: P2-T11
title: "Barber request inbox UI"
issueType: Story
owner: Andrew
phase: 2
priority: High
jiraKey: null
dependsOn: [P0-T14, P2-T02, P2-T10]
affects: [P2-T14]
knowledgeBase: [RULE-AVAIL-05, RULE-AVAIL-06, RULE-SCHED-02, ENUM-REQUEST-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-2, mobile]
```

**Context**

A barber decides in seconds, often mid-haircut. The screen has to make the decision information immediate and the expiry unmissable.

`RULE-AVAIL-05` — one active Available Now job — must be visible **before** the barber taps accept, not discovered as a `409` afterwards. A barber who taps accept and is refused has been told the platform is broken.

**Scope**

A list of pending requests with a card per request: service, price, distance, suburb, client name and rating, scheduled time where relevant, and a prominent countdown.

Available Now and Scheduled visually distinct — they have different urgencies and different expiry scales.

When the barber already holds an active Available Now job, other Available Now requests show as unacceptable **with the reason**, rather than offering an accept that will fail.

Refresh on focus and on push (`P6-T02`), so a barber returning to the app does not act on a stale list.

Empty state distinguishing "you're not Available Now" — with a link to the toggle — from "you're available and there's nothing yet".

**Acceptance criteria**

- [ ] Pending Available Now and Scheduled requests are listed and visually distinguished.
- [ ] Each card shows service, price, distance, suburb, client name and rating.
- [ ] A countdown to expiry is prominent on each card.
- [ ] **When a barber holds an active Available Now job, other Available Now requests show as unacceptable with the reason** (`RULE-AVAIL-05`) rather than a failing accept button.
- [ ] An expired request cannot be actioned and updates in place.
- [ ] The list refreshes on focus.
- [ ] The empty state distinguishes "not available" from "available, nothing yet", and the former links to the toggle.
- [ ] Loading and error states exist.
- [ ] No client address or contact detail is rendered.

**Tests** — the one-active-job state disabling other Available Now cards with a reason; expiry updating in place; both empty states rendering distinctly; no identifying field present in the rendered tree.

**Out of scope** — accept and decline actions (`P2-T14`); the query (`P2-T10`).

**Sync notes** — `P2-T14` adds the action buttons to these cards.

---

#### P2-T12 — Accept booking request

```yaml
id: P2-T12
title: "Accept booking request"
issueType: Task
owner: Tony
phase: 2
priority: Highest
jiraKey: null
dependsOn: [P0-D04, P0-T07, P2-T01, P2-T03, P2-T08, P2-T10]
affects: [P2-T14, P3-T02, P3-T06, P4-T01, P4-T02]
knowledgeBase: [ADR-010, ADR-013, RULE-REQUEST-05, RULE-AVAIL-05, RULE-AVAIL-07, RULE-RELY-06, ENUM-REQUEST-STATUS, ENUM-BOOKING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-2, backend, security]
```

**Context**

**The hardest concurrency problem in the backlog.** `RULE-REQUEST-05` says the first valid acceptance wins, and `RULE-AVAIL-05` says a barber holds one active Available Now job. Both are decided under contention: two devices, a retry, or a barber tapping twice.

**This ticket stops short of Stripe, deliberately.** The old backlog's equivalent captured payment here, which made Phase 2 depend on Phase 3. Acceptance moves the booking to `accepted_pending_payment` (`ENUM-BOOKING-STATUS`) — a status that exists precisely for this gap — and `P3-T06` wires capture in. Until then a booking sits in that status, which is correct and visible.

**Scope**

`accept-booking-request` Edge Function.

Validate: authenticated barber, request addressed to them, status still `pending`, and not past expiry. Expiry is checked against the **server clock**, never a client-supplied time.

Re-check current server-owned restrictions under `RULE-RELY-06` with the shared eligibility helper from `P2-T01` inside the acceptance transaction. Suspension blocks both types; cooldown blocks Available Now only; restricted outside cooldown is permitted. Coordinate with concurrent restriction writers so a stale preflight check cannot accept after a restriction takes effect. Never trust body-supplied standing or cooldown times.

Concurrency: a conditional update that transitions `pending → accepted` only if it is still `pending`, and a check that the barber holds no active Available Now job. Both under one transaction, with the row locked — but **no external call inside that lock** (`RULE-PAY-09`), which is another reason Stripe is not here.

On success: create the booking at `accepted_pending_payment`, write `booking_status_history` (`ADR-010`), set the Available Now session `busy` via `P2-T03`, and resolve the barber's other pending Available Now requests (`RULE-AVAIL-07`).

Audit log (`ADR-013`).

**Contract example** — `accept-booking-request`

```jsonc
// request
{ "requestId": "d5e1..." }

// 200
{ "requestId": "d5e1...", "bookingId": "9a02...",
  "requestStatus": "accepted", "bookingStatus": "accepted_pending_payment" }

// 409 — someone or something got there first
{ "error": "request_not_pending", "currentStatus": "expired" }

// 409 — RULE-AVAIL-05
{ "error": "active_job_exists", "activeBookingId": "7f10..." }

// 409 — RULE-RELY-06 now prevents accepting this booking type
{ "error": "barber_unavailable" }

// 403 — request not addressed to this barber
{ "error": "forbidden" }
```

**Acceptance criteria**

- [ ] A valid acceptance creates a booking at `accepted_pending_payment` and marks the request `accepted`.
- [ ] **Under real parallel acceptance attempts on one request, exactly one succeeds** and the rest receive `409 request_not_pending`. Tested with genuine concurrency and repeated runs, not sequential calls.
- [ ] **A barber holding an active Available Now job cannot accept a second** — tested under parallel attempts on two different requests.
- [ ] An expired request cannot be accepted; expiry is evaluated on the server clock.
- [ ] Current reliability restrictions are checked atomically with acceptance; `409 barber_unavailable` creates no booking/history/capture success. Test both booking types, cooldown boundaries and real parallel restriction-versus-acceptance attempts with a consistent transaction ordering.
- [ ] A request addressed to another barber returns 403.
- [ ] `booking_status_history` records the transition with actor and reason.
- [ ] The Available Now session transitions to `busy` through `P2-T03`, not by writing the status directly.
- [ ] The barber's other pending Available Now requests are resolved (`RULE-AVAIL-07`) and remain visible to their clients as terminal states.
- [ ] **No Stripe call is made** and no lock is held across an external call.
- [ ] An audit log is written.

**Tests** — N parallel accepts on one request, repeated, asserting exactly one winner every run; parallel accepts on two requests by one barber, asserting one active job; expiry boundary at, just inside and just outside; cross-barber 403; assertion that no Stripe call occurs.

**Out of scope** — payment capture (`P3-T02`, wired by `P3-T06`); the accept UI (`P2-T14`); notifications (`P6-T02`).

**Sync notes** — `P3-T06` extends this into capture. The `accepted_pending_payment` status is the seam between them, and admin (`P5-T04`) must be able to see a booking stuck in it.

---

#### P2-T13 — Decline booking request

```yaml
id: P2-T13
title: "Decline booking request"
issueType: Task
owner: Andrew
phase: 2
priority: High
jiraKey: null
dependsOn: [P2-T08, P2-T10]
affects: [P2-T14, P2-T15, P3-T06]
knowledgeBase: [ADR-013, RULE-REQUEST-06, RULE-AVAIL-03, ENUM-REQUEST-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-2, backend]
```

**Context**

The counterpart to acceptance, and simpler because nothing is created — but it still resets the consecutive-miss counter (`RULE-AVAIL-03`), which is the difference between a barber who declines politely and one who ignores requests.

Like `P2-T12`, it stops short of Stripe. `RULE-REQUEST-06` cancels the authorisation on decline, and `P3-T06` wires that in.

**Scope**

`decline-booking-request` Edge Function.

Validate authenticated barber, request addressed to them, still `pending`, not expired.

Transition `pending → declined` conditionally, so a decline racing an acceptance loses cleanly.

Reset the consecutive-miss counter via `P2-T03` — a decline is a response, not a miss.

An optional decline reason, for later insight into why requests are refused.

Audit log.

**Contract example** — `decline-booking-request`

```jsonc
// request
{ "requestId": "d5e1...", "reason": "too_far" }

// 200
{ "requestId": "d5e1...", "status": "declined" }

// 409 — already resolved
{ "error": "request_not_pending", "currentStatus": "accepted" }

// 403
{ "error": "forbidden" }
```

**Acceptance criteria**

- [ ] A barber can decline a pending request addressed to them.
- [ ] **A decline racing an acceptance loses cleanly** — the request ends `accepted`, the decline returns `409`, and no booking is corrupted.
- [ ] An expired or already-resolved request returns `409` with its current status.
- [ ] A request addressed to another barber returns 403.
- [ ] **Declining resets the consecutive-miss counter** (`RULE-AVAIL-03`).
- [ ] An optional reason is stored when supplied.
- [ ] The client sees the declined state on their pending screen.
- [ ] An audit log is written.
- [ ] No Stripe call is made.

**Tests** — parallel accept and decline on one request, repeated, asserting a consistent single outcome; miss-counter reset; cross-barber 403; expired request rejected.

**Out of scope** — authorisation cancellation (`P3-T06`); the decline UI (`P2-T14`); reliability consequences, which decline does not incur.

**Sync notes** — `P3-T06` adds authorisation cancellation to this path.

---

#### P2-T14 — Barber accept and decline UI

```yaml
id: P2-T14
title: "Barber accept and decline UI"
issueType: Story
owner: Andrew
phase: 2
priority: High
jiraKey: null
dependsOn: [P2-T11, P2-T12, P2-T13]
affects: [P4-T02]
knowledgeBase: [RULE-REQUEST-05, RULE-AVAIL-05, RULE-RELY-06, RULE-COPY-01, ENUM-REQUEST-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-2, mobile]
```

**Context**

Two buttons over a genuinely concurrent backend. The screen's job is to make losing a race feel like information rather than a failure: "another barber took this" and "this expired while you were deciding" are normal outcomes of `RULE-REQUEST-05`, not errors.

**Scope**

Accept and decline actions on the `P2-T11` cards, with a confirmation on accept — accepting commits the barber to travelling to an address.

Buttons disabled while in flight, and both disabled once either is tapped.

Every backend outcome mapped to a specific message: `409 request_not_pending` reads as "this request is no longer available", `409 active_job_exists` as "finish your current job first".

For `409 barber_unavailable`, refresh the barber's own standing and show the applicable cooldown or suspension explanation from server truth (`RULE-RELY-06`). Do not claim that restricted always means banned, or offer a client timer as a way to lift the restriction. Decline remains available when otherwise valid.

On success the list refreshes and the accepted booking is reachable.

Copy must not imply the client has been charged (`RULE-COPY-01`) — at this point nothing has been captured.

**Acceptance criteria**

- [ ] A barber can accept and decline from the inbox.
- [ ] Accept requires a confirmation.
- [ ] Buttons are disabled while in flight; **a double tap produces one call.**
- [ ] `409 request_not_pending` and `409 active_job_exists` each render a specific, non-technical message.
- [ ] `409 barber_unavailable` renders the current reliability explanation and refreshes standing; test cooldown, suspended and stale-screen outcomes without disabling an otherwise valid decline.
- [ ] An expired request cannot be actioned and updates in place.
- [ ] The list refreshes after either action and the accepted booking is reachable.
- [ ] No copy implies the client has been charged.
- [ ] Loading and error states exist.

**Tests** — double tap producing one call; each `409` mapping to its message; expiry during the decision rendering correctly.

**Out of scope** — the functions (`P2-T12`, `P2-T13`); booking detail (`P4-T02`).

**Sync notes** — `P3-T06` introduces a capture-failure outcome that this screen must also render.

---

#### P2-T15 — Booking request expiry

```yaml
id: P2-T15
title: "Booking request expiry"
issueType: Task
owner: Tony
phase: 2
priority: High
jiraKey: null
dependsOn: [P0-D07, P2-T03, P2-T08]
affects: [P3-T06, P4-T01]
knowledgeBase: [ADR-011, ADR-013, RULE-AVAIL-06, RULE-SCHED-02, RULE-REQUEST-05, RULE-REQUEST-06, RULE-AVAIL-03, ENUM-REQUEST-STATUS, CFG-AVAIL-EXPIRY-MIN, CFG-SCHED-EXPIRY-HOURS]
blockedByTbc: []
labels: [quicktrimr, phase-2, backend]
```

**Context**

`RULE-AVAIL-06` and `RULE-SCHED-02` expire unanswered requests. Without this, a client's authorisation is held indefinitely against a request nobody will answer.

**No client-side timers** (`ADR-011`). The countdown in `P2-T09` is display; this is the mechanism. A client who force-quits the app must still have their request expire and their hold released.

It stops short of releasing the hold — `RULE-REQUEST-06` cancels the authorisation, and `P3-T06` wires that in.

**Scope**

Expiry through Supabase `pg_cron` bounded indexed due-request sweeps (`ADR-011`), using
persisted deadlines from `CFG-AVAIL-EXPIRY-MIN` and `CFG-SCHED-EXPIRY-HOURS`. Own the
versioned schedule, protected handler, safe run evidence and operational configuration in this
slice. Prove sub-minute scheduling lateness under a stated peak workload without changing the
business expiry deadline; no recurring cron row per request or mobile-supplied clock.

Transition `pending → expired` **conditionally**, so a request accepted a second before the job fires is not overwritten. The schedule is a hint; the database is the truth (`ADR-011`).

Idempotent: firing twice leaves identical state.

Increment the consecutive-miss counter via `P2-T03` — an expiry is a miss.

**A reconciliation sweep** that catches requests past expiry which the primary sweep missed,
including missing work records and interrupted claims. Recover from authoritative request state,
not only existing job rows, and monitor oldest overdue requests plus an independent scheduler
heartbeat. Reuse the original operation identity. `P3-T06` integrates durable authorisation
release; this ticket must expose the recoverable expiry outcome without making a Stripe call.

Audit log per expiry.

**Acceptance criteria**

- [ ] An unanswered Available Now request expires at `CFG-AVAIL-EXPIRY-MIN`; a Scheduled one at `CFG-SCHED-EXPIRY-HOURS`.
- [ ] Values come from config; **no literal appears in the logic.**
- [ ] **A request accepted just before the job fires is not overwritten** — the conditional update is proven with a deliberate race.
- [ ] **Firing the same expiry twice leaves identical state.**
- [ ] Expiry increments the consecutive-miss counter (`RULE-AVAIL-03`).
- [ ] **A reconciliation sweep catches a deliberately dropped schedule** — demonstrated, not asserted.
- [ ] The client sees the expired state without having the app open at expiry time.
- [ ] An audit log is written per expiry.
- [ ] No Stripe call is made.

**Tests** — expiry boundary at, just inside and just outside; committed acceptance survives a
stale expiry; repeated real parallel accept/expiry races assert one legal committed outcome,
never unconditional acceptance priority or a new grace period; duplicate fire and miss-counter
idempotency; deliberately skipped primary work and missing work records recovered by
reconciliation; stopped-cron/interrupted-claim recovery; config change altering timing without
a code change; peak-load latency, independent heartbeat/overdue alerts and worker API denial.

**Out of scope** — authorisation cancellation (`P3-T06`); auto-completion, a different workflow (`P4-T11`).

**Sync notes** — this is one of seven scheduled-work consumers of `ADR-011`, not a separate
engine. The race-test correction follows the existing conditional transition and
`RULE-REQUEST-05`; it does not permit acceptance of expired requests. `P3-T06` adds durable,
idempotent authorisation release and provider reconciliation to this path.

---
## Phase 3 — Payments, Earnings, Cancellations & Payouts

**Goal:** an accepted request captures money, creates an earning, can be refunded under the cancellation rules, and can be batched for payout.

**This is the phase where mistakes cost money and some of them are irreversible.** A Stripe transfer to a barber's bank cannot be recalled. Every ticket here is idempotent on a server-derived key, and no ticket holds a database lock across a Stripe call.

**Gate:** a request is authorised at creation, captured on acceptance, produces a balanced earning, survives a duplicate call without double-charging, and can be refunded to a number that reconciles with what Stripe actually took.

---

#### P3-T01 — Payment authorisation

```yaml
id: P3-T01
title: "Payment authorisation"
issueType: Task
owner: Tony
phase: 3
priority: Highest
jiraKey: null
dependsOn: [P0-D02, P0-T18, P2-T08]
affects: [P3-T02, P3-T03, P3-T06, P3-T07]
knowledgeBase: [ADR-006, ADR-009, ADR-013, RULE-PAY-01, RULE-PAY-02, RULE-PAY-08, RULE-PAY-10, RULE-PAY-11, ENUM-PAYMENT-STATUS, CFG-COMMISSION-PCT]
blockedByTbc: []
labels: [quicktrimr, phase-3, backend, stripe, security]
```

**Context**

`ADR-006` — the client's card is authorised when they submit, so the barber never accepts a job whose payment then fails.

**The amount comes from the booking request's snapshot** (`RULE-PAY-01`, `P2-T08`), never from the request body and never from a live price lookup. A client who modifies the app cannot choose what they pay, and a barber who changes prices between request and acceptance cannot change it either.

`P0-D02` gates this because the commission basis and Stripe fee absorption determine what is actually authorised and how it later splits.

**Scope**

`create-payment-authorisation` Edge Function.

Read the amount from the booking request snapshot. Create a **manual-capture** PaymentIntent for that amount against the client's payment method. `RULE-PAY-11` forbids a client card-processing surcharge: do not inflate the amount with an estimated Stripe fee.

A `payments` row keyed to the request, statuses through `ENUM-PAYMENT-STATUS`, all amounts integer cents (`ADR-009`).

Payment method collection via Stripe's SDK — QuickTrimr never handles card numbers, and no card data reaches a QuickTrimr server or log.

**A deterministic, server-derived idempotency key** — derived from the request id, never client-supplied (`RULE-PAY-04`). A client-chosen key can be varied and defeats the guard entirely.

Handle: card declined, authentication required, insufficient funds, and Stripe unavailable — each a distinct, safe error.

Record the authorisation's expiry, which `P0-T18` established and `P0-D08` bounded, so a Scheduled booking cannot be confirmed against a dead hold.

Audit log. Never log a card number, a full payload, or a secret (`RULE-PAY-10`).

**Contract example** — `create-payment-authorisation`

```jsonc
// request — no amount. It comes from the request snapshot.
{ "bookingRequestId": "d5e1...", "paymentMethodId": "pm_1..." }

// 200
{ "paymentId": "p820...", "status": "authorised", "amountCents": 4500,
  "authorisationExpiresAt": "2026-08-12T04:11:22Z" }

// 402 — declined
{ "error": "card_declined", "declineCode": "insufficient_funds" }

// 402 — SCA
{ "error": "authentication_required", "clientSecret": "pi_1..._secret_..." }

// 409 — already authorised
{ "error": "already_authorised", "paymentId": "p820..." }

// 502
{ "error": "stripe_unavailable" }
```

**Acceptance criteria**

- [ ] A PaymentIntent is created with **manual capture**, for the amount on the request snapshot.
- [ ] **An amount in the request body is ignored** — proven by sending a different one and asserting the authorised amount matches the snapshot.
- [ ] Amounts are integer cents throughout; no float appears in the path.
- [ ] **The idempotency key is derived from the request id server-side** — a client-supplied key is ignored.
- [ ] **A duplicate call authorises once** — proven against the Stripe test dashboard showing one PaymentIntent.
- [ ] Card declined, authentication required, insufficient funds and Stripe unavailable each return distinct, safe errors.
- [ ] The authorisation expiry is recorded on the payment row.
- [ ] **No card number, full Stripe payload or secret is logged**, verified by inspecting logs after a run.
- [ ] A failed authorisation leaves the request in a defined state the client can retry from.
- [ ] An audit log is written.

**Tests** — duplicate call asserted against the Stripe dashboard as one intent; body amount ignored; each failure path returning its own error; the recorded expiry matching Stripe; a log scan asserting no card data.

**Out of scope** — capture (`P3-T02`); wiring into request creation (`P3-T06`); refunds (`P3-T07`).

**Sync notes** — `P3-T02` captures what this authorises and `P3-T07` refunds it. The `payments` row shape defined here is read by all of Phase 3 and by admin.

---

#### P3-T02 — Payment capture

```yaml
id: P3-T02
title: "Payment capture"
issueType: Task
owner: Tony
phase: 3
priority: Highest
jiraKey: null
dependsOn: [P0-D02, P2-T12, P3-T01]
affects: [P3-T04, P3-T06, P5-T04, P5-T09]
knowledgeBase: [ADR-006, ADR-009, ADR-010, ADR-013, RULE-PAY-03, RULE-PAY-04, RULE-PAY-05, RULE-PAY-06, RULE-PAY-09, RULE-PAY-11, ENUM-PAYMENT-STATUS, ENUM-BOOKING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-3, backend, stripe, security]
```

**Context**

The moment money actually moves. `RULE-PAY-04` — capture is idempotent, a duplicate call charges once — is the single most important assertion in this backlog, because the failure is a real client charged twice for one haircut.

`RULE-PAY-05` is the second: **a failed capture must never leave a booking confirmed with no money.** The `accepted_pending_payment` status exists for exactly this window, and a booking that sticks there is a real operational state admin must be able to see and act on.

`RULE-PAY-09` — no database lock across the Stripe call. Holding a booking row locked while Stripe is slow will exhaust connections under any real load.

**Scope**

`capture-authorised-payment` Edge Function.

Validate the payment is `authorised`, its booking is `accepted_pending_payment`, and the authorisation has not expired.

Capture with a **deterministic, server-derived idempotency key** based on the payment id.

On success: `payments` to `captured`, booking to `paid_confirmed`, `booking_status_history` written (`ADR-010`).

On failure: `payments` to `capture_failed`, booking **stays** `accepted_pending_payment`, and both parties are told. A defined, recoverable state — never a silent confirmation.

On an **expired authorisation**, a distinct error, because the recovery is different: the client must re-authorise, not retry.

Sequence so that no lock is held across the Stripe call: read state, release, call Stripe, then apply the result conditionally.

Stripe is the source of truth (`RULE-PAY-06`). The webhook in `P3-T03` reconciles anything this path misses. `RULE-PAY-11`'s processing fee is a QuickTrimr cost, not a barber-net deduction; reconcile against actual Stripe-reported processing fees, never the KB's illustrative fee.

**Contract example** — `capture-authorised-payment`

```jsonc
// request
{ "paymentId": "p820..." }

// 200
{ "paymentId": "p820...", "status": "captured", "capturedCents": 4500,
  "bookingStatus": "paid_confirmed" }

// 200 — already captured, idempotent no-op
{ "paymentId": "p820...", "status": "captured", "capturedCents": 4500,
  "bookingStatus": "paid_confirmed", "idempotent": true }

// 402 — capture failed; booking deliberately stays accepted_pending_payment
{ "error": "capture_failed", "declineCode": "card_declined",
  "bookingStatus": "accepted_pending_payment" }

// 409 — authorisation expired; client must re-authorise
{ "error": "authorisation_expired" }
```

**Acceptance criteria**

- [ ] A valid capture moves the payment to `captured` and the booking to `paid_confirmed`, writing status history.
- [ ] **A duplicate capture call charges once** — proven against the Stripe test dashboard showing a single charge, not one per call.
- [ ] **Parallel capture calls on one payment produce exactly one charge** — real concurrency, repeated runs.
- [ ] The idempotency key is derived server-side from the payment id.
- [ ] **A failed capture leaves the booking at `accepted_pending_payment`** and the payment at `capture_failed` — never a confirmed booking with no money.
- [ ] An expired authorisation returns `409 authorisation_expired`, distinct from a decline.
- [ ] **No database lock is held across the Stripe call** — demonstrated by the code path and by a load test that does not exhaust connections.
- [ ] Both parties are notified on success and on failure.
- [ ] Amounts are integer cents and match the authorised amount.
- [ ] An audit log is written for success and for failure.

**Tests** — duplicate and parallel capture asserted against the Stripe dashboard as one charge; capture failure using the `P0-T18` test card, asserting the booking status stays `accepted_pending_payment`; expired authorisation path; a concurrency load test asserting no lock is held across the external call.

**Out of scope** — wiring capture into acceptance (`P3-T06`); the webhook (`P3-T03`); earnings (`P3-T04`).

**Sync notes** — `P3-T06` calls this from the acceptance path. `P3-T04` creates the earning from a successful capture. `P5-T04` must surface bookings stuck at `accepted_pending_payment`, because that is where a capture failure leaves them.

---

#### P3-T03 — Stripe webhook router

```yaml
id: P3-T03
title: "Stripe webhook router"
issueType: Task
owner: Tony
phase: 3
priority: Highest
jiraKey: null
dependsOn: [P0-D05, P0-T18, P1-T09, P3-T01]
affects: [P3-T04, P3-T07, P3-T11, P5-T09]
knowledgeBase: [ADR-013, RULE-PAY-06, RULE-PAY-07, RULE-PAY-10, RULE-EARN-05, RULE-EARN-06, RULE-EARN-07, ENUM-PAYMENT-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-3, backend, stripe, security]
```

**Context**

`RULE-PAY-06` — Stripe is the source of truth. The webhook is how QuickTrimr learns about anything that happens outside a request it made: an asynchronous capture result, a dispute, a payout failure, a refund settling.

This **extends the handler from `P1-T09`** rather than creating a second endpoint. That handler already established signature verification and event deduplication; adding a second endpoint means two places to get verification wrong.

**Every webhook is delivered more than once.** Stripe retries on any non-2xx and sometimes on a 2xx it did not see. Deduplication is not defensive coding here, it is the specified behaviour.

**Scope**

Extend the `P1-T09` handler to route payment events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `charge.dispute.created`, and the Connect payout events `P3-T11` needs.

For connected-account bank payouts, route `payout.created`, `payout.updated`, `payout.paid` and `payout.failed` with verified account context and the persisted payout-to-item mapping. Reconcile cancellation from the provider's current payout state as well. Transfer success is not bank payment. `P3-T11` integrates the payout projection/reconciliation handlers here; unknown IDs or account mismatches must never credit an earning. Duplicate/out-of-order events, including a bank failure after `paid`, reconcile current provider state without overwriting immutable audit history.

Signature verification before any parsing (`RULE-PAY-07`). An unverified body is not data and is not logged as though it were.

Deduplicate on the Stripe event id, persisted. A replayed event is a no-op.

**Handlers are idempotent and order-independent.** Stripe does not guarantee ordering, so a `succeeded` arriving after a locally applied capture must reconcile rather than double-apply.

Fast acknowledgement, with slow work deferred — a handler that exceeds Stripe's timeout triggers a retry storm.

Unrecognised event types acknowledged and logged, never errored: a 500 on an event QuickTrimr does not care about causes Stripe to retry it indefinitely.

Safe logging: event type and id only (`RULE-PAY-10`).

**Acceptance criteria**

- [ ] Payment, refund, dispute and payout events are routed to handlers.
- [ ] Connected-account payout routing preserves verified account/payout identity, rejects mismatched mappings, and supports late bank failure plus duplicate/out-of-order reconciliation; it never treats a transfer event as bank payment.
- [ ] **An invalid or missing signature returns 400, parses nothing, and writes nothing.**
- [ ] **A replayed event id produces exactly one effect** — verified by delivering the same event three times and asserting identical state.
- [ ] Handlers are order-independent — a `succeeded` arriving after a local capture reconciles instead of double-applying.
- [ ] An unrecognised event type is acknowledged with 200 and logged, not errored.
- [ ] The endpoint acknowledges within Stripe's timeout under load.
- [ ] No full payload, card detail or secret is logged.
- [ ] Events that change state write audit logs.
- [ ] Handler failures are logged with enough detail to replay, without leaking data.

**Tests** — tampered signature rejected; same event delivered three times producing one effect; out-of-order delivery reconciling; unknown event type acknowledged; a timing assertion on acknowledgement latency; connected-account identity/mapping mismatches rejected. `P3-T11` supplies live transfer-versus-payout and paid-then-failed integration cases, not a second endpoint.

**Out of scope** — Connect account events (`P1-T09`); refund initiation (`P3-T07`); payout processing (`P3-T11`).

**Sync notes** — four tickets depend on events routed here. Adding an event type means adding an idempotent handler, never a new endpoint.

---

#### P3-T04 — Barber earnings

```yaml
id: P3-T04
title: "Barber earnings"
issueType: Task
owner: Tony
phase: 3
priority: High
jiraKey: null
dependsOn: [P0-D02, P0-D03, P0-T10, P3-T02, P3-T03]
affects: [P3-T05, P3-T07, P3-T10, P4-T09, P4-T11, P5-T09]
knowledgeBase: [ADR-009, ADR-013, RULE-EARN-01, RULE-EARN-02, RULE-EARN-03, RULE-CANCEL-07, RULE-PAY-08, RULE-PAY-11, ENUM-EARNING-STATUS, CFG-COMMISSION-PCT]
blockedByTbc: []
labels: [quicktrimr, phase-3, backend, database]
```

**Context**

What the barber is owed, held separate from what the client paid. `KB §11` keeps `payments` and `barber_earnings` as different tables because commission separates those amounts. Stripe payment-processing fees reduce **QuickTrimr's share**, not the barber's entitlement (`RULE-PAY-11`); merging these numbers loses the ability to reconcile them.

`RULE-EARN-01` — one earning per booking, enforced by the unique constraint from `P0-T10`. A duplicate earning is a barber paid twice, which is the irreversible direction.

The earning starts `pending`. Service completion releases it; the approved cancellation exception releases only the adjusted inconvenience amount after cancellation and refund success (`RULE-EARN-02`, `RULE-CANCEL-07`). An open dispute blocks either path (`RULE-EARN-03`).

**Scope**

`create-barber-earning`, called on successful capture.

Amounts derived from the **booking's snapshots** (`ADR-009`) and the commission rule from `P0-D02`: gross, commission, barber net, all integer cents.

At initial capture, service gross minus commission equals original barber net exactly. Commission is rounded down using the booking's snapshotted percentage, never today's config. Subsequent refunds/cancellations preserve those snapshots but reconcile the adjusted amounts: captured gross equals refunded amount plus adjusted barber entitlement plus retained commission. QuickTrimr's post-processing position is retained commission minus the actual retained processing fee; never deduct that fee from barber net (`RULE-PAY-11`, `RULE-CANCEL-07`).

Idempotent on booking id — a repeated call returns the existing earning.

`release-barber-earning` moving `pending → available` only after a server-verified eligible outcome: completion (`P4-T09`, `P4-T11`), the cancellation/refund-success exception (`P3-T07`, `RULE-CANCEL-07`), or an already-specified eligible admin dispute resolution (`P5-T07`). Refuse while a dispute is open. The cancellation caller must supply no trusted client assertion: verify persisted cancellation/refund state and the adjusted earning; never release the original service net as well. `P3-T07` owns the cancellation integration, not this ticket.

Audit log on creation and on every status change.

**Contract example** — `create-barber-earning`

```jsonc
// 200 — created
{ "earningId": "e44b...", "bookingId": "9a02...", "status": "pending",
  "grossCents": 4500, "commissionCents": 900, "barberNetCents": 3600,
  "commissionPctSnapshot": 20 }

// 200 — already exists, idempotent
{ "earningId": "e44b...", "status": "pending", "idempotent": true }

// 409 — release attempted while a dispute is open
{ "error": "dispute_open", "disputeId": "f77c..." }
```

**Acceptance criteria**

- [ ] An earning is created on successful capture, at `pending`, from the booking snapshots.
- [ ] **At initial capture, gross minus commission equals original barber net exactly**; after a refund/cancellation, captured gross equals refunded amount plus adjusted barber entitlement plus retained commission. Assert both identities in integer cents without mutating the original snapshots.
- [ ] The commission percentage used is the **booking's snapshot**, not the current config value.
- [ ] Stripe fee treatment follows `RULE-PAY-11` and is applied, not improvised.
- [ ] **A second earning cannot be created for a booking** — enforced by the unique constraint and proven under parallel calls.
- [ ] A repeated create returns the existing earning without a second row.
- [ ] `release-barber-earning` verifies the eligible server-owned outcome per `RULE-EARN-02`; for cancellation it rejects pending/failed refunds and releases only the adjusted inconvenience amount, never the original service net as well.
- [ ] **A release attempt while a dispute is open returns `409 dispute_open`** and leaves the earning `pending` (`RULE-EARN-03`).
- [ ] All amounts are integer cents; no float appears anywhere.
- [ ] Audit logs are written on creation and every status change.

**Tests** — arithmetic reconciliation across several prices including ones that do not divide evenly, asserting the `P0-D02` rounding direction; parallel create producing one earning; release blocked by an open dispute; a snapshot-versus-current-config test proving the snapshot wins after the config changes; cancellation release rejected until refund success, with no fake completion or second entitlement.

**Out of scope** — the earnings screen (`P3-T05`); payout batching (`P3-T10`); completion triggers (`P4-T09`, `P4-T11`).

**Sync notes** — the tickets in `affects` read or adjust this row, including `P3-T07`'s cancellation path. Preserve request-time snapshots separately from adjustments, and keep `P0-D02` service rounding distinct from `P0-D03` cancellation rounding.

---

#### P3-T05 — Barber earnings and balance screen

```yaml
id: P3-T05
title: "Barber earnings and balance screen"
issueType: Story
owner: Tony
phase: 3
priority: Medium
jiraKey: null
dependsOn: [P0-D05, P0-T14, P1-T08, P3-T04, P3-T11]
affects: []
knowledgeBase: [RULE-EARN-02, RULE-EARN-04, RULE-EARN-05, RULE-EARN-07, RULE-CANCEL-07, RULE-COPY-01, ENUM-EARNING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-3, mobile]
```

**Context**

**`RULE-EARN-04` is the whole point of this screen.** "Available" is a QuickTrimr balance, not money in a bank account, and the gap between them is the most likely support complaint on the platform. A barber who reads "available: $340" and checks their bank on Tuesday concludes QuickTrimr has not paid them.

`RULE-COPY-01` binds the copy here. This screen distinguishes when processing is scheduled from the estimated bank-arrival date, without promising arrival before Stripe confirms it. `P0-D05` defines the policy; `P3-T11` provides the live payout projection.

**Scope**

An earnings screen in the barber journey: pending, available, queued for payout, and paid-out totals, plus a list of recent earnings with per-booking detail.

**Explicit copy** distinguishing a QuickTrimr balance from a bank balance, and the **next scheduled processing date**, labelled with Australia/Sydney timezone, from `RULE-EARN-07`. Show Stripe's estimated bank-arrival date only when known and label it as an estimate. Show payout status, retry eligibility, action-required holds and corrective guidance; a blocked item must not promise payment next Monday. Transfer success alone never renders as bank-paid. Standard Connect/payout fees do not reduce the displayed barber entitlement.

Each earning links to its booking, showing gross, commission and net — a barber who cannot see the commission on a specific job will ask, and the answer should be on the screen.

For the `RULE-EARN-02` cancellation exception, identify the amount as an inconvenience earning on a cancelled booking, not a completed service. Show its adjusted entitlement and zero retained commission; test this alongside pending/available states without claiming bank payment.

Money rendered from integer cents through one formatter.

A barber with no earnings gets an empty state explaining when the first one appears.

RLS: a barber sees only their own earnings.

**Acceptance criteria**

- [ ] The barber sees pending, available, queued and paid-out totals, and a recent earnings list.
- [ ] **The screen states plainly that "available" is a QuickTrimr balance, not money in the bank** (`RULE-EARN-04`, `RULE-COPY-01`).
- [ ] **The next scheduled processing date and timezone are shown**, separately from Stripe's estimated bank-arrival date when known (`RULE-EARN-07`). Unknown estimates, bank-holiday delays, action-required holds and late bank failures render truthfully, without hiding the queued entitlement or promising payment on the next run.
- [ ] Each earning shows gross, commission and net for its booking.
- [ ] Amounts are formatted from integer cents by a single formatter; no ad-hoc formatting.
- [ ] **Barber A cannot see barber B's earnings** — verified at the API.
- [ ] Every `ENUM-EARNING-STATUS` value renders, including `reversed`.
- [ ] Loading, error and empty states exist; the empty state explains when the first earning appears.
- [ ] No copy implies money has reached the barber's bank when it has not.

**Tests** — cross-barber denial at the API; every earning status rendering; total arithmetic matching the sum of the listed earnings; copy assertions for the balance disclaimer, timezone, processing versus estimated arrival, unknown estimate and blocked/retry state; a successful transfer with a pending bank payout never shows paid-out; late bank failure corrects the display; standard Connect/payout fees never reduce barber net.

**Out of scope** — payout batching (`P3-T10`, `P3-T11`); manual withdrawal, which does not exist; admin views (`P5-T09`).

**Sync notes** — this and `P1-T08` both describe the barber's money state. They must agree, or a barber reads two different answers about whether they are being paid.

---

#### P3-T06 — Wire payments into the request lifecycle

```yaml
id: P3-T06
title: "Wire payments into the request lifecycle"
issueType: Task
owner: Tony
phase: 3
priority: Highest
jiraKey: null
dependsOn: [P2-T08, P2-T09, P2-T12, P2-T13, P2-T15, P3-T01, P3-T02]
affects: [P4-T01, P4-T02, P5-T04]
knowledgeBase: [ADR-006, ADR-010, RULE-PAY-02, RULE-PAY-03, RULE-PAY-05, RULE-REQUEST-06, ENUM-BOOKING-STATUS, ENUM-PAYMENT-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-3, backend, stripe]
```

**Context**

Phase 2 built the request lifecycle with a deliberate hole where Stripe goes. This ticket fills it, in one place, for all four touchpoints.

**This ticket exists because the alternative is worse.** The previous backlog had acceptance capturing payment inside `P2-E04-T01`, which made Phase 2 depend on Phase 3 and meant the concurrency work and the payment work landed in one ticket nobody could review. Splitting them means `P2-T12`'s concurrency was proven before money was involved, and this ticket changes one thing at a time.

**Scope**

Four wirings:

| Point | Wiring |
|---|---|
| `P2-T08` request created | Call `P3-T01` to authorise (`RULE-PAY-02`) |
| `P2-T12` accepted | Call `P3-T02` to capture; `paid_confirmed` on success (`RULE-PAY-03`) |
| `P2-T13` declined | Cancel the authorisation (`RULE-REQUEST-06`) |
| `P2-T15` expired | Cancel the authorisation (`RULE-REQUEST-06`) |

Request creation is **not confirmed until authorisation succeeds**. A request created with a failed authorisation must not sit pending against a barber who will accept a job that cannot be paid.

Acceptance retains its concurrency guarantees from `P2-T12` and still holds **no lock across the Stripe call** (`RULE-PAY-09`).

Capture failure keeps the booking at `accepted_pending_payment` (`RULE-PAY-05`), notifies both parties, and offers a defined recovery.

Authorisation cancellation on decline and expiry is idempotent — an already-cancelled authorisation is not an error.

`P2-T09` gains a payment-method step before submission, and `P2-T14` gains a capture-failure outcome.

**Acceptance criteria**

- [ ] Creating a request authorises payment; a failed authorisation means no pending request is left against the barber.
- [ ] Accepting captures payment and moves the booking to `paid_confirmed` on success.
- [ ] **Acceptance still yields exactly one winner under parallel attempts** — `P2-T12`'s concurrency tests still pass with capture wired in.
- [ ] **No lock is held across the Stripe call** in the acceptance path.
- [ ] A capture failure leaves the booking at `accepted_pending_payment`, notifies both parties, and offers a recovery path.
- [ ] Declining cancels the authorisation; expiring cancels the authorisation.
- [ ] **Cancelling an already-cancelled authorisation is a no-op, not an error.**
- [ ] **No client is left with a held authorisation on a request that reached a terminal state** — asserted across accept, decline, expire and cancel.
- [ ] `P2-T09` collects a payment method before submission; `P2-T14` renders the capture-failure outcome.
- [ ] Status history is written at each transition.

**Tests** — an end-to-end assertion that every terminal request state releases or captures the hold, with no authorisation left outstanding; `P2-T12`'s concurrency suite re-run with capture wired; capture failure leaving the documented state; double authorisation-cancel as a no-op.

**Out of scope** — refunds (`P3-T07`); earnings creation, which `P3-T04` triggers from capture.

**Sync notes** — this ticket changes the behaviour of five Phase 2 tickets. Their tests must still pass afterwards, and any that do not indicate the wiring changed a guarantee it should not have.

---

#### P3-T07 — Cancellation and refund rules

```yaml
id: P3-T07
title: "Cancellation and refund rules"
issueType: Task
owner: Tony
phase: 3
priority: Highest
jiraKey: null
dependsOn: [P0-D02, P0-D03, P0-D04, P3-T02, P3-T03, P3-T04, P3-T06]
affects: [P3-T08, P3-T09, P3-T12, P5-T07, P5-T09]
knowledgeBase: [ADR-009, ADR-013, RULE-CANCEL-01, RULE-CANCEL-02, RULE-CANCEL-03, RULE-CANCEL-04, RULE-CANCEL-05, RULE-CANCEL-07, RULE-PAY-11, RULE-EARN-01, RULE-EARN-02, RULE-EARN-03, RULE-RELY-06, ENUM-BOOKING-STATUS, ENUM-PAYMENT-STATUS, CFG-LATE-CANCEL-WINDOW-HOURS, CFG-CANCEL-REFUND-PCT, CFG-INCONVENIENCE-FEE]
blockedByTbc: []
labels: [quicktrimr, phase-3, backend, stripe, security]
```

**Context**

The most arithmetically delicate ticket in the backlog. Four distinct cases, each with a different refund, and every one has to reconcile against what Stripe actually captured — including the fee Stripe does not return on a refund.

`P0-D03` supplies the approved booking-type-specific cancellation allocation and earning-release exception; `P0-D02` supplies platform processing-fee absorption. Cancellation is not the normal proportional-commission service-refund calculation.

**Every calculation belongs in `packages/domain`**, pure and unit-testable (`KB §7`). Refund maths tested only through an Edge Function against live Stripe is refund maths nobody will change with confidence.

**Scope**

`cancel-booking` and `cancel-booking-request`, branching on who cancels, booking type, and timing against `CFG-LATE-CANCEL-WINDOW-HOURS`.

Four cases (`RULE-CANCEL-01`–`RULE-CANCEL-04`):

| Case | Outcome |
|---|---|
| Client, before acceptance | Authorisation cancelled, nothing captured, no penalty |
| Either party, Scheduled, outside the window | Full refund, no penalty |
| Client, inside the window or Available Now after acceptance | Partial refund plus barber inconvenience payment, per `RULE-CANCEL-07` |
| Barber, inside the window or Available Now after acceptance | Full client refund plus a reliability event |

Pure functions in `packages/domain` taking the booking snapshot, the actor, the time and relevant server-derived fee inputs, returning the refund, the barber amount and the QuickTrimr position — all integer cents. Use the request-time cancellation terms (`RULE-CANCEL-07`): currently 75% late Scheduled / 50% accepted Available Now, client refund rounded up and the entire remainder allocated to the barber. Reverse all original cancellation commission. Refund plus barber amount plus QuickTrimr's post-processing position plus retained Stripe processing fee must equal what was captured; QuickTrimr's position is negative when Stripe retains a fee. Never refund an uncaptured hold or apply today's config retrospectively.

Refunds are idempotent on a server-derived key. A double-tapped cancel refunds once.

Earnings adjusted: `reversed` on a full refund, otherwise adjust the existing earning to the inconvenience amount and make it available through `P3-T04` only after cancellation/refund success and with no open dispute (`RULE-EARN-02`). Pending or failed refunds cannot release it. Preserve the cancelled booking status and original snapshots; never create a second service entitlement or fake completion. A retry cannot apply either refund or earning adjustment twice.

Barber cancellation raises a reliability event via `P3-T12` only where `RULE-CANCEL-04` applies; an outside-window Scheduled cancellation remains penalty-free (`RULE-CANCEL-02`).

Use `RULE-RELY-06` offence eligibility and the booking's snapshotted late window. Deduplicate by booking so retries/refund callbacks cannot add another offence or restart cooldown. A cancelled booking is the event source, not a client claim or a duplicate payment notification. Reliability changes must not alter the approved refund or earning allocation.

Audit log with the calculated amounts and the rule applied.

**Contract example** — `cancel-booking`

The following amounts implement `RULE-CANCEL-07` for a 4500-cent captured service. `platformRetainedCents` is retained commission **before processing fees**, which is zero on cancellation, not QuickTrimr's post-processing position. With an illustrative retained fee of 107 cents that position is -107; never treat zero commission as zero processing cost. The booking type and all amounts come from server-owned state, not the request.

```jsonc
// request
{ "bookingId": "9a02...", "reason": "client_unavailable" }

// 200 — client cancels accepted Available Now booking
{ "bookingId": "9a02...", "status": "cancelled",
  "refundCents": 2250, "barberInconvenienceCents": 2250,
  "platformRetainedCents": 0, "capturedCents": 4500,
  "ruleApplied": "RULE-CANCEL-03" }

// 200 — client cancels Scheduled booking at or within the 12-hour window
{ "bookingId": "9a02...", "status": "cancelled",
  "refundCents": 3375, "barberInconvenienceCents": 1125,
  "platformRetainedCents": 0, "capturedCents": 4500,
  "ruleApplied": "RULE-CANCEL-03" }

// 200 — barber cancels inside the Scheduled window
{ "bookingId": "9a02...", "status": "cancelled",
  "refundCents": 4500, "barberInconvenienceCents": 0,
  "platformRetainedCents": 0, "capturedCents": 4500,
  "ruleApplied": "RULE-CANCEL-04" }

// 200 — before acceptance
{ "bookingId": "9a02...", "status": "cancelled",
  "refundCents": 0, "authorisationCancelled": true, "ruleApplied": "RULE-CANCEL-01" }

// 409 — booking already terminal
{ "error": "booking_not_cancellable", "currentStatus": "completed" }
```

**Acceptance criteria**

- [ ] All four cancellation cases are implemented per `RULE-CANCEL-01`–`RULE-CANCEL-04` and `RULE-CANCEL-07`.
- [ ] **Every calculation lives in `packages/domain` as a pure function** with no I/O, unit-tested without a database or network.
- [ ] **In every case the amounts reconcile against what Stripe captured** — refund plus barber amount plus QuickTrimr position plus unreturned Stripe fee equals the captured total, asserted in integer cents.
- [ ] Timing is evaluated against `CFG-LATE-CANCEL-WINDOW-HOURS` on the server clock, at the exact boundary.
- [ ] **A duplicate cancel refunds once** — proven against the Stripe test dashboard.
- [ ] Cancelling before acceptance cancels the authorisation and captures nothing.
- [ ] A barber cancellation subject to `RULE-CANCEL-04` raises exactly one reliability event; an outside-window Scheduled cancellation raises none.
- [ ] A full refund reverses the earning. A partial cancellation refund leaves only the inconvenience entitlement, available only after cancellation/refund success and with no open dispute; pending/failed refunds cannot release it.
- [ ] A cancellation never marks the booking completed or leaves both a service earning and an inconvenience entitlement payable.
- [ ] An already-terminal booking returns `409 booking_not_cancellable`.
- [ ] Audit logs record the calculated amounts and the rule applied.

**Tests** — pure unit tests for all four cases and both booking types across uneven prices against `RULE-CANCEL-07`; exact Scheduled boundary and one minute either side; current-config changes cannot alter booking snapshots; duplicate cancel asserted as one refund in Stripe; reconciliation including negative QuickTrimr positions; earning remains pending for pending/failed refund or open dispute, releases only the adjusted inconvenience amount after success, and reverses on full refund; retries and stale completion cannot create a second entitlement.

**Out of scope** — cancellation UI (`P3-T08`, `P3-T09`); admin refunds (`P5-T07`); the reliability engine (`P3-T12`).

**Sync notes** — `P3-T08` and `P3-T09` display these numbers **before** the user confirms (`RULE-CANCEL-06`), so they must call the same domain functions rather than reimplementing the maths. A divergence means the screen promises one refund and the backend issues another.

---

#### P3-T08 — Client cancellation

```yaml
id: P3-T08
title: "Client cancellation"
issueType: Story
owner: Tony
phase: 3
priority: High
jiraKey: null
dependsOn: [P0-D03, P0-T14, P2-T09, P3-T07]
affects: []
knowledgeBase: [RULE-CANCEL-01, RULE-CANCEL-02, RULE-CANCEL-03, RULE-CANCEL-06, RULE-CANCEL-07, RULE-COPY-01, CFG-LATE-CANCEL-WINDOW-HOURS, CFG-CANCEL-REFUND-PCT]
blockedByTbc: []
labels: [quicktrimr, phase-3, mobile]
```

**Context**

`RULE-CANCEL-06` — the financial consequence is shown **before** confirmation. A client who cancels and then discovers they were refunded half will dispute the charge, and they will be right to.

The screen must call the same `packages/domain` functions as `P3-T07`. A screen that estimates the refund and a backend that calculates it will eventually disagree, and the client will have been shown a promise the system then broke.

**Scope**

Cancel actions on the pending request screen and on a confirmed booking.

Before confirmation, show: the refund amount, any barber payment, and which rule applies — computed by the shared domain function, not estimated. Use the booking's snapshotted cancellation terms, including the Scheduled boundary and refund-up rounding; distinguish hold release, full refund and each partial-refund case (`RULE-CANCEL-07`).

`ConfirmDialog` from `P0-T14` with the consequence in the body and a destructive variant.

Distinguish the free case (before acceptance, or outside the window) from the penalised case with clearly different framing.

Handle a booking that became non-cancellable while the client was deciding — a barber marking complete mid-decision is a real race.

**Acceptance criteria**

- [ ] A client can cancel an eligible pending request and an eligible confirmed booking.
- [ ] **The refund amount and any barber payment are shown before confirmation** (`RULE-CANCEL-06`).
- [ ] **The displayed amounts come from the same `packages/domain` functions the backend uses** — not a client-side estimate.
- [ ] The free case and the penalised case are framed distinctly.
- [ ] Confirmation is required, with the consequence in the dialog body.
- [ ] `409 booking_not_cancellable` renders a clear message and refreshes the booking.
- [ ] The result shows the actual refund issued, and it matches what was displayed.
- [ ] No copy misdescribes a hold as a charge (`RULE-COPY-01`).
- [ ] Loading and error states exist; a failed cancel does not leave the UI showing cancelled.

**Tests** — displayed amount matching the backend result across all four cases; the mid-decision race rendering correctly; confirmation required before any call.

**Out of scope** — the backend (`P3-T07`); barber cancellation (`P3-T09`).

**Sync notes** — shares domain functions with `P3-T07` and `P3-T09`. A change to the maths changes all three at once, which is the intent.

---

#### P3-T09 — Barber cancellation

```yaml
id: P3-T09
title: "Barber cancellation"
issueType: Story
owner: Tony
phase: 3
priority: High
jiraKey: null
dependsOn: [P0-D03, P0-D04, P0-T14, P3-T07, P3-T12]
affects: []
knowledgeBase: [RULE-CANCEL-02, RULE-CANCEL-04, RULE-CANCEL-06, RULE-CANCEL-07, RULE-RELY-01, RULE-RELY-03, RULE-RELY-06, RULE-COPY-01]
blockedByTbc: []
labels: [quicktrimr, phase-3, mobile]
```

**Context**

A barber cancelling an accepted job refunds the client in full and receives nothing. A reliability consequence applies in the late/Available Now cases (`RULE-CANCEL-04`), not a penalty-free outside-window Scheduled cancellation (`RULE-CANCEL-02`). The applicable consequence must be shown **before** confirmation.

`RULE-RELY-02` commits QuickTrimr to recoverability, so the screen should also say how the consequence lifts. A penalty with no stated path back reads as permanent.

**Scope**

A cancel action on a confirmed booking in the barber journey.

Before confirmation, show: the client is refunded in full, the barber receives nothing, and any applicable reliability consequence — the level it moves them to and what that level does (`RULE-RELY-06`). For an outside-window Scheduled cancellation, state that no reliability penalty applies (`RULE-CANCEL-02`).

`ConfirmDialog` with the consequence and a destructive variant.

After confirming, show the new reliability level and, per `P0-D04`, when it improves.

Use `RULE-RELY-06`: fourth-and-later offences still show automatic `restricted` plus eligibility for human suspension review, never promise automatic suspension. Distinguish cooldown end from level recovery; explain that an approved suspension requires human reinstatement. The always-accessible standing display is in `P2-T02`, not only this cancellation flow.

Handle a booking that became non-cancellable mid-decision.

**Acceptance criteria**

- [ ] A barber can cancel an eligible confirmed booking.
- [ ] **The reliability consequence is shown before confirmation** — the resulting level and what it does (`RULE-CANCEL-06`, `RULE-RELY-06`).
- [ ] The screen states the client is refunded in full and the barber receives nothing.
- [ ] Confirmation is required, with the consequence in the dialog body.
- [ ] After cancelling, the new reliability level is shown, along with how it recovers (`RULE-RELY-02`).
- [ ] Exactly one reliability event is raised where `RULE-CANCEL-04` applies; no event is raised for a penalty-free outside-window Scheduled cancellation.
- [ ] `409 booking_not_cancellable` renders clearly and refreshes.
- [ ] Loading and error states exist.

**Tests** — the displayed consequence matching what `P3-T12` actually applies; exactly one reliability event where `RULE-CANCEL-04` applies including under a double tap, and none for the outside-window Scheduled case; the mid-decision race.

**Out of scope** — the backend (`P3-T07`); the reliability engine (`P3-T12`); admin reliability management (`P5-T13`).

**Sync notes** — the consequence shown here is computed by `P3-T12`. If they diverge, the barber is warned of one outcome and given another.

---

#### P3-T10 — Payout batch model and queueing

```yaml
id: P3-T10
title: "Payout batch model and queueing"
issueType: Task
owner: Tony
phase: 3
priority: Medium
jiraKey: null
dependsOn: [P0-D02, P0-D03, P0-D05, P3-T04, P3-T07]
affects: [P3-T11, P5-T10]
knowledgeBase: [ADR-009, ADR-013, RULE-EARN-02, RULE-EARN-03, RULE-EARN-04, RULE-EARN-05, RULE-EARN-06, RULE-EARN-07, RULE-CANCEL-07, ENUM-EARNING-STATUS, ENUM-PAYOUT-STATUS, CFG-PAYOUT-SCHEDULE, CFG-PAYOUT-MIN-CENTS]
blockedByTbc: []
labels: [quicktrimr, phase-3, backend, database]
```

**Context**

Grouping available earnings into a batch, and the last safe point before money leaves. `RULE-EARN-06` — an earning is never in two open batches and never paid twice — has to be enforced by a database constraint, because a payout is the irreversible operation in this system.

**Scope**

`queue-payout-batch` creating a batch from earnings that are `available` and satisfy `RULE-EARN-07`'s cut-off and minimum from `P0-D05`.

Read the weekly Monday 10:00 Australia/Sydney schedule and one-cent positive-total minimum from config. Persist the scheduled period/cut-off and config used; use the scheduled instant, not worker start time. Only the current server-recorded availability period beginning strictly before that instant qualifies. At/after-boundary earnings wait for the next run. Produce one global batch with per-barber totals; zero totals produce no money call. A delayed job retains the same cut-off, and daylight saving changes the UTC instant, not the local hour.

Earnings move `available → queued_for_payout` in the same transaction that adds them to the batch. A batch item and an earning status that can disagree is a reconciliation problem later.

A **database constraint** preventing an earning from being in two non-terminal batches. Not application logic.

Also protect the durable payout obligation across failed/cancelled batch statuses: retries resume the original item, not a new claim on its earnings. Retain distinct transfer, payout and attempt identities for `P3-T11`, including confirmed late bank failures. A terminal status alone must never make an earning eligible for duplicate allocation.

Batch statuses through `ENUM-PAYOUT-STATUS`, with per-barber totals.

Idempotent batch creation — running the job twice for one period produces one batch.

Only eligible `available` earnings with no open dispute may be queued. Include the adjusted inconvenience earning released after cancellation/refund success (`RULE-EARN-02`, `RULE-CANCEL-07`) even though its booking is cancelled. Do not require fake completion, include reversed full-refund earnings, or queue an amount while its cancellation refund is pending/failed. Existing eligible admin-resolution outcomes remain supported. Apply `RULE-EARN-07`'s normal cut-off and minimum; this exception does not decide payout cadence.

If bank/account eligibility prevents queueing an otherwise available balance, retain that balance without a fake queued/paid state and persist the block reason/action for `P3-T11`'s notification and status projections. An unqueued account hold must not disappear merely because no batch item exists.

Audit log per batch and per item.

**Acceptance criteria**

- [ ] A batch is created from eligible `available` earnings per `RULE-EARN-07`.
- [ ] Earnings move to `queued_for_payout` in the same transaction as batch item creation.
- [ ] **A database constraint prevents an earning being in two non-terminal batches** — proven by attempting it directly in SQL.
- [ ] **Running the batch job twice for one period produces one batch** — real parallel runs.
- [ ] The cut-off and minimum balance follow `RULE-EARN-07` and both config entries; exact equality, one millisecond either side, daylight saving in both directions, delayed execution, one cent and zero are tested. No literal appears in feature logic.
- [ ] A retry/late bank failure cannot create a second allocation of the original obligation even when a batch/item is marked failed or cancelled.
- [ ] An earning attached to a disputed booking is never queued.
- [ ] An otherwise available balance blocked before queueing remains visible with its bank/account reason and next action, without creating a fake queued item or issuing a payment.
- [ ] An eligible cancellation inconvenience earning is queued once without completing the booking; full-refund reversals and pending/failed cancellation refunds are excluded, tested through the `P3-T07` adjustment path.
- [ ] Batch totals equal the sum of their items exactly, in integer cents.
- [ ] Audit logs are written per batch and per item.

**Tests** — direct SQL attempt to double-queue an earning rejected by the constraint; parallel batch runs producing one batch; totals reconciling against items; a disputed booking's earning excluded; strict cut-off/DST/delayed-job/minimum boundaries; failed/cancelled original items cannot be allocated again. Actual scheduling/recovery is integrated by `P3-T11` using `P0-D07`, not a mobile timer.

**Out of scope** — processing and transferring (`P3-T11`); admin views (`P5-T10`).

**Sync notes** — `P3-T11` processes what this queues. The constraint here is the guard that stops a double payout, so it is the thing to preserve if the model changes.

---

#### P3-T11 — Payout batch processing

```yaml
id: P3-T11
title: "Payout batch processing"
issueType: Task
owner: Tony
phase: 3
priority: Medium
jiraKey: null
dependsOn: [P0-D05, P0-D07, P0-T18, P1-T07, P3-T03, P3-T10]
affects: [P3-T05, P5-T10, P6-T02]
knowledgeBase: [ADR-011, ADR-013, RULE-EARN-02, RULE-EARN-03, RULE-EARN-04, RULE-EARN-05, RULE-EARN-06, RULE-EARN-07, RULE-PAY-04, RULE-PAY-06, RULE-PAY-09, RULE-ONBOARD-04, RULE-NOTIF-01, RULE-NOTIF-03, ENUM-EARNING-STATUS, ENUM-PAYOUT-STATUS, CFG-PAYOUT-SCHEDULE]
blockedByTbc: []
labels: [quicktrimr, phase-3, backend, stripe, security]
```

**Context**

**The external money boundary.** A Stripe transfer funds a connected Stripe balance; a separate bank payout sends funds to the barber's bank. Transfer success is not proof of bank payment, and bank funds cannot be assumed recoverable. Tracking both stages is necessary to avoid double funding, false paid-out states and misleading copy.

Everything here is idempotent on a server-derived key, no lock is held across a Stripe call, and a partial failure leaves a state that can be resumed without re-paying anyone who was already paid.

**Scope**

`process-payout-batch` through Supabase `pg_cron` bounded due-work scans (`ADR-011`), per
`RULE-EARN-07`. Own the server-side weekly trigger, recovery of dropped/late runs and integration
with `P3-T10`; use the persisted scheduled cut-off, never a client clock or fixed UTC offset.
Version schedules/permissions, persist and recover interrupted claims/attempts, and inspect
authoritative queued obligations even when a dispatch record is missing. Independent heartbeat,
overdue-batch and held-item monitoring must detect a stopped scheduler. Record operational
settings and prove the actual protected worker path, not just a direct call to its handler.

Per barber, recheck earning/refund/dispute eligibility and `RULE-ONBOARD-04` before movement. Use `P0-T18`/`P1-T07`'s verified payout controls. Persist a **deterministic idempotency key derived from the batch item id**, operation and durable attempt identity for each external call. Persist/reconcile transfer and bank-payout IDs separately, including crashes between provider success and local persistence. A weekly retry cannot rely on Stripe retaining a key forever; reconcile unknown outcomes first. If already funded, never transfer those funds again when retrying the bank payout. A replacement payout requires confirmed failure/cancellation and reconciled returned funds; reserve/check the obligation under concurrency so two replacements cannot win.

Transfer success and payout creation leave earnings `queued_for_payout`; only Stripe-confirmed bank-payout `paid` moves mapped earnings to `paid_out` and the item to `paid`. Verified late bank failure corrects the projection back to queued/failed with new audit records, never erased history. Recheck current provider state for stale/out-of-order events. QuickTrimr absorbs standard Connect/payout fees; reconcile actual fees separately without reducing snapshotted barber entitlement.

Confirmed temporary failures, including insufficient settled funds, retry the original obligation next weekly run. Invalid bank details/restricted accounts enter an action-required hold, with reason and barber/admin notification; no attempted transfer/payout to an ineligible account. Resume only after verified correction, reconciled funds and the next run. Unknown results stay under reconciliation, not blind retry. Persist held age, next action, retry eligibility and estimated arrival when provided. Alert on holds/uncertainty and expose provider holding deadlines for operational escalation before the limit; no indefinite silent carry or forfeiture.

**Per-item, not per-batch, transactionality.** One barber's failure must not roll back or re-attempt another's completed transfer or payout. No database lock spans either external call. A batch is `paid` only when all items are successfully paid, not merely terminal. Failure/cancellation and later corrections must remain visible.

Integrate the account-scoped asynchronous payout routes in `P3-T03`, retaining the payout-to-item/earning mapping and durable deduplication. Produce durable payout/balance-change notification events for the barber and action-required/uncertainty alerts for admin; `P6-T02` integrates shared delivery without making financial success depend on push success. Expose the live own-barber projection to `P3-T05` and admin-only detail to `P5-T10`, with API-level denial tests and no bank details or secrets. No separate integration ticket.

Include `P3-T10`'s unqueued bank/account holds in those alerts and projections, not only attempted payments. After correction, queue still-available earnings under the normal next-run cut-off; only already-queued obligations resume an existing item. Test that an account blocked before its first batch is visible/notified and cannot silently strand an available balance.

Append-only audit log per item/attempt and correction, recording safe transfer/payout references and failure reasons.

**Acceptance criteria**

- [ ] The weekly trigger and recovery process the correct frozen cut-off, including DST/holidays and dropped/late runs, with no duplicate batch or client-side timer.
- [ ] A queued batch is processed per barber through separate funding-transfer and bank-payout stages, subject to eligible earnings, account readiness and settled funds.
- [ ] **The idempotency key is derived from the batch item id**, operation and durable attempt identity server-side; unknown outcomes and retries after key retention expiry reconcile before another money call.
- [ ] **Re-running a partially processed batch does not re-pay an already-paid item** — proven against the Stripe test dashboard.
- [ ] **Parallel runs of the same batch produce one transfer per item** — real concurrency, repeated.
- [ ] Concurrent bank-payout attempts and replacements produce only one successful payment per obligation; bank-payout failure never repeats a successful funding transfer. Prove against Stripe test mode, including crash-after-success and late paid-then-failed events.
- [ ] A barber whose Connect account no longer satisfies `RULE-ONBOARD-04` is skipped, with the item marked and the reason recorded — no transfer is attempted.
- [ ] A failed item does not roll back or re-attempt a succeeded item in the same batch.
- [ ] Failure handling follows `RULE-EARN-07`: next-run temporary retry, action-required hold until verified correction, and reconciliation of unknown outcomes; held funds/age/deadline/next action and barber/admin notification events remain visible.
- [ ] **No database lock is held across a Stripe transfer or bank-payout call.**
- [ ] Earnings become `paid_out` only on their mapped bank payout's confirmed `paid` state; late failures correct projections with append-only evidence. Batch status reaches `paid` only when all items are successfully paid.
- [ ] Standard Connect/payout fees never reduce barber entitlement; actual provider costs are reconciled separately from booking snapshots.
- [ ] Audit logs retain every item/attempt/correction with separate Stripe transfer and payout references, without bank details or secrets.
- [ ] Payout events from `P3-T03` reconcile the recorded state.
- [ ] Live barber/admin projections enforce role and cross-barber denial at the API, and notification failure never changes financial state.

**Tests** — a deliberately interrupted batch resumed, asserted against Stripe as one transfer and one successful bank payout per obligation; repeated parallel runs; crash after either external success; retry beyond idempotency retention; confirmed failed payout replacement without re-funding; paid-then-failed/out-of-order events; restricted/invalid account hold and corrected-next-run release; insufficient settled funds; newly opened dispute/refund hold; mixed paid/failed batch never labelled paid; fee absorption; scheduled DST/holiday/late/dropped-run behavior; API denials; durable notifications and send failure; no lock across either external call.

**Out of scope** — batch creation (`P3-T10`); admin payout views (`P5-T10`); live-mode payouts (`P6-T11`).

**Sync notes** — the last ticket before money leaves QuickTrimr. Any change here is reviewed against the double-payout guarantee first and everything else second.

---

#### P3-T12 — Barber reliability engine

```yaml
id: P3-T12
title: "Barber reliability engine"
issueType: Task
owner: Tony
phase: 3
priority: High
jiraKey: null
dependsOn: [P0-D04, P0-D07, P0-T10, P2-T01, P2-T02, P2-T04, P3-T07]
affects: [P2-T01, P2-T02, P2-T04, P2-T08, P2-T12, P2-T14, P3-T09, P5-T03, P5-T13]
knowledgeBase: [ADR-011, ADR-013, RULE-RELY-01, RULE-RELY-02, RULE-RELY-03, RULE-RELY-04, RULE-RELY-05, RULE-RELY-06, ENUM-RELIABILITY-LEVEL, CFG-RELIABILITY-WINDOW-DAYS, CFG-RELIABILITY-RESET-DAYS, CFG-RELIABILITY-COOLDOWN-MIN, CFG-RELIABILITY-THRESHOLDS, CFG-RELIABILITY-SEARCH-PENALTY]
blockedByTbc: []
labels: [quicktrimr, phase-3, backend, database]
```

**Context**

The knowledge base describes reliability across five rules and two tables, and **the previous backlog had no ticket that built it** — `P3-E03-T03` said a barber cancellation "creates a reliability event" with nothing owning the engine that consumes one. This ticket is that engine.

It affects someone's income, so `RULE-RELY-02`'s recoverability and `RULE-RELY-05`'s audited admin override are requirements, not niceties. The event log is append-only: a barber disputing a suspension needs the history to be reconstructable.

**Scope**

An append-only `barber_reliability_events` log — offence type, booking, server occurrence timestamp, config evidence and the level before and after. Corrections/excused events are new, reasoned records, never edits. Exactly one qualifying offence per cancelled booking, including duplicate/concurrent event delivery. Misses, declines, client cancellations and early Scheduled cancellations are not offences. No-show allegations are not automatic offences.

`barber_reliability_state` holding the current level and the window it was computed over, recomputed rather than incremented, so a correction to the event log produces a correct level.

Pure level calculation in `packages/domain` (`KB §7`): given events and a window, return the level. Unit-testable with no database, which is what makes `P0-D04`'s thresholds tunable without fear.

A Supabase `pg_cron` bounded indexed recovery sweep (`ADR-011`) implementing `RULE-RELY-06` —
automatic levels improve as offences age out, using the exact open-lower/closed-upper rolling
window. Idempotent, reconcilable and re-checking current state;
no pass may reinstate an admin-suspended barber. Cooldown deadlines are anchored to qualifying offences, never
recovery/login/retry time. Preserve the evidence for prior decisions rather than rewriting
historical levels. Own versioned schedule/permissions and operational settings, interrupted-claim
recovery, and independent heartbeat/overdue-recovery monitoring in this slice. Test a stopped
scheduler and missing work record against authoritative event/state deadlines; read-side
eligibility checks must still enforce the existing rule while a materialized projection catches up.

Consequences applied per level from `RULE-RELY-06`: Available Now cooldown, restricted search demotion in both types and human-approved suspension. Automatic counts at or above the suspension-review threshold still produce `restricted`. Integrate live state/recovery into the shared read-side helper from `P2-T01` and re-run direct session/request/acceptance and search tests; stale stored levels cannot extend a penalty after recovery or bypass a current restriction. Coordinate event/admin writers with acceptance transactions. Existing bookings are not automatically cancelled and earned money is not confiscated.

An audited admin override (`RULE-RELY-05`) with a mandatory reason, written as an event so it appears in the same history.

Thresholds from config (`RULE-RELY-04`) — no literal in the logic.

**Acceptance criteria**

- [ ] Reliability events are recorded append-only; **no update or delete path exists**, enforced by the absent RLS policy.
- [ ] Level calculation is a pure function in `packages/domain`, unit-tested with no database.
- [ ] The level is **recomputed from events**, not incrementally mutated.
- [ ] Every threshold, window and cooldown comes from config; **no literal appears in the logic.**
- [ ] Levels improve as offences age out of the window (`RULE-RELY-02`), on a scheduled pass that is idempotent.
- [ ] The KB's UTC timeline and exact window/cooldown boundaries hold with the app closed; a dropped schedule is reconciled and deadline checks do not depend on job punctuality.
- [ ] Fourth-and-later offences never automatically suspend; approved suspension persists through aging and requires a human reinstatement record.
- [ ] Duplicate/concurrent cancellation events count once and do not extend cooldown; exceptions/corrections preserve original events and trigger correct recomputation.
- [ ] Consequences are applied per level: cooldown, search penalty, accept restriction.
- [ ] `P2-T04` reflects the search penalty.
- [ ] An admin override requires a reason and is written as an event visible in the same history (`RULE-RELY-05`).
- [ ] A barber can see their level and how it recovers.
- [ ] Every level change writes an audit log.

**Tests** — pure unit tests across all `RULE-RELY-06` levels and worked-example rows; each time boundary and both sides; fourth offence awaiting review; suspension surviving automatic reset; corrected/excused event recomputation; real parallel duplicate events and restriction-versus-acceptance; recovery twice as a no-op and dropped-job reconciliation; config-driven thresholds; append-only cross-user read/write denial at the API plus attempted SQL update/delete; both-type search ordering across page boundaries; live session/request/acceptance guard integration; existing bookings and earning amounts unchanged by reliability state alone.

**Out of scope** — building the barber-facing displays (`P2-T02`, `P3-T09`), though their live integration is tested here; admin management UI (`P5-T13`); the Available Now missed-request auto-disable, which is `P2-T03`.

**Sync notes** — `P3-T07` raises events here, `P2-T04` consumes the search penalty, `P5-T13` overrides. Changing the level calculation changes who is discoverable, so `P2-T04`'s results change with it.

---
## Phase 4 — Booking Lifecycle, ETA, Completion, Disputes & Reviews

**Goal:** a confirmed booking runs to completion, auto-completion, or dispute.

**This is where the barber physically arrives.** The client's address is revealed here, under the narrowest rule in the knowledge base, and the ETA surface is the one that must not imply tracking it does not do.

**Gate:** all three completion cases from `RULE-COMPLETE-02`–`RULE-COMPLETE-04` work end to end, including both auto-completion paths, and an open dispute holds the earning.

---

#### P4-T01 — Client booking views

```yaml
id: P4-T01
title: "Client booking views"
issueType: Story
owner: Andrew
phase: 4
priority: High
jiraKey: null
dependsOn: [P0-T14, P0-T15, P2-T09, P2-T15, P3-T06]
affects: [P4-T06, P4-T10, P4-T15]
knowledgeBase: [ADR-010, RULE-COPY-01, ENUM-BOOKING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-4, mobile]
```

**Context**

Where a client sees what is happening. `ENUM-BOOKING-STATUS` has fifteen values and **every one must render something honest**, including `accepted_pending_payment` — the window `RULE-PAY-05` leaves open when a capture fails, which a client will see if their card is declined at acceptance.

`RULE-COPY-01` applies throughout: an authorised amount is not a charge, and a status must not promise more than the system does.

**Scope**

A booking list segmented into active, upcoming and past, and a detail screen.

Detail shows: barber, service, price, address, time, current status, and the actions allowed in that status.

Every `ENUM-BOOKING-STATUS` value maps to a client-facing label and an explanation of what happens next. `accepted_pending_payment` says the payment is being processed and what to do if it fails.

Actions rendered per status: cancel when cancellable, confirm completion when prompted, dispute when in window, review when eligible.

TanStack Query with the key factory from `P0-T15`, refetching on focus.

**Acceptance criteria**

- [ ] A client sees only their own bookings, verified at the API.
- [ ] Bookings are segmented into active, upcoming and past.
- [ ] **Every `ENUM-BOOKING-STATUS` value renders a client-facing label and a next-step explanation** — driven from the shared enum tuple so a new status fails the test until handled.
- [ ] `accepted_pending_payment` explains the payment is processing and what happens on failure.
- [ ] Available actions match the status; no action is offered that the backend will reject.
- [ ] Amounts are formatted from integer cents; a held amount is described as held, not charged.
- [ ] The list refetches on focus.
- [ ] Loading, error and empty states exist.

**Tests** — a status-coverage test driven from the shared tuple; cross-client denial at the API; the action set asserted per status.

**Out of scope** — completion actions (`P4-T10`); ETA (`P4-T06`); reviews (`P4-T15`).

**Sync notes** — three tickets mount surfaces inside this detail screen.

---

#### P4-T02 — Barber booking views

```yaml
id: P4-T02
title: "Barber booking views"
issueType: Story
owner: Andrew
phase: 4
priority: High
jiraKey: null
dependsOn: [P0-T14, P2-T12, P2-T14, P3-T06]
affects: [P4-T03, P4-T04, P4-T08]
knowledgeBase: [ADR-010, ROLE-BARBER, RULE-COPY-01, ENUM-BOOKING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-4, mobile, security]
```

**Context**

**This is where the client's address is revealed.** `ROLE-BARBER` allows it only for an accepted, active booking, and only while it stays active — which makes this the most privacy-sensitive screen in the barber journey.

The rule has a specific consequence that is easy to miss: once a booking is completed or cancelled, the address should no longer be displayed. A barber's booking history showing every client's home address is a standing exposure on a device that may be lost.

**Scope**

A booking list segmented into active, upcoming and past, and a detail screen.

Detail for an **active** booking: client name, contact, full address with unit and access notes, service, price, and the barber's net amount.

Detail for a **completed or cancelled** booking: service, price, net, suburb — **not** the full address or contact details.

Every `ENUM-BOOKING-STATUS` value renders with the actions allowed in that status.

The net amount, not just the gross, so the barber sees what they earn without doing arithmetic.

**Acceptance criteria**

- [ ] A barber sees only their own bookings, verified at the API.
- [ ] **Full address and contact details appear only for an accepted, active booking** (`ROLE-BARBER`).
- [ ] **A completed or cancelled booking does not display the full address or contact details** — asserted on the raw response body, not the rendered screen.
- [ ] Access notes appear with the address for an active booking.
- [ ] Every `ENUM-BOOKING-STATUS` value renders with its allowed actions.
- [ ] The barber's net amount is shown alongside the gross.
- [ ] The list refetches on focus.
- [ ] Loading, error and empty states exist.

**Tests** — raw response asserted field by field for an active versus a completed booking, proving the address is absent from the latter; cross-barber denial; status coverage from the shared tuple.

**Out of scope** — on-the-way (`P4-T03`, `P4-T04`); completion (`P4-T08`).

**Sync notes** — the address visibility rule implemented here is the one `P4-T03` depends on. Widening it widens it everywhere.

---

#### P4-T03 — Mark on the way

```yaml
id: P4-T03
title: "Mark on the way"
issueType: Task
owner: Andrew
phase: 4
priority: High
jiraKey: null
dependsOn: [P1-T05, P4-T02]
affects: [P4-T04, P4-T05, P4-T06]
knowledgeBase: [ADR-004, ADR-010, ADR-013, RULE-ETA-01, ROLE-BARBER, ENUM-BOOKING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-4, backend, maps]
```

**Context**

The transition that starts ETA. `RULE-ETA-01` — nothing is tracked before this tap (`ADR-004`), so this is the consent boundary: a barber who has not tapped it is not sharing their location, and the system must not read it.

**Scope**

`mark-on-the-way` Edge Function.

Validate the barber owns the booking and it is in a valid status — `paid_confirmed`, not a completed or cancelled one.

Capture the barber's location at this moment as the ETA origin, and trigger the first calculation via `P4-T05`.

Status to `on_the_way`, status history written (`ADR-010`).

Notify the client (`P6-T02`).

Reject a booking that is not confirmed, one already on the way, and one whose scheduled time is implausibly far off — a barber marking on-the-way for tomorrow's booking is an error worth catching.

Audit log.

**Contract example** — `mark-on-the-way`

```jsonc
// request
{ "bookingId": "9a02...", "lat": -37.8136, "lng": 144.9631 }

// 200
{ "bookingId": "9a02...", "status": "on_the_way",
  "etaMinutes": 14, "etaUpdatedAt": "2026-08-05T04:11:22Z" }

// 409 — wrong status
{ "error": "invalid_status_transition", "currentStatus": "completed" }

// 409 — already on the way
{ "error": "already_on_the_way" }

// 200 — ETA unavailable; the transition still succeeds
{ "bookingId": "9a02...", "status": "on_the_way",
  "etaMinutes": null, "etaUnavailable": true }
```

**Acceptance criteria**

- [ ] A barber can mark a `paid_confirmed` booking as on the way.
- [ ] The barber's location is captured as the ETA origin and the first ETA is triggered.
- [ ] **An ETA failure does not block the transition** — the booking still moves to `on_the_way` with a null ETA.
- [ ] An invalid status transition returns `409` naming the current status.
- [ ] Marking on-the-way twice is rejected or idempotent, and behaves the same way every time.
- [ ] A booking scheduled implausibly far ahead is rejected.
- [ ] Status history is written; the client is notified.
- [ ] Barber A cannot mark barber B's booking.
- [ ] **No location is read or stored before this call** (`RULE-ETA-01`).
- [ ] An audit log is written.

**Tests** — invalid transitions from each status; ETA failure not blocking; cross-barber denial; double call behaving consistently.

**Out of scope** — the UI (`P4-T04`); ETA refresh (`P4-T05`); client display (`P4-T06`).

**Sync notes** — `P4-T05` refreshes from the origin this captures.

---

#### P4-T04 — Barber on-my-way UI

```yaml
id: P4-T04
title: "Barber on-my-way UI"
issueType: Story
owner: Andrew
phase: 4
priority: High
jiraKey: null
dependsOn: [P4-T02, P4-T03]
affects: []
knowledgeBase: [ADR-004, RULE-ETA-01, RULE-ETA-05, RULE-COPY-01]
blockedByTbc: []
labels: [quicktrimr, phase-4, mobile, maps]
```

**Context**

One button with a permission prompt behind it. `RULE-ETA-05` and `RULE-COPY-01` mean the screen must not suggest the client is watching the barber move — the barber should know exactly what is shared, which is periodic ETA, not a live position.

**Scope**

An "I'm on my way" action on an eligible booking, visible only in a valid status.

Location permission requested at this point, not at app launch, with a clear explanation. A denied permission is handled: the transition still happens, without an ETA.

Once on the way, show the current ETA and last-updated time, plus what the client can see — stated plainly.

A route or navigation handoff to the client's address.

Marking arrived where that transition is used.

**Acceptance criteria**

- [ ] The action appears only when the booking status permits it.
- [ ] Location permission is requested at the point of use with an explanation.
- [ ] **Denying the permission still allows the transition**, without an ETA, with the consequence explained.
- [ ] After transitioning, the barber sees the current ETA and last-updated time.
- [ ] **The screen states what the client can see** — an ETA, not a live position (`RULE-ETA-05`).
- [ ] Navigation handoff to the address works.
- [ ] Loading and error states exist; a failed call does not leave the UI showing on-the-way.

**Tests** — permission-denied path completing the transition; action visibility per status; no copy implying live tracking.

**Out of scope** — the function (`P4-T03`); ETA refresh (`P4-T05`).

---

#### P4-T05 — ETA calculation and refresh

```yaml
id: P4-T05
title: "ETA calculation and refresh"
issueType: Task
owner: Andrew
phase: 4
priority: High
jiraKey: null
dependsOn: [P0-D06, P0-D07, P0-T18, P4-T03]
affects: [P4-T06]
knowledgeBase: [ADR-004, ADR-008, ADR-011, RULE-DISCOVERY-05, RULE-ETA-02, RULE-ETA-03, RULE-ETA-04, RULE-ETA-05, CFG-ETA-REFRESH-MIN]
blockedByTbc: []
labels: [quicktrimr, phase-4, backend, maps, security]
```

**Context**

Google Routes is called **from the server only** (`RULE-ETA-02`, `ADR-008`). The server key never reaches the mobile bundle, and a leaked key is billed to QuickTrimr until someone notices.

Throttling is both a cost control and a privacy control: each refresh is a Routes call and a location read. `CFG-ETA-REFRESH-MIN` comes from `P0-D06`, which is why this ticket waits on it.

**The stop condition matters as much as the refresh.** `RULE-ETA-04` stops updates when the booking is no longer active — an ETA job still running against a completed booking is reading a barber's location for no reason.

**Scope**

`update-eta` Edge Function calling Google Routes from the server, using the server key.

The first ETA is calculated immediately when the booking enters `on_the_way`. Later scheduled
refreshes use the fixed interval from `CFG-ETA-REFRESH-MIN`; the cadence does not scale with
distance or remaining ETA.

Store the ETA and its `updated_at` together (`RULE-ETA-03`) — an ETA without a timestamp is unusable, because a client cannot tell a fresh estimate from a ten-minute-old one.

Throttle to `CFG-ETA-REFRESH-MIN`. A call inside the window returns the cached value rather than calling Routes.

Refresh through Supabase `pg_cron` bounded indexed due-ETA sweeps (`ADR-011`), re-checking
booking state and the configured throttle at execution. This slice owns versioned schedule
setup, server-only handler permissions, interrupted-work recovery and independent heartbeat/
overdue-refresh alerts. Concurrent claims must not turn one due refresh into multiple Routes
calls. Empty ticks make no Routes calls, and recovery does not replay missed historical refreshes
in a burst; it requests only a currently eligible update under the existing throttle. Record
operational settings and exercise the actual scheduled path in the deployed test environment.

**Stop when the booking leaves `on_the_way` or `arrived`** — completed, cancelled or disputed all halt refreshes, and the stop is verified rather than assumed.

Routes failures are logged safely and leave the last known ETA with its timestamp, rather than clearing it.

Location updates accepted only from the booking's barber, and only while the booking is active.
The barber's origin coordinate and the route polyline stay server-side; the client response contains
only the ETA and its last-updated timestamp.

**Acceptance criteria**

- [ ] ETA is calculated server-side via Google Routes using the server key.
- [ ] The first ETA is calculated immediately on the transition to `on_the_way`; later refreshes use the fixed configured interval rather than a distance-scaled cadence.
- [ ] **The Google server key does not appear in the mobile bundle** — asserted by `P0-T03`'s client-env check.
- [ ] ETA and its last-updated timestamp are stored and returned together.
- [ ] **Calls inside `CFG-ETA-REFRESH-MIN` return the cached value without calling Routes** — asserted by counting outbound calls.
- [ ] The interval comes from config; no literal appears in the logic.
- [ ] **Refreshes stop when the booking is completed, cancelled or disputed** — demonstrated by asserting no further Routes calls after each transition.
- [ ] A Routes failure leaves the last known ETA with its timestamp and logs safely.
- [ ] A location update from anyone other than the booking's barber is rejected.
- [ ] A location update for an inactive booking is rejected.
- [ ] The raw client response contains no barber coordinate, route origin or route polyline.
- [ ] No PII or coordinate is written to logs.

**Tests** — immediate first calculation on `on_the_way`; outbound Routes call counting under rapid repeat calls, asserting the fixed three-minute throttle; refreshes ceasing after each terminal transition; raw response asserted field by field for absence of coordinates, origin and polyline; a foreign barber's location update rejected; Routes failure preserving the last ETA; the bundle check asserting key absence; parallel due claims, stopped-cron/missing-work recovery without a refresh burst, no outbound calls on empty ticks, worker API denial and independent alerts.

**Out of scope** — the client display (`P4-T06`); live tracking, forbidden by `ADR-004`.

**Sync notes** — `P4-T06` renders what this stores, including staleness.

---

#### P4-T06 — Client ETA display

```yaml
id: P4-T06
title: "Client ETA display"
issueType: Story
owner: Andrew
phase: 4
priority: Medium
jiraKey: null
dependsOn: [P0-D06, P0-T15, P4-T01, P4-T05]
affects: []
knowledgeBase: [ADR-004, RULE-DISCOVERY-05, RULE-ETA-03, RULE-ETA-04, RULE-ETA-05, RULE-COPY-01, CFG-ETA-REFRESH-MIN, CFG-ETA-STALE-MIN]
blockedByTbc: []
labels: [quicktrimr, phase-4, mobile, maps]
```

**Context**

The client is waiting at home for a stranger. The screen must be honest about what it knows: `RULE-ETA-03` requires the last-updated time to be shown, because "14 minutes" calculated eleven minutes ago is misinformation presented as fact.

`RULE-ETA-05` and `ADR-004` forbid implying live tracking. No moving marker.

**Scope**

An ETA surface on the client booking detail when the booking is on the way.

Show the ETA **and** its last-updated time together, always.

A stale state when the last update reaches `CFG-ETA-STALE-MIN` — six minutes, or two missed
refresh intervals. At exactly six minutes the number stops being presented as current and says so.

An unavailable state when no ETA could be calculated, which is normal and not an error.

No moving marker and no live position. A static destination map is acceptable; a barber marker that moves is not.

Polling aligned to the refresh interval — a client polling every second gets nothing new and drains their battery.

**Acceptance criteria**

- [ ] The ETA appears on the client booking detail when the booking is on the way.
- [ ] **The ETA and its last-updated time are always shown together** (`RULE-ETA-03`).
- [ ] An ETA becomes visibly stale at exactly `CFG-ETA-STALE-MIN`; the boundary and both sides are covered.
- [ ] An unavailable ETA renders a defined state, not an error.
- [ ] **No moving barber marker and no live position** (`ADR-004`, `RULE-ETA-05`).
- [ ] The display stops when the booking is completed, cancelled or disputed.
- [ ] Polling is aligned to the refresh interval, not tighter.
- [ ] Loading and error states exist.

**Tests** — stale rendering at 5:59, 6:00 and 6:01; unavailable state; polling interval asserted by counting requests; raw data and rendered UI contain no live barber position or marker.

**Out of scope** — ETA calculation (`P4-T05`); the map view (`P2-T07`).

---

#### P4-T07 — Barber mark job complete

```yaml
id: P4-T07
title: "Barber mark job complete"
issueType: Task
owner: Andrew
phase: 4
priority: Highest
jiraKey: null
dependsOn: [P0-T06, P0-T07, P3-T04, P4-T02]
affects: [P4-T08, P4-T09, P4-T11]
knowledgeBase: [ADR-010, ADR-013, RULE-COMPLETE-01, RULE-COMPLETE-02, RULE-EARN-02, ENUM-BOOKING-STATUS, CFG-COMPLETION-RESPONSE-MIN]
blockedByTbc: []
labels: [quicktrimr, phase-4, backend]
```

**Context**

Starts the client's response window (`RULE-COMPLETE-02`). The deadline recorded here is what `P4-T11`'s auto-completion acts on, so it must be computed from the **server clock** and `CFG-COMPLETION-RESPONSE-MIN` — a client-supplied or device-derived deadline is a way to release money early.

The earning stays `pending` (`RULE-EARN-02`). Marking complete is a claim, not a settlement.

**Scope**

`mark-job-complete-by-barber` Edge Function.

Validate the barber owns the booking and it is in a valid status — `paid_confirmed`, `on_the_way` or `arrived`.

Status to `completed_by_barber`, with the client response deadline computed server-side from config.

Schedule the auto-completion check via `P4-T11` on the engine from `P0-D07`.

Stop ETA refreshes (`RULE-ETA-04`).

Notify the client (`P6-T02`).

Earning remains `pending`.

Audit log and status history.

**Contract example** — `mark-job-complete-by-barber`

```jsonc
// request
{ "bookingId": "9a02..." }

// 200
{ "bookingId": "9a02...", "status": "completed_by_barber",
  "clientRespondBy": "2026-08-05T05:11:22Z", "earningStatus": "pending" }

// 409
{ "error": "invalid_status_transition", "currentStatus": "cancelled" }
```

**Acceptance criteria**

- [ ] A barber can mark an eligible booking complete.
- [ ] Status moves to `completed_by_barber` and the client response deadline is recorded.
- [ ] **The deadline is computed from the server clock and `CFG-COMPLETION-RESPONSE-MIN`** — no literal, no client-supplied time.
- [ ] **The earning remains `pending`** (`RULE-EARN-02`).
- [ ] Auto-completion is scheduled.
- [ ] ETA refreshes stop.
- [ ] An invalid status transition returns `409` naming the current status.
- [ ] Barber A cannot complete barber B's booking.
- [ ] Calling twice is idempotent and does not extend the deadline.
- [ ] Status history and audit log are written; the client is notified.

**Tests** — invalid transitions from each status; earning still `pending` afterwards; a client-supplied deadline ignored; double call not extending the window; cross-barber denial.

**Out of scope** — the UI (`P4-T08`); client response (`P4-T09`); auto-completion (`P4-T11`).

**Sync notes** — `P4-T09` and `P4-T11` both race against the deadline this sets.

---

#### P4-T08 — Barber mark complete UI

```yaml
id: P4-T08
title: "Barber mark complete UI"
issueType: Story
owner: Andrew
phase: 4
priority: High
jiraKey: null
dependsOn: [P0-T14, P4-T02, P4-T07]
affects: []
knowledgeBase: [RULE-COMPLETE-02, RULE-EARN-02, RULE-EARN-04, RULE-COPY-01]
blockedByTbc: []
labels: [quicktrimr, phase-4, mobile]
```

**Context**

The barber taps this and expects to be paid. `RULE-EARN-02` and `RULE-EARN-04` mean two things must be said here: the client has a window to respond, and even after that the money moves to a QuickTrimr balance, not a bank account. A barber who taps complete and checks their bank an hour later needs to have already been told why it is not there.

**Scope**

A complete action on an eligible booking, visible only in a valid status.

A confirmation dialog, because completing early is a real mistake with a financial consequence.

After completing, show: the client has `CFG-COMPLETION-RESPONSE-MIN` to confirm or dispute, what happens if they do nothing, and that the earning becomes available — as a QuickTrimr balance (`RULE-EARN-04`).

Handle a booking whose status changed mid-decision, including a client who completed first (`RULE-COMPLETE-03`).

**Acceptance criteria**

- [ ] The action appears only in a valid status.
- [ ] A confirmation dialog is required.
- [ ] After completing, the client response window and its outcomes are explained.
- [ ] **The screen states the earning becomes a QuickTrimr balance, not a bank deposit** (`RULE-EARN-04`, `RULE-COPY-01`).
- [ ] A status change mid-decision, including a client completing first, is handled with a clear message.
- [ ] Loading and error states exist; a failed call does not leave the UI showing complete.

**Tests** — action visibility per status; the client-completed-first race; the balance disclaimer present.

**Out of scope** — the function (`P4-T07`); client confirmation (`P4-T10`).

---

#### P4-T09 — Client confirm completion or dispute

```yaml
id: P4-T09
title: "Client confirm completion or dispute"
issueType: Task
owner: Andrew
phase: 4
priority: Highest
jiraKey: null
dependsOn: [P0-T07, P3-T04, P4-T07]
affects: [P4-T10, P4-T11, P4-T12, P4-T14]
knowledgeBase: [ADR-010, ADR-013, RULE-COMPLETE-02, RULE-COMPLETE-03, RULE-EARN-02, RULE-EARN-03, RULE-DISPUTE-01, RULE-DISPUTE-02, ENUM-BOOKING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-4, backend]
```

**Context**

The client's side of completion, and where money is actually released. Confirming moves the earning to `available` (`RULE-EARN-02`); disputing holds it (`RULE-EARN-03`).

**`RULE-COMPLETE-03` is the case that is easy to miss:** a client can mark complete **before** the barber does, and that completes the booking immediately with no waiting window. The function must handle both orderings, not assume the barber goes first.

It also races `P4-T11`'s auto-completion at the deadline boundary — a client confirming at the moment the job fires must produce one outcome, not two.

**Scope**

`confirm-job-complete-by-client` and `open-dispute`.

Validate the client owns the booking and it is in a valid status.

**Confirm:**

- From `completed_by_barber` → `completed`, earning to `available`.
- From `paid_confirmed`, `on_the_way` or `arrived` → `completed` immediately (`RULE-COMPLETE-03`), earning to `available`.

**Dispute:** status to `disputed`, earning held at `pending`, dispute created via `P4-T12`. Allowed within the response window and within the final window after `RULE-COMPLETE-04`'s prompt.

Both idempotent and conditional, so a race with auto-completion or a double tap yields one outcome.

Cancel the scheduled auto-completion once a terminal state is reached.

Status history and audit log; the barber is notified.

**Contract example** — `confirm-job-complete-by-client`

```jsonc
// request
{ "bookingId": "9a02..." }

// 200 — after the barber marked complete
{ "bookingId": "9a02...", "status": "completed", "earningStatus": "available" }

// 200 — client completing first (RULE-COMPLETE-03)
{ "bookingId": "9a02...", "status": "completed", "earningStatus": "available",
  "completedBy": "client" }

// 409 — auto-completion won the race
{ "error": "already_completed", "currentStatus": "completed" }

// 409 — response window closed
{ "error": "response_window_closed" }
```

**Acceptance criteria**

- [ ] A client can confirm completion from `completed_by_barber`, moving the earning to `available`.
- [ ] **A client can complete before the barber has**, from `paid_confirmed`, `on_the_way` or `arrived`, completing immediately (`RULE-COMPLETE-03`).
- [ ] A client can open a dispute within the response window; the earning stays `pending` (`RULE-EARN-03`).
- [ ] **A confirm racing auto-completion produces exactly one completion** — tested at the deadline boundary with real concurrency.
- [ ] **A double-tapped confirm releases the earning once.**
- [ ] A confirm after the window returns `409 response_window_closed`.
- [ ] Reaching a terminal state cancels the scheduled auto-completion.
- [ ] Client A cannot confirm or dispute client B's booking.
- [ ] Status history and audit logs are written; the barber is notified.

**Tests** — the client-first completion path from each valid status; a confirm-versus-auto-complete race at the boundary, repeated, asserting one outcome; double-tap idempotency asserted on the earning; window-closed rejection; cross-client denial.

**Out of scope** — the UI (`P4-T10`); dispute records (`P4-T12`); auto-completion (`P4-T11`).

**Sync notes** — `P4-T11` implements the other side of the same race. They must be written together or they will both fire.

---

#### P4-T10 — Client completion confirmation UI

```yaml
id: P4-T10
title: "Client completion confirmation UI"
issueType: Story
owner: Andrew
phase: 4
priority: High
jiraKey: null
dependsOn: [P0-T14, P4-T01, P4-T09]
affects: [P4-T13]
knowledgeBase: [RULE-COMPLETE-02, RULE-COMPLETE-03, RULE-COMPLETE-04, RULE-COPY-01, CFG-COMPLETION-RESPONSE-MIN, CFG-FINAL-DISPUTE-WINDOW-MIN]
blockedByTbc: []
labels: [quicktrimr, phase-4, mobile]
```

**Context**

The client's decision point, and the last moment before money moves to the barber. The window has to be unmistakable — a client who misses it and auto-completes on an unsatisfactory haircut has lost their recourse, and will say they were never told.

**Scope**

A completion prompt on the booking detail when the booking is `completed_by_barber` or after the final prompt (`RULE-COMPLETE-04`).

Two actions: confirm complete, and report an issue.

**A visible countdown** to the response deadline, with the consequence of inaction stated: the booking auto-completes and the barber is paid.

A "mark complete" action available before the barber has (`RULE-COMPLETE-03`), framed distinctly — it forfeits the response window, and the client should know that.

Report-an-issue opens the dispute form (`P4-T13`).

Handle the window closing while the client is deciding.

**Acceptance criteria**

- [ ] The prompt appears when the booking is `completed_by_barber` or after the final prompt.
- [ ] Confirm and report-an-issue are both available.
- [ ] **A countdown to the deadline is visible, with the consequence of inaction stated.**
- [ ] Completing early (`RULE-COMPLETE-03`) is available and framed as forfeiting the response window.
- [ ] Report-an-issue opens the dispute form.
- [ ] The window closing mid-decision renders a clear message and refreshes.
- [ ] Loading and error states exist; a failed action does not show success.
- [ ] No copy implies the client can dispute after the window.

**Tests** — countdown rendering and expiry mid-decision; both actions reaching their endpoints; the early-completion framing present.

**Out of scope** — the functions (`P4-T09`); the dispute form (`P4-T13`).

---

#### P4-T11 — Auto-completion workflows

```yaml
id: P4-T11
title: "Auto-completion workflows"
issueType: Task
owner: Tony
phase: 4
priority: High
jiraKey: null
dependsOn: [P0-D07, P3-T04, P4-T07, P4-T09]
affects: [P5-T04]
knowledgeBase: [ADR-011, ADR-013, RULE-COMPLETE-02, RULE-COMPLETE-04, RULE-COMPLETE-05, RULE-EARN-02, RULE-EARN-03, ENUM-BOOKING-STATUS, CFG-COMPLETION-RESPONSE-MIN, CFG-NO-ACTION-WARNING-HOURS, CFG-FINAL-DISPUTE-WINDOW-MIN]
blockedByTbc: []
labels: [quicktrimr, phase-4, backend]
```

**Context**

**Money moves with nobody watching.** Two distinct flows, and both release a barber's earning without a human acting:

1. `RULE-COMPLETE-02` — the barber marked complete and the client did nothing for `CFG-COMPLETION-RESPONSE-MIN`.
2. `RULE-COMPLETE-04` — neither party acted for `CFG-NO-ACTION-WARNING-HOURS`, a final prompt is sent, and the client gets `CFG-FINAL-DISPUTE-WINDOW-MIN` to dispute.

That second flow exists so a booking cannot hang open forever, and the prompt exists so the client is warned before money moves. **Skipping the prompt and auto-completing silently is the failure mode**, and it is the one a client would reasonably call theft.

Everything here re-checks state at execution and is idempotent (`ADR-011`, `RULE-COMPLETE-05`).

**Scope**

Both flows use Supabase `pg_cron` bounded indexed due-booking sweeps (`ADR-011`) with persisted
stage deadlines, not one recurring cron job per booking. Own versioned schedules/permissions,
operational settings, protected handlers and independent heartbeat/overdue-stage monitoring.

Flow 1: at the deadline, if still `completed_by_barber`, complete and release the earning.

Flow 2: at `CFG-NO-ACTION-WARNING-HOURS` after the appointment, if the booking is still active and neither party has acted, move to `completion_prompt_sent`, notify the client, and schedule the final check at `CFG-FINAL-DISPUTE-WINDOW-MIN`. At that check, if no dispute, complete and release.

Every job **re-reads state at execution**. A booking disputed, cancelled or completed since scheduling is left alone.

Idempotent: a duplicate fire releases the earning once.

**An open dispute always blocks release** (`RULE-EARN-03`), checked at the moment of release, not at scheduling.

A reconciliation sweep catching bookings past their deadline that no primary sweep completed,
including missing work records and interrupted claims. Recover from authoritative booking state;
preserve the original operation identity and stage deadline. Persist prompt-dispatch work with
the prompting transition and dispatch after commit. Recovery must still perform the warning
stage and preserve its full configured final dispute window, never skip straight to release
because a scheduler was late. This does not make earning eligibility depend on a mobile timer.

Audit log for every automatic transition, marked as system-actioned so it is distinguishable from a user action in `booking_status_history`.

**Acceptance criteria**

- [ ] Flow 1 completes and releases the earning at the deadline when the client did nothing.
- [ ] Flow 2 sends the final prompt at `CFG-NO-ACTION-WARNING-HOURS` and completes after `CFG-FINAL-DISPUTE-WINDOW-MIN` with no dispute.
- [ ] **The final prompt is always sent before auto-completion in flow 2** — a booking never auto-completes without it.
- [ ] All timings come from config; no literal appears in the logic.
- [ ] **Every job re-checks state at execution**; a booking disputed, cancelled or completed since scheduling is untouched.
- [ ] **A duplicate fire releases the earning exactly once** — asserted on the earning row.
- [ ] **An open dispute blocks release**, checked at release time (`RULE-EARN-03`).
- [ ] A dispute opened seconds before the job fires wins — tested at the boundary with real concurrency.
- [ ] A reconciliation sweep catches a deliberately dropped schedule.
- [ ] Automatic transitions are audit logged and marked system-actioned.

**Tests** — both flows end to end with time controlled plus a real scheduled smoke test; duplicate fire asserted on the earning; a dispute-versus-auto-complete race at the boundary, repeated; state re-check for each intervening status; the prompt asserted as sent before every flow-2 completion, including late recovery preserving the final dispute window; skipped primary work/missing work rows/interrupted claims recovered; stopped-cron independent alerts and worker API denial.

**Out of scope** — manual completion (`P4-T07`, `P4-T09`); disputes (`P4-T12`); payouts (`P3-T11`).

**Sync notes** — this and `P4-T09` race deliberately. `P5-T04` must show admin which bookings were system-completed, because that is the population a complaint comes from.

---

#### P4-T12 — Dispute creation

```yaml
id: P4-T12
title: "Dispute creation"
issueType: Task
owner: Tony
phase: 4
priority: High
jiraKey: null
dependsOn: [P0-T10, P3-T04, P4-T09]
affects: [P4-T13, P5-T06, P5-T07]
knowledgeBase: [ADR-010, ADR-013, RULE-DISPUTE-01, RULE-DISPUTE-02, RULE-DISPUTE-03, RULE-DISPUTE-06, RULE-EARN-03, ENUM-DISPUTE-STATUS, ENUM-BOOKING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-4, backend]
```

**Context**

A dispute holds money. `RULE-DISPUTE-02` and `RULE-EARN-03` mean opening one stops the barber being paid, which makes it the client's only real protection and something that must not be creatable by anyone else.

`RULE-DISPUTE-03` — one open dispute per booking, enforced by a constraint. A double-tapped form must not create two disputes for admin to reconcile.

**Scope**

Dispute creation, called by `P4-T09`.

Only the booking's client, or an admin, may create one (`RULE-DISPUTE-01`).

Record: booking, reason category, description, timestamp, and `open` status.

Booking to `disputed`; earning held at `pending`.

A unique constraint preventing a second open dispute per booking (`RULE-DISPUTE-03`).

Windows enforced: within the response window after `completed_by_barber`, or within the final window after `completion_prompt_sent`.

Admin visibility (`P5-T06`) and notification.

Audit log (`RULE-DISPUTE-06`).

**Contract example** — `open-dispute`

```jsonc
// request
{ "bookingId": "9a02...", "reasonCategory": "service_not_provided",
  "description": "Barber did not arrive." }

// 200
{ "disputeId": "f77c...", "status": "open", "bookingStatus": "disputed",
  "earningStatus": "pending" }

// 409 — RULE-DISPUTE-03
{ "error": "dispute_already_open", "disputeId": "f77c..." }

// 409 — outside the window
{ "error": "dispute_window_closed" }

// 403 — not the booking's client
{ "error": "forbidden" }
```

**Acceptance criteria**

- [ ] The booking's client can open a dispute within a valid window.
- [ ] **Only the booking's client or an admin can create one** — another client is rejected with 403.
- [ ] The booking moves to `disputed` and the earning is held at `pending`.
- [ ] **A second open dispute for a booking is rejected by a database constraint**, proven under parallel calls and in direct SQL.
- [ ] A dispute outside the allowed windows returns `409 dispute_window_closed`.
- [ ] Reason category and description are validated.
- [ ] Admin can see the dispute and is notified.
- [ ] Status history and audit log are written.

**Tests** — parallel creation producing one dispute; a foreign client rejected; window boundaries at and either side; the earning asserted still `pending`.

**Out of scope** — the form (`P4-T13`); resolution (`P5-T07`); Stripe chargebacks, which arrive via `P3-T03`.

**Sync notes** — `P5-T07` resolves these and is the only path that releases a held earning.

---

#### P4-T13 — Dispute submission form

```yaml
id: P4-T13
title: "Dispute submission form"
issueType: Story
owner: Tony
phase: 4
priority: Medium
jiraKey: null
dependsOn: [P0-T14, P4-T10, P4-T12]
affects: []
knowledgeBase: [RULE-DISPUTE-01, RULE-DISPUTE-03, RULE-COPY-01]
blockedByTbc: []
labels: [quicktrimr, phase-4, mobile]
```

**Context**

A client using this is already unhappy. The form should be short, tell them what happens next, and not promise an outcome — `RULE-DISPUTE-04` puts resolution in an admin's hands, and copy suggesting an automatic refund creates an expectation QuickTrimr may not meet (`RULE-COPY-01`).

**Scope**

A dispute form reached from `P4-T10`: reason category from a defined list, and a description with validated length.

Before submitting, state what happens: the booking is marked disputed, the barber is not paid pending review, and an admin reviews it. No promised timeframe unless one is committed to.

Submission disabled while in flight; a `409 dispute_already_open` routes to the existing dispute rather than showing an error.

A confirmation showing the dispute reference and its status.

**Acceptance criteria**

- [ ] A client can submit a dispute with a reason category and a description.
- [ ] Required fields and description length are validated, with field-level messages.
- [ ] **The screen explains what happens next without promising an outcome** (`RULE-COPY-01`).
- [ ] Submission is disabled while in flight; **a double tap creates one dispute.**
- [ ] `409 dispute_already_open` routes to the existing dispute.
- [ ] A confirmation shows the reference and status.
- [ ] Loading and error states exist; a failed submit does not lose the description.

**Tests** — double submit producing one dispute; validation messages; the already-open route; no outcome-promising copy.

**Out of scope** — the backend (`P4-T12`); photo evidence, out of scope per `KB §16`; admin resolution (`P5-T08`).

---

#### P4-T14 — Review creation

```yaml
id: P4-T14
title: "Review creation"
issueType: Task
owner: Andrew
phase: 4
priority: Medium
jiraKey: null
dependsOn: [P0-D08, P0-T10, P4-T09]
affects: [P4-T15, P5-T12]
knowledgeBase: [ADR-013, RULE-REVIEW-01, RULE-REVIEW-02, RULE-REVIEW-03, RULE-REVIEW-04, RULE-REVIEW-05, RULE-REVIEW-06, CFG-REVIEW-DEADLINE-DAYS]
blockedByTbc: []
labels: [quicktrimr, phase-4, backend]
```

**Context**

Reviews drive the rating clients choose barbers by, so the aggregate must be computed server-side and unwritable by a client (`RULE-REVIEW-04`).

`RULE-REVIEW-06` admits client-confirmed and auto-completed bookings, plus admin resolutions that pay the barber or make a partial refund. Open disputes, cancellations, full refunds and operational-only resolutions are not reviewable. The 14-day window starts at completion, or at resolution for an eligible admin-resolved dispute.

**Scope**

`create-review`.

Eligibility per `RULE-REVIEW-01` and `RULE-REVIEW-06`: the client's own booking, in a reviewable outcome, within `CFG-REVIEW-DEADLINE-DAYS` of the server-recorded completion or eligible dispute-resolution time.

Use one pure eligibility calculation in `packages/domain` for submission validation and the existing owned-booking list/detail projections. Extend those projections with server-computed review eligibility and its deadline for `P4-T15`; the mobile UI must not independently reconstruct dispute outcomes or hard-code the window.

One review per booking, enforced by the `P0-T10` unique constraint (`RULE-REVIEW-02`).

Rating required and validated; text optional and length-validated (`RULE-REVIEW-03`).

The barber's aggregate recomputed server-side, excluding hidden reviews (`RULE-REVIEW-05`). Recomputed, not incremented, so hiding a review corrects the aggregate.

`update-review-admin-visibility` for admin moderation, audit logged.

**Contract example** — `create-review`

```jsonc
// request
{ "bookingId": "9a02...", "rating": 5, "text": "On time, great fade." }

// 200
{ "reviewId": "r501...", "rating": 5, "barberRating": 4.83, "barberRatingCount": 38 }

// 409 — RULE-REVIEW-02
{ "error": "review_already_exists", "reviewId": "r501..." }

// 409 — outcome not reviewable per RULE-REVIEW-06
{ "error": "booking_not_reviewable", "bookingStatus": "cancelled" }

// 409 — review window closed
{ "error": "review_window_closed", "deadline": "2026-08-19T04:16:22Z" }

// 422
{ "error": "validation_failed", "fields": { "rating": "Must be between 1 and 5" } }
```

**Acceptance criteria**

- [ ] A client can review their own booking in a reviewable outcome per `RULE-REVIEW-06`.
- [ ] Owned-booking list/detail projections expose review eligibility and its deadline from the same rule used by `create-review`.
- [ ] **A non-reviewable outcome returns `409 booking_not_reviewable`** — each outcome tested against the decision.
- [ ] **A second review for a booking is rejected by a constraint**, proven under parallel calls.
- [ ] Another client's booking cannot be reviewed — 403.
- [ ] Rating is validated in range; text length is validated.
- [ ] **The aggregate is recomputed server-side and is not client-writable** — proven by attempting to set it.
- [ ] Hidden reviews are excluded from the aggregate, and hiding one recomputes it.
- [ ] The deadline is read from `CFG-REVIEW-DEADLINE-DAYS` (14 days at launch) and enforced from completion for normal and automatic completions, and from resolution for an eligible admin-resolved dispute; submission at or after the deadline returns `409 review_window_closed`.
- [ ] Audit logs are written for creation and moderation.

**Tests** — parallel creation producing one review; client-confirmed, client-first and both auto-completion paths allowed; open dispute and cancellation denied; `resolved_barber_paid` and `resolved_partial_refund` allowed; `resolved_client_refund` and `resolved_operational` denied; each 14-day boundary at, just inside and just outside using the correct completion or resolution timestamp; aggregate arithmetic including after hiding; a crafted aggregate write rejected; cross-client denial.

**Out of scope** — the review UI (`P4-T15`); the admin moderation UI (`P5-T12`); barber responses, out of scope.

**Sync notes** — `P1-T12` and `P2-T06` render the aggregate this maintains.

---

#### P4-T15 — Client review UI

```yaml
id: P4-T15
title: "Client review UI"
issueType: Story
owner: Andrew
phase: 4
priority: Medium
jiraKey: null
dependsOn: [P0-D08, P0-T14, P1-T12, P4-T01, P4-T14]
affects: []
knowledgeBase: [RULE-REVIEW-01, RULE-REVIEW-02, RULE-REVIEW-03, RULE-REVIEW-06, CFG-REVIEW-DEADLINE-DAYS]
blockedByTbc: []
labels: [quicktrimr, phase-4, mobile]
```

**Context**

The prompt after a completed booking. It must only appear when the booking is genuinely reviewable per `RULE-REVIEW-06` — a prompt on a cancelled booking that then fails at the API is worse than no prompt.

**Scope**

A review prompt on the completed booking detail and in the booking list, shown only for outcomes `RULE-REVIEW-06` permits and only until the 14-day deadline. Eligible admin-resolved disputes measure that window from resolution; other eligible outcomes measure it from completion.

Star rating, required. Optional text with a visible character limit.

Submission disabled while in flight; a `409 review_already_exists` shows the existing review rather than an error.

Use server-provided eligibility and the review deadline for prompts. If eligibility changes or the deadline passes while the form is open, handle `409 booking_not_reviewable` and `409 review_window_closed` with an explanation and refresh the booking state; the backend is authoritative even if the device clock differs.

The submitted review is visible on the barber's profile (`P1-T12`).

Dismissible without penalty, and re-reachable from the booking later while still within any deadline.

**Acceptance criteria**

- [ ] The prompt appears only for outcomes `RULE-REVIEW-06` allows.
- [ ] The prompt disappears at the configured deadline, using completion or dispute-resolution time as `RULE-REVIEW-06` requires.
- [ ] A client can submit a rating, with optional text within a shown limit.
- [ ] Submission is disabled while in flight; **a double tap creates one review.**
- [ ] `409 review_already_exists` shows the existing review.
- [ ] A form left open past the deadline or an intervening dispute handles `409 review_window_closed` / `409 booking_not_reviewable` and refreshes eligibility.
- [ ] The submitted review appears on the barber profile.
- [ ] The prompt is dismissible and the review remains reachable from the booking within the deadline.
- [ ] Loading, error and success states exist.

**Tests** — prompt visibility per booking outcome; deadline boundaries from completion and eligible admin resolution; a form left open past expiry or an intervening dispute; double submit producing one review; the already-exists path; the review appearing on the profile.

**Out of scope** — the backend (`P4-T14`); barber responses; moderation (`P5-T12`).

---
## Phase 5 — Admin Dashboard

**Goal:** admin can see everything and resolve disputes, refunds, payouts and reliability.

**Every ticket here sits behind `P1-T02`'s server-side guard**, and every mutation re-verifies the admin role at the API. A screen hidden from a non-admin is not access control (`RULE-ADMIN-01`).

**Gate:** an admin can find any booking, understand its financial state, resolve a dispute correctly, and every action they took is reconstructable from the audit log.

---

#### P5-T01 — Admin overview

```yaml
id: P5-T01
title: "Admin overview"
issueType: Story
owner: Tony
phase: 5
priority: High
jiraKey: null
dependsOn: [P0-T12, P0-T17, P1-T02]
affects: []
knowledgeBase: [RULE-ADMIN-01, RULE-ADMIN-04, ENUM-BOOKING-STATUS, ENUM-DISPUTE-STATUS, ENUM-PAYMENT-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin]
```

**Context**

The landing page, and its real job is surfacing what needs attention rather than looking impressive. The counts that matter operationally are the stuck ones: bookings at `accepted_pending_payment` (a capture failed, `RULE-PAY-05`), open disputes holding earnings, and failed payout items.

**Scope**

An overview with operational counts: clients, barbers, active bookings, open disputes, payments by status, and earnings by status.

**Attention panels** for the states that need a human: bookings stuck at `accepted_pending_payment`, payments at `capture_failed`, open disputes ordered oldest first, and failed payout items — each linking to the filtered list.

A date range filter where relevant.

Aggregate queries, filtered and indexed, never counting in the browser (`RULE-ADMIN-04`).

**Acceptance criteria**

- [ ] The overview shows counts for users, barbers, bookings, disputes, payments and earnings by status.
- [ ] **Attention panels surface stuck states** — `accepted_pending_payment`, `capture_failed`, open disputes, failed payout items — each linking to the filtered list.
- [ ] Counts come from aggregate queries; no screen fetches rows to count them.
- [ ] A date range filter applies where relevant.
- [ ] Admin-only access enforced server-side; a non-admin request returns no data in the body.
- [ ] Loading, error and empty states exist.

**Tests** — non-admin request asserted on the raw body for absence of counts; attention panels populated from seed data; query plans asserted as aggregates.

**Out of scope** — deep analytics (`P6-T04`); the individual lists.

---

#### P5-T02 — Admin clients

```yaml
id: P5-T02
title: "Admin clients"
issueType: Story
owner: Tony
phase: 5
priority: High
jiraKey: null
dependsOn: [P0-T17, P1-T02, P1-T04, P1-T05]
affects: []
knowledgeBase: [ROLE-ADMIN, RULE-ADMIN-01, RULE-ADMIN-04, ADR-013]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin, security]
```

**Context**

Client records include home addresses. An admin can see them, and **admin access to personal data is itself worth logging** (`ADR-013`) — when a client asks who looked at their record, there has to be an answer.

**Scope**

A client list with server-side search, filter and pagination, and a detail view: profile, addresses, bookings, payments, disputes and reviews.

Read-only. Editing client data is not in scope; a correction goes through a defined process, not an admin typing over a record.

Addresses shown only in the detail view, not the list — a list of every client's home address on one screen is an unnecessary exposure.

Audit log on viewing a client detail record.

**Acceptance criteria**

- [ ] An admin can search, filter and page through clients, all server-side.
- [ ] The detail view shows profile, addresses, bookings, payments, disputes and reviews.
- [ ] **Addresses do not appear in the list view**, only in detail.
- [ ] Viewing a client detail writes an audit log entry.
- [ ] The view is read-only; no edit path exists.
- [ ] **A non-admin receives no client data in the response body.**
- [ ] Pagination is server-side; no query returns an unbounded set (`RULE-ADMIN-04`).
- [ ] Loading, error and empty states exist.

**Tests** — non-admin denial on the raw body; audit entry written on detail view; list response asserted to contain no address field; pagination bounded.

**Out of scope** — editing clients; deletion and data-export requests.

---

#### P5-T03 — Admin barbers

```yaml
id: P5-T03
title: "Admin barbers"
issueType: Story
owner: Tony
phase: 5
priority: High
jiraKey: null
dependsOn: [P0-T17, P1-T02, P1-T09, P1-T11, P3-T12]
affects: [P5-T13]
knowledgeBase: [ROLE-ADMIN, RULE-ADMIN-01, RULE-ADMIN-04, RULE-ONBOARD-04, RULE-RELY-01, RULE-RELY-06, ENUM-VERIFICATION-STATUS, ENUM-RELIABILITY-LEVEL]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin]
```

**Context**

The barber record answers the two questions support actually receives: "why am I not getting bookings?" and "why haven't I been paid?" The first is usually `RULE-ONBOARD-04` or a reliability level; the second is a payout state. Both need to be visible at a glance.

**Scope**

A barber list with server-side search, filter and pagination, filterable by verification status and reliability level.

Detail: profile, services and prices, Stripe Connect status and outstanding requirements, verification status, reliability level with its event history, Available Now session history, bookings, earnings and payouts.

**A discoverability summary** distinguishing absent (Connect incomplete, no active services, suspended, or Available Now cooldown) from present-but-demoted (`restricted` outside cooldown). Show each booking type, current offence count, cooldown end, automatic level versus human override, review eligibility and recovery/reinstatement information (`RULE-RELY-06`).

Reliability events in full, since `RULE-RELY-01` makes them append-only and a barber disputing a level needs the history.

Read-only. Reliability changes go through `P5-T13`.

**Acceptance criteria**

- [ ] An admin can search, filter and page through barbers, filtering by verification status and reliability level.
- [ ] Detail shows profile, services, Connect status with outstanding requirements, verification, reliability with history, sessions, bookings, earnings and payouts.
- [ ] **A discoverability summary states whether the barber appears in search and why not** (`RULE-ONBOARD-04`, `RULE-RELY-06`).
- [ ] The full reliability event history is shown, oldest to newest.
- [ ] The view is read-only; changes go through `P5-T13`.
- [ ] A non-admin receives no barber data in the response body.
- [ ] Pagination is server-side.
- [ ] Loading, error and empty states exist.

**Tests** — non-admin denial on the raw body; discoverability summary for both booking types and each blocking/demotion reason using seed barbers; fourth offence awaiting review versus approved suspension; cooldown versus level recovery; reliability history ordering.

**Out of scope** — reliability changes (`P5-T13`); manual Connect override.

---

#### P5-T04 — Admin bookings

```yaml
id: P5-T04
title: "Admin bookings"
issueType: Story
owner: Tony
phase: 5
priority: Highest
jiraKey: null
dependsOn: [P0-T17, P1-T02, P3-T02, P3-T06, P4-T01, P4-T02, P4-T11]
affects: [P5-T05]
knowledgeBase: [ADR-010, ROLE-ADMIN, RULE-ADMIN-01, RULE-ADMIN-04, RULE-PAY-05, ENUM-BOOKING-STATUS, ENUM-PAYMENT-STATUS, ENUM-EARNING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin]
```

**Context**

The screen support lives in. When a client says they were charged and the barber never arrived, this is where the answer is, and it has to hold the **whole** story: the request, the payment, the earning, the status history, and whether a transition was made by a person or by a job.

That last distinction matters. `P4-T11` completes bookings automatically, and "the system completed this at 6 hours because nobody responded" is a very different conversation from "the client confirmed".

**Scope**

A booking list with server-side search and filters: status, booking type, date range, client, barber.

Detail showing: the request and its snapshots, the booking, the full `booking_status_history` with actor and reason, the payment with its Stripe reference, the earning, any dispute, any refund, and any cancellation with the rule applied.

**Status history marks system-actioned transitions distinctly** from user actions (`ADR-010`).

A filter for the stuck state — bookings at `accepted_pending_payment` — because `RULE-PAY-05` leaves them there and someone has to find them.

Read-only. Overrides go through `P5-T05`.

**Acceptance criteria**

- [ ] An admin can search and filter bookings by status, type, date range, client and barber, all server-side.
- [ ] Detail shows request snapshots, booking, full status history, payment, earning, dispute, refund and cancellation.
- [ ] **Status history distinguishes system-actioned transitions from user actions.**
- [ ] A filter surfaces bookings stuck at `accepted_pending_payment`.
- [ ] Amounts render from integer cents through the shared `Money` component.
- [ ] The Stripe payment reference is shown so a record can be reconciled against Stripe.
- [ ] The view is read-only; overrides go through `P5-T05`.
- [ ] A non-admin receives no booking data in the response body.
- [ ] Pagination is server-side; no unbounded query.
- [ ] Loading, error and empty states exist.

**Tests** — non-admin denial on the raw body; system-versus-user attribution rendered for an auto-completed booking; the stuck-state filter returning seeded `accepted_pending_payment` rows; pagination bounded.

**Out of scope** — overrides (`P5-T05`); dispute resolution (`P5-T08`); refunds (`P5-T07`).

**Sync notes** — this is the reconciliation surface for every Phase 3 and 4 ticket. A new financial field must appear here or it is invisible to support.

---

#### P5-T05 — Admin booking status override

```yaml
id: P5-T05
title: "Admin booking status override"
issueType: Task
owner: Tony
phase: 5
priority: High
jiraKey: null
dependsOn: [P4-T11, P5-T04]
affects: []
knowledgeBase: [ADR-010, ADR-013, RULE-ADMIN-01, RULE-ADMIN-02, RULE-EARN-02, ENUM-BOOKING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin, backend, security]
```

**Context**

The escape hatch, and the most dangerous function in the admin dashboard. `RULE-ADMIN-02` — it validates the transition, requires a reason, and **never silently bypasses a financial rule.**

The specific thing to prevent: an override that moves a booking to `completed` without releasing the earning, or that releases an earning while a dispute is open. An override that leaves the financial state inconsistent with the booking state is worse than no override, because the inconsistency is invisible until reconciliation.

**Scope**

`admin-override-booking-status`.

Admin role verified server-side. A mandatory reason, stored and audit logged.

**A defined allowed-transition matrix.** Not every status to every status — an override is for operational recovery, not arbitrary editing, and the matrix is documented.

Financial consequences applied explicitly, never left implicit: moving to `completed` releases the earning through `P3-T04`; moving to `refunded` goes through `P3-T07`'s refund path. The override never writes a financial state directly.

**An override cannot release an earning while a dispute is open** (`RULE-EARN-03`). Resolve the dispute first, via `P5-T07`.

Status history and audit log recording the admin, the reason, and the before and after.

**Contract example** — `admin-override-booking-status`

```jsonc
// request
{ "bookingId": "9a02...", "toStatus": "completed",
  "reason": "Barber confirmed by phone; client app failed to submit." }

// 200
{ "bookingId": "9a02...", "status": "completed",
  "earningStatus": "available", "auditLogId": "al99..." }

// 422 — missing reason
{ "error": "validation_failed", "fields": { "reason": "Required" } }

// 409 — transition not permitted
{ "error": "transition_not_allowed", "from": "cancelled", "to": "on_the_way" }

// 409 — would release an earning with a dispute open
{ "error": "dispute_open", "disputeId": "f77c..." }

// 403
{ "error": "forbidden" }
```

**Acceptance criteria**

- [ ] An admin can override a booking status within the documented allowed-transition matrix.
- [ ] **A transition outside the matrix returns `409 transition_not_allowed`.**
- [ ] **A reason is mandatory**; a request without one is rejected.
- [ ] Financial consequences are applied through the owning functions, never written directly.
- [ ] **An override that would release an earning while a dispute is open is rejected** (`RULE-EARN-03`).
- [ ] **A client or barber calling this receives 403** — verified by calling the endpoint directly.
- [ ] Status history and audit log record the admin, the reason, and the before and after.
- [ ] Errors are typed and safe.

**Tests** — every disallowed transition rejected; missing reason rejected; the dispute-open guard; role denial at the API for client and barber; the earning state after each permitted override asserted consistent with the booking state.

**Out of scope** — dispute resolution (`P5-T07`); refunds (`P5-T07`); reliability (`P5-T13`).

---

#### P5-T06 — Admin disputes list

```yaml
id: P5-T06
title: "Admin disputes list"
issueType: Story
owner: Tony
phase: 5
priority: Highest
jiraKey: null
dependsOn: [P0-T17, P1-T02, P4-T12]
affects: [P5-T08]
knowledgeBase: [ROLE-ADMIN, RULE-ADMIN-01, RULE-ADMIN-04, RULE-DISPUTE-01, RULE-DISPUTE-02, RULE-EARN-03, ENUM-DISPUTE-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin]
```

**Context**

Every open dispute is a barber not being paid and a client waiting. Age is the metric that matters, so the list leads with it rather than burying it.

**Scope**

A dispute list with server-side filter and pagination, filterable by status, **ordered oldest-open first**, with the held earning amount shown per row.

Detail: the dispute reason and description, the full booking record, the client and barber, payment and earning state, and the booking's status history.

Enough context to decide without leaving the page. An admin who has to open three screens to resolve one dispute will resolve it on partial information.

Read-only. Resolution is `P5-T07` and `P5-T08`.

**Acceptance criteria**

- [ ] An admin can list and filter disputes by status, paginated server-side.
- [ ] **Open disputes are ordered oldest first** and show their age and the held earning amount.
- [ ] Detail shows reason, description, booking, client, barber, payment, earning and status history.
- [ ] The held earning amount is shown, so the financial exposure is visible.
- [ ] The view is read-only.
- [ ] A non-admin receives no dispute data in the response body.
- [ ] Loading, error and empty states exist.

**Tests** — non-admin denial on the raw body; ordering by age; the held amount matching the earning row.

**Out of scope** — resolution (`P5-T07`, `P5-T08`).

---

#### P5-T07 — Admin dispute resolution and refunds

```yaml
id: P5-T07
title: "Admin dispute resolution and refunds"
issueType: Task
owner: Tony
phase: 5
priority: Highest
jiraKey: null
dependsOn: [P0-D02, P0-D03, P0-D08, P3-T07, P4-T12, P5-T06]
affects: [P5-T08]
knowledgeBase: [ADR-009, ADR-013, RULE-ADMIN-01, RULE-ADMIN-03, RULE-DISPUTE-04, RULE-DISPUTE-05, RULE-DISPUTE-06, RULE-CANCEL-05, RULE-CANCEL-07, RULE-EARN-02, RULE-EARN-03, RULE-PAY-04, RULE-PAY-11, RULE-REVIEW-06, ENUM-DISPUTE-STATUS, ENUM-EARNING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin, backend, stripe, security]
```

**Context**

The admin path that resolves a disputed earning or refunds a captured payment; ordinary cancellation is owned by `P3-T07`. `RULE-DISPUTE-05` requires resolution to update the dispute, booking, payment **and** earning consistently, or none of them. A partial application is a financial inconsistency that surfaces weeks later at reconciliation.

`RULE-ADMIN-03` — refunds are idempotent against Stripe. An admin double-clicking must refund once.

**Scope**

`admin-resolve-dispute` supporting the outcomes in `ENUM-DISPUTE-STATUS`: full client refund, partial client refund, barber paid, and a recorded operational outcome.

Admin role verified server-side; a mandatory reason (`RULE-DISPUTE-04`).

Refund amounts calculated server-side from the booking snapshot (`RULE-CANCEL-05`), using the same `packages/domain` functions as `P3-T07`. **An admin-supplied amount is bounded** by what was actually captured — an admin cannot refund more than was taken. For service refunds, apply `RULE-PAY-11`'s proportional commission reversal from original snapshots and cumulative refunds; barber-paid retains the normal split. Cancellation/inconvenience allocations instead follow `RULE-CANCEL-07`: zero commission and only the adjusted inconvenience entitlement, never an additional service earning. QuickTrimr absorbs retained processing fees in both cases. Further refunds must account for amounts already refunded and the existing adjusted entitlement, not recompute from today's config or pay the original service net again.

**All state changes in one transaction**, with the Stripe call outside any lock (`RULE-PAY-09`) and the result applied conditionally. If the Stripe refund fails, nothing is marked resolved.

Idempotent on a server-derived key from the dispute id (`RULE-PAY-04`).

Earning updated: `reversed` on a full refund, adjusted on a partial, `available` when the barber is paid.

Audit log recording the admin, the outcome, the reason, and every amount (`RULE-DISPUTE-06`). The resolution stores its server-owned outcome and `resolved_at` time so review eligibility and its deadline can be evaluated without trusting the client (`RULE-REVIEW-06`).

**Contract example** — `admin-resolve-dispute`

For a first 2000-cent service refund on a 4500-cent capture with 900-cent original commission, retained commission is 500 and barber entitlement is 2000. `platformRetainedCents` is commission **before processing fees**; with an illustrative retained fee of 107, QuickTrimr's post-processing position is 393. Thus 2000 + 2000 + 393 + 107 = 4500. Do not treat commission as the post-fee position or use 107 as a configured fee.

```jsonc
// request
{ "disputeId": "f77c...", "outcome": "resolved_partial_refund",
  "refundCents": 2000, "reason": "Service partially delivered; agreed by both parties." }

// 200
{ "disputeId": "f77c...", "status": "resolved_partial_refund",
  "refundCents": 2000, "barberNetCents": 2000, "platformRetainedCents": 500,
  "capturedCents": 4500, "earningStatus": "available", "auditLogId": "al99..." }

// 422 — refund exceeds what was captured
{ "error": "validation_failed",
  "fields": { "refundCents": "Cannot exceed captured amount of 4500" } }

// 409 — already resolved
{ "error": "dispute_already_resolved", "status": "resolved_barber_paid" }

// 502 — Stripe failed; nothing was marked resolved
{ "error": "stripe_unavailable", "disputeStatus": "open" }
```

**Acceptance criteria**

- [ ] An admin can resolve a dispute with any supported outcome.
- [ ] **A reason is mandatory.**
- [ ] Refund amounts are calculated server-side using the same `packages/domain` functions as `P3-T07`.
- [ ] **A refund exceeding the captured amount is rejected.**
- [ ] **All state changes apply together or not at all** — a Stripe failure leaves the dispute `open` and nothing marked resolved.
- [ ] **A duplicate resolution refunds once** — proven against the Stripe test dashboard.
- [ ] The earning is updated correspondingly and is never left `available` on a fully refunded booking.
- [ ] Amounts reconcile: refund plus barber amount plus platform position plus unreturned Stripe fee equals the captured total.
- [ ] **A client or barber calling this receives 403** — verified at the API.
- [ ] No lock is held across the Stripe call.
- [ ] The audit log records the admin, outcome, reason and every amount.
- [ ] The server persists the validated admin-selected resolution outcome and server-generated `resolved_at` time for `RULE-REVIEW-06`; a request cannot supply the timestamp or bypass admin authorization.

**Tests** — a simulated Stripe failure leaving the dispute open and nothing partially applied; duplicate resolution asserted as one refund in Stripe; over-refund rejected; reconciliation asserted per outcome; role denial at the API; the earning state after each outcome; persisted resolution outcome and server timestamp (unchanged on duplicate resolution) supporting `RULE-REVIEW-06`.

**Out of scope** — the UI (`P5-T08`); Stripe-initiated chargebacks, which arrive via `P3-T03`.

**Sync notes** — shares refund maths with `P3-T07`. Both must use the same domain functions or an admin refund and a client cancellation will compute different numbers from the same booking.

---

#### P5-T08 — Admin dispute resolution UI

```yaml
id: P5-T08
title: "Admin dispute resolution UI"
issueType: Story
owner: Tony
phase: 5
priority: High
jiraKey: null
dependsOn: [P0-D03, P0-T17, P5-T06, P5-T07]
affects: []
knowledgeBase: [ADR-009, RULE-DISPUTE-04, RULE-DISPUTE-05, RULE-ADMIN-03, RULE-CANCEL-07, RULE-PAY-11]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin]
```

**Context**

An admin resolving a dispute is moving real money in a way that cannot be undone by clicking again. The screen's job is to make the financial consequence unmissable **before** confirmation, computed by the same functions the backend will use — not estimated.

**Scope**

A resolution action on the dispute detail: outcome selection, a refund amount for the partial case, and a mandatory reason.

**A financial impact summary before confirmation** — client refund, barber receives, platform retains, and what Stripe keeps — from the shared `packages/domain` functions.

Distinguish a service-refund allocation (`RULE-PAY-11`) from the commission-free cancellation allocation (`RULE-CANCEL-07`). Show QuickTrimr's negative post-processing position when applicable, rather than labelling zero retained commission as zero cost; cover this distinction in the displayed-impact tests.

`ConfirmDialog` from `P0-T17` with the impact in the body and the reason required.

The refund input bounded by the captured amount, validated before submission and again at the API.

Result state showing what was actually applied; a Stripe failure states plainly that nothing was changed.

**Acceptance criteria**

- [ ] An admin can select an outcome, enter a refund amount where applicable, and must enter a reason.
- [ ] **The financial impact is shown before confirmation** — client refund, barber amount, platform position, Stripe fee.
- [ ] **The displayed figures come from the shared domain functions**, not a client-side estimate.
- [ ] The refund input is bounded by the captured amount, with the bound shown.
- [ ] Confirmation is required, with the impact in the dialog body and the reason captured.
- [ ] The result shows what was applied and matches what was displayed.
- [ ] **A Stripe failure states plainly that nothing was changed** and the dispute remains open.
- [ ] `409 dispute_already_resolved` refreshes and shows the existing resolution.
- [ ] Loading and error states exist; a double click resolves once.

**Tests** — displayed impact matching the backend result for every outcome; Stripe failure rendering the unchanged state; double click producing one resolution; the refund bound enforced in the form.

**Out of scope** — the function (`P5-T07`); support ticketing, out of scope per `KB §16`.

---

#### P5-T09 — Admin payments and earnings

```yaml
id: P5-T09
title: "Admin payments and earnings"
issueType: Story
owner: Tony
phase: 5
priority: High
jiraKey: null
dependsOn: [P0-D02, P0-T17, P1-T02, P3-T03, P3-T04]
affects: [P5-T10]
knowledgeBase: [ADR-009, ROLE-ADMIN, RULE-ADMIN-01, RULE-ADMIN-04, RULE-PAY-08, RULE-PAY-10, RULE-PAY-11, RULE-CANCEL-07, ENUM-PAYMENT-STATUS, ENUM-EARNING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin, security]
```

**Context**

The reconciliation surface. When QuickTrimr's Stripe balance does not match what the database says, this is where the difference is found — which means every row needs its Stripe reference, and the totals need to be derived from the rows rather than stored separately.

`RULE-PAY-10` still applies: an admin needs the Stripe payment intent id to look a record up, not the full payment method or any card data.

**Scope**

Payments list: status, date range, client, barber, amount range. Each row carries its Stripe payment intent id.

Earnings list: status, barber, date range, with gross, commission and net.

Distinguish commission from QuickTrimr's post-processing position (`RULE-PAY-11`). Reconcile against actual Stripe-reported retained processing fees, show negative platform positions after full refunds, and do not label this limited cash allocation as profit. Processing fees never reduce barber net.

Include `RULE-CANCEL-07` examples: fully reversed commission, the adjusted inconvenience entitlement and negative QuickTrimr processing cost. Preserve the original snapshot separately from adjusted amounts; an available inconvenience earning does not mean the cancelled service was completed. Test the resulting filtered totals.

Detail linking a payment to its booking, its earning and any refund, so the full chain is traversable in both directions.

Totals derived from the filtered set and clearly scoped to the filter — a total that silently means something other than what is on screen is a reconciliation trap.

**No card data, no payment method detail, no Stripe secret.** The reference is enough to look it up in Stripe.

**Acceptance criteria**

- [ ] An admin can list and filter payments and earnings, server-side and paginated.
- [ ] Each payment row shows its Stripe payment intent id for reconciliation.
- [ ] Earnings show gross, commission and net, formatted from integer cents by the shared component.
- [ ] Payment, booking, earning and refund are linked and traversable in both directions.
- [ ] Totals are derived from the filtered set and labelled as such.
- [ ] **No card number or payment method detail is shown** (`RULE-PAY-10`).
- [ ] A non-admin receives no payment data in the response body.
- [ ] No unbounded query (`RULE-ADMIN-04`).
- [ ] Loading, error and empty states exist.

**Tests** — non-admin denial on the raw body; totals matching the sum of the filtered rows; the raw response asserted for absence of card data; pagination bounded.

**Out of scope** — payout batches (`P5-T10`); issuing refunds (`P5-T07`); accounting exports, out of scope per `KB §16`.

---

#### P5-T10 — Admin payout batches

```yaml
id: P5-T10
title: "Admin payout batches"
issueType: Story
owner: Tony
phase: 5
priority: Medium
jiraKey: null
dependsOn: [P0-D05, P0-T17, P3-T10, P3-T11, P5-T09]
affects: []
knowledgeBase: [ADR-009, ROLE-ADMIN, RULE-ADMIN-01, RULE-EARN-05, RULE-EARN-06, RULE-EARN-07, RULE-PAY-10, ENUM-PAYOUT-STATUS, ENUM-EARNING-STATUS]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin, stripe]
```

**Context**

Where a barber's "I haven't been paid" is answered. A **failed** payout item is the case that matters: money that should have moved and did not, sitting where nobody looks unless it is surfaced.

**Scope**

A payout batch list with scheduled cut-off, status, date range and totals, and a detail view of items per barber with amount, status and separate Stripe transfer and bank-payout references. Funding success is not bank payment; show retries/corrections without erasing history, estimated arrival when known, held age, provider holding deadline, next action and retry eligibility. Standard Connect/payout costs are separate platform costs, not a reduction of barber entitlement.

**A failed-items view across all batches**, including action-required and uncertain-outcome items, because these must not be silently stranded. Surface the alerts/operational escalation information produced by `P3-T11`; no hardcoded invented retry deadline or automatic forfeiture.

Include unqueued bank/account holds in the actionable population, linked to the affected earnings without inventing a batch item or transfer reference. The view must work for an account whose first payout was blocked before queueing.

Each item links to its earnings and their bookings.

Batch totals reconciling against item totals, shown together so a discrepancy is visible rather than inferred.

Read-only. Retry behaviour follows `P0-D05` and is owned by `P3-T11`; no manual transfer is triggered from this screen.

No bank account details or Stripe secrets — safe transfer/payout references and corrective guidance are enough. Bank-detail correction stays in the secure Stripe flow; this screen never edits a payout destination.

**Acceptance criteria**

- [ ] An admin can list payout batches with status, date and totals, paginated server-side.
- [ ] Batch detail distinguishes transfer funding from bank payout, shows both references and estimated arrival when known, and never labels a mixed paid/failed batch as paid.
- [ ] **A failed-items view exists across all batches**, including holds and unknown outcomes with age, provider deadline, next action and retry eligibility; a late failure remains visible with its correction history.
- [ ] Items link to their earnings and bookings.
- [ ] **Batch totals and the sum of item totals are shown together**, so a discrepancy is visible.
- [ ] The view is read-only; no manual transfer can be triggered.
- [ ] **No bank account detail or Stripe secret is shown** (`RULE-PAY-10`).
- [ ] A non-admin receives no payout data in the response body.
- [ ] Loading, error and empty states exist.

**Tests** — non-admin denial on the raw body; totals reconciling against items without fee deductions from barber net; failed-items view returning failed/held/uncertain/late-failure cases; transfer success plus pending bank payout not shown as paid; mixed-success batch; age/deadline/next-action display; no retry/destination-edit controls; raw response asserted for absence of bank details.

**Out of scope** — triggering payouts (`P3-T11`); accounting exports.

---

#### P5-T11 — Admin service categories

```yaml
id: P5-T11
title: "Admin service categories"
issueType: Story
owner: Tony
phase: 5
priority: Medium
jiraKey: null
dependsOn: [P0-T17, P1-T02, P1-T10]
affects: []
knowledgeBase: [ADR-013, RULE-SERVICE-01, RULE-SERVICE-03, RULE-SERVICE-05, RULE-ADMIN-01]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin]
```

**Context**

The UI over `P1-T10`. The consequences that need surfacing before an admin acts: archiving a category removes it from every barber's future selections, and narrowing a price bound can leave existing barber prices outside the new range.

That second one is the trap. An admin lowering a maximum price does not think about the barbers already above it, and the system should tell them how many there are before they confirm.

**Scope**

A category list with create, edit and archive.

Create and edit forms for display name, description, order, and min and max price in integer cents, validated against `P1-T10`.

**Before archiving**, show how many barbers currently offer the category and confirm.

**Before narrowing a price bound**, show how many existing barber prices would fall outside the new range and state what happens to them.

Drag or numeric reordering.

The slug shown but not editable after creation.

Audit logs written by the backend, and visible in the detail view.

**Acceptance criteria**

- [ ] An admin can create, edit, archive and reorder categories.
- [ ] Price bounds are validated; a maximum below a minimum is rejected.
- [ ] **Archiving shows how many barbers offer the category and requires confirmation.**
- [ ] **Narrowing a price bound shows how many existing barber prices would fall outside it**, and states what happens to them.
- [ ] The slug is displayed but not editable after creation.
- [ ] Category changes are audit logged and the log is visible in detail.
- [ ] A non-admin cannot reach the screen or its mutations — verified at the API.
- [ ] Loading, error and empty states exist.

**Tests** — the archive impact count matching seed data; the price-bound impact count; slug immutability in the form and at the API; role denial at the API.

**Out of scope** — the backend (`P1-T10`); barber pricing (`P1-T11`).

---

#### P5-T12 — Admin reviews and moderation

```yaml
id: P5-T12
title: "Admin reviews and moderation"
issueType: Story
owner: Tony
phase: 5
priority: Low
jiraKey: null
dependsOn: [P0-T17, P1-T02, P4-T14]
affects: []
knowledgeBase: [ADR-013, RULE-REVIEW-04, RULE-REVIEW-05, RULE-ADMIN-01]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin]
```

**Context**

Hiding a review changes a barber's public rating (`RULE-REVIEW-04`, `RULE-REVIEW-05`), so it is a moderation action with a commercial effect and belongs in the audit log with a reason.

**Scope**

A review list filterable by barber, client, rating and visibility, paginated server-side.

Hide and unhide with a mandatory reason, audit logged.

**The barber's rating before and after** shown before confirming — hiding a one-star review measurably moves a rating, and an admin should see by how much.

The linked booking, so a review can be checked against what actually happened.

**Acceptance criteria**

- [ ] An admin can list and filter reviews by barber, client, rating and visibility.
- [ ] An admin can hide and unhide a review with a mandatory reason.
- [ ] **The barber's rating before and after is shown before confirming.**
- [ ] Hiding recomputes the barber's aggregate, excluding the hidden review.
- [ ] Each review links to its booking.
- [ ] Moderation actions are audit logged with the reason.
- [ ] A non-admin cannot reach the screen or its mutations — verified at the API.
- [ ] Loading, error and empty states exist.

**Tests** — aggregate recomputation after hide and unhide; the projected rating matching the result; mandatory reason enforced; role denial at the API.

**Out of scope** — barber responses; automated moderation.

---

#### P5-T13 — Admin barber status and reliability management

```yaml
id: P5-T13
title: "Admin barber status and reliability management"
issueType: Task
owner: Tony
phase: 5
priority: High
jiraKey: null
dependsOn: [P0-D04, P1-T02, P3-T12, P5-T03]
affects: []
knowledgeBase: [ADR-013, RULE-ADMIN-01, RULE-RELY-01, RULE-RELY-02, RULE-RELY-05, RULE-RELY-06, ENUM-RELIABILITY-LEVEL, CFG-RELIABILITY-WINDOW-DAYS]
blockedByTbc: []
labels: [quicktrimr, phase-5, admin, backend, security]
```

**Context**

`RULE-RELY-05` — an admin can adjust a barber's reliability state with a recorded reason. `RULE-RELY-06` makes cancellation-reliability suspension admin-gated from the configured review threshold; this is where that suspension and human reinstatement happen.

**This decides whether someone earns money this week.** The reason is mandatory, the change is an append-only event in the same history the automatic ones are in (`RULE-RELY-01`), and it is fully reversible.

**Scope**

`admin-update-reliability-state`.

Admin role verified server-side; a mandatory reason.

Set a level directly, or excuse/correct a specific event after investigating an error or documented emergency. **Both are recorded as new events, never as edits or deletions** — the history stays append-only. A correction must refer to its original event so automatic recomputation does not count it again.

Enforce `RULE-RELY-06` server-side: for suspension under this cancellation policy, require the configured current offence threshold plus explicit admin approval with a reason. The admin sees the full event history, booking volume, exceptions and automatic level before deciding. At four offences the review flag is not itself suspension. Human reinstatement is required even after the offences age out; recovery jobs must not overwrite the suspension. Reuse the engine's audited mutation path and shared eligibility projection, not a second calculation in the dashboard.

An override is visibly distinguished from an automatic level in `P5-T03`'s history, so a later reader knows a human intervened.

The barber is notified of a change that affects their standing — a penalty they cannot see does not change behaviour, and one they discover through missing bookings damages trust.

Audit log with the admin, the reason, and the before and after.

**Contract example** — `admin-update-reliability-state`

```jsonc
// request
{ "barberId": "3b90...", "toLevel": "good_standing",
  "reason": "Cancellation was due to a documented medical emergency." }

// 200
{ "barberId": "3b90...", "level": "good_standing", "previousLevel": "limited",
  "eventId": "re22...", "overriddenByAdmin": true, "auditLogId": "al99..." }

// 422 — missing reason
{ "error": "validation_failed", "fields": { "reason": "Required" } }

// 403
{ "error": "forbidden" }
```

**Acceptance criteria**

- [ ] An admin can set a barber's reliability level and clear an event raised in error.
- [ ] **A reason is mandatory** and is stored with the change.
- [ ] **Changes are recorded as new append-only events**; no event is edited or deleted.
- [ ] An admin override is distinguishable from an automatic level in the history.
- [ ] The admin sees the full event history and the automatically computed level before overriding.
- [ ] The barber is notified of a change affecting their standing.
- [ ] The override is reversible by the same mechanism.
- [ ] Suspension under this policy is rejected below the configured review threshold; at/above it approval is still required. Tests cover fourth offence without approval, approved suspension surviving aging, reasoned human reinstatement and exception correction without history deletion.
- [ ] No reliability action itself cancels existing bookings or confiscates earnings; direct session/request/acceptance restrictions and search projections reflect the outcome.
- [ ] **A client or barber calling this receives 403** — verified at the API.
- [ ] An audit log records the admin, the reason, and the before and after.

**Tests** — an override recorded as a new event with the prior history intact; append-only enforcement attempted in SQL; mandatory reason; role denial at the API; the barber's discoverability in `P2-T04` changing to match the new level.

**Out of scope** — the reliability engine (`P3-T12`); the barber-facing display (`P3-T09`); account deletion.

---
## Phase 6 — Notifications, Analytics, QA & Release

**Goal:** both sides are told what happened, QuickTrimr can see what happened, the critical paths have tests, and the thing is releasable.

**Gate:** every notification in `RULE-NOTIF-01` fires, the money and access-control paths have automated coverage, and a staging environment runs the whole product end to end.

---

#### P6-T01 — Push notification foundation

```yaml
id: P6-T01
title: "Push notification foundation"
issueType: Task
owner: Andrew
phase: 6
priority: High
jiraKey: null
dependsOn: [P0-T13, P1-T01]
affects: [P6-T02]
knowledgeBase: [RULE-NOTIF-02, RULE-NOTIF-03]
blockedByTbc: []
labels: [quicktrimr, phase-6, mobile, notifications]
```

**Context**

Token registration, and the part usually done badly is **cleanup**. Tokens expire, devices are wiped, and users log out. An accumulating pile of dead tokens means every send fails a few times and the failure signal becomes noise nobody reads.

**Scope**

Expo push token registration after login, stored against the user and device.

Permission requested at a point where its purpose is obvious — before the first booking, not on first launch. A denied permission is handled: the app works, and the user is told what they will miss.

Token refresh handled, replacing rather than accumulating.

Tokens invalidated on logout, so a shared device does not push one user's booking to the next.

Dead tokens removed when a send reports them invalid (`RULE-NOTIF-03`).

**Acceptance criteria**

- [ ] A user can grant permission and their token is stored against user and device.
- [ ] Permission is requested in context, not on first launch.
- [ ] **Denying permission does not break the app**, and the user is told what they will miss.
- [ ] Token refresh replaces the old token rather than adding one.
- [ ] **Logout invalidates the token** so a shared device does not receive the previous user's notifications.
- [ ] A token reported invalid on send is removed.
- [ ] No duplicate tokens accumulate per user and device.

**Tests** — permission denial not breaking booking; token replacement on refresh; logout invalidation asserted by attempting a send; invalid-token cleanup.

**Out of scope** — notification triggers (`P6-T02`); SMS, out of scope per `KB §16`.

---

#### P6-T02 — Booking notification service

```yaml
id: P6-T02
title: "Booking notification service"
issueType: Task
owner: Andrew
phase: 6
priority: High
jiraKey: null
dependsOn: [P0-D05, P0-D07, P2-T08, P2-T12, P3-T06, P3-T11, P4-T11, P6-T01]
affects: []
knowledgeBase: [ADR-011, RULE-NOTIF-01, RULE-NOTIF-02, RULE-NOTIF-03, RULE-NOTIF-04, RULE-COPY-01, RULE-EARN-04, RULE-EARN-07]
blockedByTbc: []
labels: [quicktrimr, phase-6, backend, notifications]
```

**Context**

Notifications carry QuickTrimr's state changes to people who are not looking at the app, and two of them are load-bearing: the barber's incoming request — which expires in five minutes and is worthless if it arrives late — and the client's final completion prompt, which `RULE-COMPLETE-04` requires **before** money moves automatically.

`RULE-NOTIF-03` — a failed push must never block or reverse the state change that triggered it. A booking that fails to confirm because a notification failed is a far worse outcome than a missed notification.

`RULE-NOTIF-02` — payloads carry no more personal data than needed. A push preview appears on a lock screen, visible to anyone holding the phone. A client's address must never be in one.

**Scope**

A shared notification helper used by every triggering ticket, covering every event in `RULE-NOTIF-01`.

Integrate `P3-T11`'s durable payout/balance-change events and action-required/uncertain-outcome alerts for barber/admin (`RULE-EARN-07`). Payment success means bank-payout confirmation, not transfer funding. Processing dates and arrival estimates are labelled distinctly; holds require corrective guidance, not an unconditional next-run promise. Do not add bank details to payloads, and keep the in-app/admin state available when push is denied or fails.

Payloads carrying an identifier and minimal display text, with detail fetched in-app on open.

**Sends are asynchronous relative to the state change, not lossy fire-and-forget.** Persist a
durable notification intent with the triggering change, commit, then dispatch. Supabase
`pg_cron` bounded indexed due-notification sweeps (`ADR-011`) drive retries/recovery; missing
dispatch work is rediscovered from durable intents. A send failure is logged, never rolled back.
This slice owns its versioned schedule, server-only handler permissions, operational settings,
interrupted-claim recovery and independent heartbeat/oldest-unsent alerts. Reuse durable event
identities from each triggering slice; do not invent a new identity on every retry.

Notification records stored, so "the barber says they never got it" has an answer.

Deduplication where a trigger can fire twice, since `ADR-011`'s idempotent jobs may attempt a send more than once.

Copy compliant with `RULE-COPY-01` — nothing implying a charge that is only a hold, or money in a bank that is a QuickTrimr balance.

**Acceptance criteria**

- [ ] Every event in `RULE-NOTIF-01` has a notification.
- [ ] Payout holds/uncertainty notify the appropriate barber/admin, deduplicate under retries and link to persistent status/corrective guidance; transfer success is never announced as bank payment.
- [ ] **No payload contains an address, a phone number, or an amount the recipient is not party to** (`RULE-NOTIF-02`) — asserted per notification type.
- [ ] **A send failure does not block or reverse the state change**, and is logged.
- [ ] Notification records are stored with their outcome.
- [ ] A trigger firing twice produces one notification.
- [ ] Copy complies with `RULE-COPY-01`.
- [ ] No SMS is sent (`RULE-NOTIF-04`).
- [ ] The helper is reused by every triggering ticket rather than reimplemented.

**Tests** — payload content asserted per type for absence of personal data; a forced send failure leaving the state change committed; duplicate trigger producing one logical notification; every `RULE-NOTIF-01` event covered; crash after state commit before dispatch, missing dispatch work and interrupted claims; repeated concurrent dispatch; stopped-cron heartbeat/oldest-unsent alerts and worker API denial; no business-state rollback on push failure.

**Out of scope** — token registration (`P6-T01`); notification preferences; SMS and email.

**Sync notes** — six tickets trigger notifications through this helper. A new lifecycle event needs a case here or it is silent.

---

#### P6-T03 — Sentry error monitoring

```yaml
id: P6-T03
title: "Sentry error monitoring"
issueType: Task
owner: Andrew
phase: 6
priority: High
jiraKey: null
dependsOn: [P0-T03, P0-T13, P0-T16]
affects: []
knowledgeBase: [RULE-NOTIF-02, RULE-PAY-10]
blockedByTbc: []
labels: [quicktrimr, phase-6, mobile, admin, security]
```

**Context**

Error monitoring on a product holding addresses and payment references. **The default configuration sends more than QuickTrimr should**: request bodies, breadcrumbs and local scope routinely contain exactly the data `RULE-PAY-10` and `RULE-NOTIF-02` prohibit leaving the system.

Scrubbing has to be configured deliberately, before the first real error.

**Scope**

Sentry for mobile and admin, with environment separation so staging noise does not bury production signal.

**Scrubbing configured explicitly:** no card data, no Stripe secret, no full address, no phone number, no auth token. Request bodies filtered rather than sent wholesale.

Users identified by opaque id only — never name, email or phone.

Error boundaries in both apps producing a usable screen rather than a white one, with a recovery action.

Source maps uploaded for readable stack traces.

Release tagging so an error is traceable to a build.

**Acceptance criteria**

- [ ] Sentry is configured for mobile and admin with environment separation.
- [ ] **Scrubbing is verified by triggering an error carrying an address, a card reference and an auth token, then confirming none reached Sentry.**
- [ ] Users are identified by opaque id only.
- [ ] Error boundaries render a usable screen with a recovery action.
- [ ] Source maps produce readable traces.
- [ ] Releases are tagged and traceable to a build.
- [ ] The Sentry DSN is handled per `P0-T03`'s public/private split.

**Tests** — a deliberate error carrying sensitive fields, with the Sentry payload inspected to confirm scrubbing; error boundary rendering; release tagging present.

**Out of scope** — backend log aggregation (`P6-T05`); alerting policy.

---

#### P6-T04 — PostHog product analytics

```yaml
id: P6-T04
title: "PostHog product analytics"
issueType: Task
owner: Andrew
phase: 6
priority: Medium
jiraKey: null
dependsOn: [P0-T03, P0-T13, P0-T16]
affects: []
knowledgeBase: [RULE-NOTIF-02, RULE-COPY-01]
blockedByTbc: []
labels: [quicktrimr, phase-6, mobile, admin]
```

**Context**

The funnel questions worth answering are marketplace ones: how many searches produce a request, how many requests are accepted, how many bookings complete without a dispute. Answering them needs event names decided once, because analytics renamed later loses its own history.

The privacy line is the same as `P6-T03`: an event property must not carry an address, a name, or an exact location.

**Scope**

PostHog for mobile and admin, with environment separation.

Events for the funnel: signup, onboarding completed, search performed, barber viewed, request submitted, request accepted, declined, expired, payment captured, on the way, completed, disputed, review submitted.

Properties limited to non-identifying dimensions: booking type, service category, price band, distance band, outcome. **Never an address, name, exact location or exact amount tied to a person.**

Users identified by opaque id.

All calls behind one analytics module, so a property is added in one place and the privacy rule is enforced once.

A documented event dictionary — names, properties, and when each fires.

**Acceptance criteria**

- [ ] PostHog is configured for both apps with environment separation.
- [ ] Every funnel event listed is implemented with consistent naming.
- [ ] **No event property contains an address, name, exact location, or an amount tied to an individual** — asserted per event.
- [ ] Users are identified by opaque id only.
- [ ] All calls go through one analytics module.
- [ ] An event dictionary is documented.
- [ ] The PostHog key is handled per `P0-T03`'s split.

**Tests** — event payloads asserted per event for absence of identifying properties; the funnel firing end to end through a full booking; naming consistency against the dictionary.

**Out of scope** — dashboards and funnel analysis; feature flags; A/B testing.

---

#### P6-T05 — Edge Function structured logging

```yaml
id: P6-T05
title: "Edge Function structured logging"
issueType: Task
owner: Tony
phase: 6
priority: High
jiraKey: null
dependsOn: [P0-T09]
affects: [P6-T07]
knowledgeBase: [ADR-002, ADR-013, RULE-PAY-10, RULE-NOTIF-02]
blockedByTbc: []
labels: [quicktrimr, phase-6, backend, security]
```

**Context**

When a payment goes wrong, the question is what happened in which order. Unstructured logs across a dozen functions cannot answer that; a correlation id running through the whole chain can.

The constraint is the same one everywhere: **never a card number, a secret, a full Stripe payload, or an address** (`RULE-PAY-10`, `RULE-NOTIF-02`). Logs are the easiest place to leak all four, because logging the whole object is the convenient thing to do while debugging.

**Scope**

A shared logging helper in `supabase/functions/_shared/logging`, used by every function (`ADR-002`).

Structured output with: correlation id, function name, user id, role, outcome, and duration.

A correlation id generated at entry and propagated through every call, including the Stripe call, so one booking's whole chain is retrievable.

**A redaction layer that strips known-sensitive keys** before output — card fields, Stripe secrets, tokens, addresses, phone numbers — so a developer logging an object cannot leak one by accident.

Payment and booking state changes logged with before and after, distinct from `audit_logs` which remains the durable record (`ADR-013`).

**Acceptance criteria**

- [ ] A shared logging helper exists and is used by every Edge Function.
- [ ] Logs are structured with correlation id, function, user, role, outcome and duration.
- [ ] **A correlation id follows one request through every function and external call.**
- [ ] **A redaction layer strips sensitive keys** — proven by logging an object containing a card field, a token and an address, and confirming none appear in the output.
- [ ] Payment and booking state changes are logged with before and after.
- [ ] Logs are distinct from `audit_logs` and do not replace them.
- [ ] Log volume is bounded; no per-row logging in a loop.

**Tests** — a redaction test logging a deliberately sensitive object and asserting the output; correlation id propagation across a multi-function flow; structured field presence.

**Out of scope** — an external log provider; alerting.

---

#### P6-T06 — Manual QA test plan

```yaml
id: P6-T06
title: "Manual QA test plan"
issueType: Task
owner: Tony
phase: 6
priority: Highest
jiraKey: null
dependsOn: [P3-T07, P4-T11, P5-T07]
affects: [P6-T11]
knowledgeBase: [RULE-ADMIN-01, RULE-COMPLETE-04, RULE-CANCEL-07, RULE-EARN-04]
blockedByTbc: []
labels: [quicktrimr, phase-6, qa]
```

**Context**

Some things cannot be automated at reasonable cost: a real Stripe Connect onboarding, a real push arriving on a locked phone, a barber physically travelling while an ETA refreshes. The plan covers those, and the paths where an automated pass would not prove the experience is right.

**Scope**

`docs/qa/test-plan.md` with cases covering: client onboarding; barber onboarding including real Connect; Available Now end to end; Scheduled end to end; request expiry; accept and decline; payment authorisation and capture including a **deliberate capture failure**; all four cancellation cases with the refund arithmetic checked against Stripe; all three completion cases including both auto-completion paths; disputes and admin resolution; payout batching; ETA including permission denial; reviews; and every admin action.

**Access control cases run as the wrong role**, at the API, for every admin action and every cross-user read.

Each case: preconditions, steps, expected result, and how to verify — including which Stripe dashboard figure to check for money cases.

Cancellation cases must include the `RULE-CANCEL-07` split for both booking types, client-refund-up rounding, the exact Scheduled-window boundary, negative platform processing cost, and the inconvenience earning reaching normal payout eligibility only after refund success with no dispute. Assert the booking stays cancelled and the original service entitlement is not also paid.

A regression subset for each release.

**Acceptance criteria**

- [ ] The plan covers every flow listed in Scope.
- [ ] Each case has preconditions, steps, expected result and a verification method.
- [ ] **Money cases specify the Stripe figure to reconcile against**, not just "check the refund".
- [ ] **Access control cases are run as the wrong role at the API**, not by checking a hidden button.
- [ ] Both auto-completion paths are covered, including the final prompt preceding completion.
- [ ] A regression subset is defined for release.
- [ ] The plan states what is deliberately not automated and why.

**Out of scope** — automated tests (`P6-T07`, `P6-T08`); Detox, out of scope per `KB §16`.

---

#### P6-T07 — Backend tests for critical business rules

```yaml
id: P6-T07
title: "Backend tests for critical business rules"
issueType: Task
owner: Tony
phase: 6
priority: High
jiraKey: null
dependsOn: [P2-T12, P3-T02, P3-T07, P3-T11, P4-T11, P5-T07, P6-T05]
affects: []
knowledgeBase: [RULE-PAY-04, RULE-PAY-05, RULE-REQUEST-05, RULE-AVAIL-05, RULE-CANCEL-07, RULE-COMPLETE-04, RULE-EARN-03, RULE-EARN-06, RULE-ADMIN-01]
blockedByTbc: []
labels: [quicktrimr, phase-6, backend, qa, security]
```

**Context**

A consolidating ticket. Individual tickets carry their own tests; this one covers the **cross-cutting** properties no single ticket owns — the invariants that hold across the whole system rather than inside one function.

`KB §15` lists what must have coverage. This ticket proves that list is actually covered, end to end, rather than covered in fragments that each pass in isolation.

**Scope**

A cross-cutting suite covering the invariants:

| Invariant | Why it is here |
|---|---|
| No client is ever charged twice for one booking | Spans authorise, capture, refund and dispute resolution |
| No barber is ever paid twice for one booking | Spans earning creation, batching and payout |
| Every terminal request releases or captures its hold | Spans accept, decline, expire and cancel |
| Refund plus barber plus platform plus Stripe fee equals captured, in every path | Spans cancellation and dispute resolution |
| Cancellation releases only the inconvenience amount after refund success, without completion or duplicate service payment | Spans cancellation, earnings and payout; pending/failed refund and open-dispute cases must block release |
| An open dispute always blocks release | Spans completion, auto-completion and payout |
| No table is readable across users | Spans every table |
| Every admin action is denied to client and barber at the API | Spans every admin function |

**Concurrency tests use real parallelism, repeated.** Acceptance, capture, batch processing and the auto-completion race each run many times, because a race that passes once has not been tested.

Time-dependent rules tested with a controlled clock at exact boundaries.

Wired into CI (`P0-T04`).

**Acceptance criteria**

- [ ] Every invariant listed has an automated test.
- [ ] Every rule in `KB §15` has coverage, and the mapping is documented.
- [ ] **Concurrency tests use real parallelism and repeated runs** — acceptance, capture, payout processing and the auto-completion race.
- [ ] Time-dependent rules are tested at exact boundaries with a controlled clock.
- [ ] **Access control tests call the API directly as the wrong role**, for every admin function and every cross-user read.
- [ ] Money tests assert exact integer-cent values, not approximations.
- [ ] The suite runs in CI and fails the build on a regression.
- [ ] **No test is flaky** — the suite passes repeatedly under a repeat run.

**Tests** — this ticket is the tests. Its own acceptance is the suite existing, passing repeatedly, and mapping to `KB §15`.

**Out of scope** — UI tests (`P6-T08`); manual QA (`P6-T06`).

---

#### P6-T08 — Admin Playwright smoke tests

```yaml
id: P6-T08
title: "Admin Playwright smoke tests"
issueType: Task
owner: Tony
phase: 6
priority: Medium
jiraKey: null
dependsOn: [P0-T04, P5-T04, P5-T06, P5-T08]
affects: []
knowledgeBase: [RULE-ADMIN-01, RULE-ADMIN-02, RULE-DISPUTE-04]
blockedByTbc: []
labels: [quicktrimr, phase-6, admin, qa, security]
```

**Context**

Smoke coverage for the surface that moves money. The highest-value case is not a happy path: it is that **a non-admin cannot reach an admin route**, asserted in a real browser session.

**Scope**

Playwright against admin, using seed data.

Cases: admin login; overview loads; bookings, barbers, disputes and payments lists load; a booking detail opens; a dispute detail opens.

**Access control in a real browser:** an unauthenticated visitor is redirected; a client account is refused; a barber account is refused; and in each case **the response body contains no operational data**.

One mutation smoke test — resolving a seeded dispute — asserting the mandatory reason is enforced and the confirmation is required.

Runs in CI against a seeded database.

**Acceptance criteria**

- [ ] Admin login is tested.
- [ ] Overview, bookings, barbers, disputes and payments lists load.
- [ ] Booking and dispute details open.
- [ ] **Unauthenticated, client and barber accounts are each refused an admin route**, and the response contains no operational data.
- [ ] One mutation is smoke tested, asserting the mandatory reason and confirmation.
- [ ] Tests run in CI against seed data.
- [ ] Tests are not flaky.

**Out of scope** — a full browser matrix; mobile E2E, out of scope per `KB §16`; exhaustive UI coverage.

---

#### P6-T09 — Staging environment

```yaml
id: P6-T09
title: "Staging environment"
issueType: Task
owner: Tony
phase: 6
priority: Highest
jiraKey: null
dependsOn: [P0-T03, P0-T09, P0-T18]
affects: [P6-T10, P6-T11]
knowledgeBase: [ADR-001, RULE-PAY-07, RULE-PAY-10, RULE-ETA-02]
blockedByTbc: []
labels: [quicktrimr, phase-6, security]
```

**Context**

Somewhere to run the whole product before it is real. The rule that matters: **no production data in staging**, and no staging credential able to reach production. A staging environment pointed at a production Stripe key is a live charge nobody meant to make.

**Scope**

A staging Supabase project with migrations applied and seed data, entirely separate from production.

Admin deployed to a staging Vercel environment; mobile buildable against staging via EAS profiles (`P6-T10`).

Stripe test mode with a **staging-specific webhook endpoint and its own signing secret** (`RULE-PAY-07`). Google keys scoped to staging with their own quotas.

Sentry and PostHog on a staging environment so its noise stays out of production signal.

Every variable documented per `P0-T03`, with values held in the secret store — never in the repo.

**A stated separation guarantee:** no staging credential grants access to production, verified rather than assumed.

**Acceptance criteria**

- [ ] A staging Supabase project exists with migrations and seed data applied.
- [ ] Admin is deployed to staging and mobile can be built against it.
- [ ] Stripe test mode is configured with a staging webhook endpoint and its own signing secret.
- [ ] Google keys are staging-scoped with their own quotas and budget alerts.
- [ ] Sentry and PostHog use a staging environment.
- [ ] **No production data is present in staging.**
- [ ] **No staging credential can reach production** — verified, not assumed.
- [ ] Every variable is documented and held in the secret store, not the repo.
- [ ] The full booking flow runs end to end on staging.

**Tests** — a full booking flow executed on staging; a verification that staging credentials fail against production; a check that no production data is present.

**Out of scope** — production launch (`P6-T11`); app store submission.

---

#### P6-T10 — Expo EAS build pipeline

```yaml
id: P6-T10
title: "Expo EAS build pipeline"
issueType: Task
owner: Andrew
phase: 6
priority: High
jiraKey: null
dependsOn: [P0-T13, P6-T09]
affects: [P6-T11]
knowledgeBase: [ADR-007, RULE-PAY-10, RULE-ETA-02]
blockedByTbc: []
labels: [quicktrimr, phase-6, mobile, security]
```

**Context**

Getting the app onto real devices. The risk specific to a mobile build is that **anything bundled is extractable** — `P0-T03` made the public/private split structural, and this is where it is verified against an actual build artefact rather than against source.

**Scope**

EAS configuration with development, staging and production profiles, each pointing at the right environment from `P6-T09`.

Development builds installable on a real device for both engineers.

Environment variables injected per profile, with **only public-tier variables** reaching the bundle.

**A build-artefact check** confirming no server-only variable is present in a built bundle. Source-level checking is not enough; the bundler can inline more than expected.

Build and distribution documented, including how a new device is registered.

**Acceptance criteria**

- [ ] EAS profiles exist for development, staging and production, each targeting the right environment.
- [ ] A development build installs and runs on a real device.
- [ ] A staging build points at staging and runs the full flow.
- [ ] **A built bundle contains no server-only variable** — verified by inspecting the artefact, not the source.
- [ ] Only public-tier variables are injected per `P0-T03`.
- [ ] The build and distribution process is documented, including device registration.

**Tests** — a bundle inspection asserting absence of the service-role key, Stripe secret and Google server key; a staging build completing a booking end to end.

**Out of scope** — store submission (`P6-T11`); over-the-air update policy.

---

#### P6-T11 — Production release checklist

```yaml
id: P6-T11
title: "Production release checklist"
issueType: Task
owner: Tony
phase: 6
priority: High
jiraKey: null
dependsOn: [P0-T18, P6-T06, P6-T07, P6-T09, P6-T10]
affects: []
knowledgeBase: [ADR-001, ADR-013, RULE-PAY-07, RULE-PAY-10, RULE-ETA-02, RULE-ADMIN-01, RULE-COPY-01]
blockedByTbc: []
labels: [quicktrimr, phase-6, qa, security]
```

**Context**

The last gate before real money and real addresses. Switching Stripe to live mode is the point at which every mistake in this backlog becomes a real client's real card, so the checklist is a set of verifications, not a set of intentions.

**Scope**

`docs/qa/release-checklist.md` covering:

- **Access control** — RLS enabled and denial-tested on every table; every admin function denied to client and barber at the API.
- **Stripe live mode** — live keys server-only, a live webhook endpoint with its own verified signing secret, Connect configured live, and the authorisation hold period re-confirmed against the live account.
- **Google** — client key restricted by bundle id, server key restricted by API and absent from the bundle, quotas and budget alerts set.
- **Secrets** — no secret in the repo or in any build artefact; a rotation procedure documented.
- **Data** — no test data in production; seed scripts cannot run against production.
- **Monitoring** — Sentry and PostHog on production environments with scrubbing verified against a real error.
- **Copy** — `RULE-COPY-01` reviewed across app, notifications and the Wix site: nothing implies live tracking, a hold described as a charge, or a QuickTrimr balance as a bank deposit.
- **Operational readiness** — who is on call, how a stuck `accepted_pending_payment` booking is found and cleared, how a failed payout is retried, and the target response time for a dispute.
- **Rollback** — how to revert a release; what cannot be rolled back, namely a captured payment and a completed transfer.
- **Known limitations** — the `KB §16` out-of-scope list, stated so nobody is surprised at launch.

**Acceptance criteria**

- [ ] The checklist covers every area in Scope.
- [ ] Each item states **how it is verified**, not just that it should be true.
- [ ] Stripe live-mode items include re-confirming the authorisation hold period against the live account.
- [ ] The Google server key is verified absent from the production bundle.
- [ ] Scrubbing is verified against a real production error, not assumed from configuration.
- [ ] `RULE-COPY-01` review covers app, notifications and the Wix site.
- [ ] **Operational runbooks exist for a stuck booking, a failed payout and an open dispute.**
- [ ] The rollback plan states what cannot be rolled back.
- [ ] Known limitations are listed from `KB §16`.

**Out of scope** — the launch itself; marketing; app store review.

---

## Phase 7 — Wix Marketing Website

---

#### P7-T01 — Wix sitemap and content structure

```yaml
id: P7-T01
title: "Wix sitemap and content structure"
issueType: Task
owner: Andrew
phase: 7
priority: Medium
jiraKey: null
dependsOn: [P6-T11]
affects: [P7-T02]
knowledgeBase: [RULE-COPY-01, RULE-EARN-04, RULE-ONBOARD-04]
blockedByTbc: []
labels: [quicktrimr, phase-7, wix]
```

**Context**

Last for a reason. A marketing site describing a product that does not exist yet describes the wrong product, and rewriting copy is cheaper than rewriting the app to match it.

**Every claim must be one the product implements** (`RULE-COPY-01`). Marketing is the most likely place for "track your barber in real time" to be written by someone who did not read `ADR-004`, and the most public place for it to appear.

**Scope**

Pages: Home, How It Works, For Clients, For Barbers, FAQ, Contact.

Content per page, with **every claim mapped to the rule or ticket that implements it.** A claim with no mapping is removed, not softened.

Particular care on:

- **No implication of live tracking** (`ADR-004`, `RULE-ETA-05`). "See when your barber is on the way" is true; "track your barber live" is not.
- **Barber earnings described honestly** (`RULE-EARN-04`) — a payout schedule, not "instant payouts".
- **Verification described accurately** (`RULE-ONBOARD-04`) — Stripe Connect onboarding, not background checks QuickTrimr does not run.
- **Pricing described as barber-set** (`RULE-SERVICE-02`), not platform-set.

Basic SEO structure, and a mobile-first layout.

**Acceptance criteria**

- [ ] Sitemap covers Home, How It Works, For Clients, For Barbers, FAQ and Contact.
- [ ] Content is drafted per page.
- [ ] **Every claim is mapped to the rule or ticket that implements it**; unmapped claims are removed.
- [ ] **No copy implies live tracking** (`ADR-004`).
- [ ] Barber earnings and payout timing are described accurately (`RULE-EARN-04`).
- [ ] Verification is described as Stripe Connect onboarding, not as checks QuickTrimr does not perform.
- [ ] Pricing is described as barber-set.
- [ ] SEO structure and a mobile-first layout are documented.

**Out of scope** — building the site (`P7-T02`); any app functionality; a blog or CMS.

---

#### P7-T02 — Build the Wix marketing site

```yaml
id: P7-T02
title: "Build the Wix marketing site"
issueType: Story
owner: Andrew
phase: 7
priority: Medium
jiraKey: null
dependsOn: [P7-T01]
affects: []
knowledgeBase: [RULE-COPY-01, RULE-ADMIN-01]
blockedByTbc: []
labels: [quicktrimr, phase-7, wix, security]
```

**Context**

`KB §3.3` — the constraint is absolute: **Wix must not power authentication, bookings, payments, admin, booking lifecycle, or any marketplace logic.**

The specific risk is a Wix form. A "sign up as a barber" form on Wix collecting a name, phone number and email is a marketplace surface holding personal data outside every control in this backlog — no RLS, no audit log, no access model.

**Scope**

Build the pages from `P7-T01`, responsive.

**Every product action deep-links to the real app.** Sign up, log in, download — all links, never forms.

A contact method that does not collect personal data beyond an enquiry, and does not collect a credential, a payment detail, or booking data.

Basic SEO fields, an app store or waitlist link, and analytics respecting the `P6-T04` privacy line — no PII.

**Acceptance criteria**

- [ ] The pages are built and responsive on mobile and desktop.
- [ ] **No authentication, booking, payment, admin or marketplace logic runs on Wix.**
- [ ] **No Wix form collects a credential, a payment detail, or booking data.**
- [ ] Every product action deep-links to the real app.
- [ ] The contact method works and collects no more than an enquiry.
- [ ] **All copy complies with `RULE-COPY-01`** — the live-tracking and earnings claims checked most of all.
- [ ] Every claim is implemented by the product.
- [ ] Analytics collect no PII.
- [ ] No secret or platform credential is embedded anywhere in the site.

**Out of scope** — SEO beyond basics; a blog or CMS; A/B testing; anything that would move marketplace logic onto Wix.

---

<!-- TICKETS-END -->

## 8. Traceability: Knowledge Base → Tickets

**Generated by `scripts/jira/generate-indexes.mjs`. Do not hand-maintain.**

Use it when you change a rule in the knowledge base: look up the ID you changed, and every
ticket listed is either still correct or needs a follow-up. Record which, in the PR (`KB §1.3`).

| Knowledge base ID | Implemented by |
|---|---|
| `ADR-001` | `P0-T03`, `P0-T09`, `P0-T10`, `P0-T11`, `P0-T12`, `P1-T01`, `P6-T09`, `P6-T11` |
| `ADR-002` | `P0-T08`, `P0-T09`, `P1-T03`, `P1-T07`, `P6-T05` |
| `ADR-003` | `P0-T13`, `P0-T15`, `P2-T05` |
| `ADR-004` | `P0-D06`, `P2-T07`, `P4-T03`, `P4-T04`, `P4-T05`, `P4-T06` |
| `ADR-005` | `P0-T10`, `P1-T04` |
| `ADR-006` | `P0-D08`, `P0-T18`, `P2-T08`, `P2-T09`, `P3-T01`, `P3-T02`, `P3-T06` |
| `ADR-007` | `P0-T01`, `P0-T02`, `P0-T04`, `P0-T06`, `P0-T07`, `P0-T13`, `P0-T14`, `P0-T16`, `P0-T17`, `P6-T10` |
| `ADR-008` | `P0-D06`, `P0-T03`, `P0-T09`, `P0-T10`, `P0-T12`, `P0-T18`, `P1-T05`, `P1-T06`, `P2-T01`, `P2-T04`, `P2-T07`, `P4-T05` |
| `ADR-009` | `P0-D02`, `P0-D03`, `P0-T10`, `P0-T12`, `P1-T11`, `P2-T08`, `P3-T01`, `P3-T02`, `P3-T04`, `P3-T07`, `P3-T10`, `P5-T07`, `P5-T08`, `P5-T09`, `P5-T10` |
| `ADR-010` | `P0-T06`, `P0-T10`, `P0-T12`, `P2-T12`, `P3-T02`, `P3-T06`, `P4-T01`, `P4-T02`, `P4-T03`, `P4-T07`, `P4-T09`, `P4-T12`, `P5-T04`, `P5-T05` |
| `ADR-011` | `P0-D07`, `P2-T03`, `P2-T15`, `P3-T11`, `P3-T12`, `P4-T05`, `P4-T11`, `P6-T02` |
| `ADR-012` | `P0-T05` |
| `ADR-013` | `P0-T05`, `P0-T10`, `P0-T11`, `P0-T12`, `P0-T17`, `P1-T02`, `P1-T03`, `P1-T07`, `P1-T09`, `P1-T10`, `P2-T03`, `P2-T08`, `P2-T12`, `P2-T13`, `P2-T15`, `P3-T01`, `P3-T02`, `P3-T03`, `P3-T04`, `P3-T07`, `P3-T10`, `P3-T11`, `P3-T12`, `P4-T03`, `P4-T07`, `P4-T09`, `P4-T11`, `P4-T12`, `P4-T14`, `P5-T02`, `P5-T05`, `P5-T07`, `P5-T11`, `P5-T12`, `P5-T13`, `P6-T05`, `P6-T11` |
| `ADR-014` | `P0-T19` |
| `RULE-ADMIN-01` | `P0-T05`, `P0-T07`, `P0-T08`, `P0-T11`, `P0-T16`, `P1-T02`, `P1-T10`, `P5-T01`, `P5-T02`, `P5-T03`, `P5-T04`, `P5-T05`, `P5-T06`, `P5-T07`, `P5-T09`, `P5-T10`, `P5-T11`, `P5-T12`, `P5-T13`, `P6-T06`, `P6-T07`, `P6-T08`, `P6-T11`, `P7-T02` |
| `RULE-ADMIN-02` | `P5-T05`, `P6-T08` |
| `RULE-ADMIN-03` | `P5-T07`, `P5-T08` |
| `RULE-ADMIN-04` | `P5-T01`, `P5-T02`, `P5-T03`, `P5-T04`, `P5-T06`, `P5-T09` |
| `RULE-AVAIL-01` | `P0-T10`, `P2-T01`, `P2-T02` |
| `RULE-AVAIL-02` | `P2-T01`, `P2-T02` |
| `RULE-AVAIL-03` | `P0-D04`, `P2-T02`, `P2-T03`, `P2-T13`, `P2-T15` |
| `RULE-AVAIL-04` | `P2-T08` |
| `RULE-AVAIL-05` | `P2-T03`, `P2-T11`, `P2-T12`, `P2-T14`, `P6-T07` |
| `RULE-AVAIL-06` | `P2-T09`, `P2-T11`, `P2-T15` |
| `RULE-AVAIL-07` | `P2-T12` |
| `RULE-CANCEL-01` | `P0-D03`, `P3-T07`, `P3-T08` |
| `RULE-CANCEL-02` | `P0-D03`, `P3-T07`, `P3-T08`, `P3-T09` |
| `RULE-CANCEL-03` | `P0-D03`, `P3-T07`, `P3-T08` |
| `RULE-CANCEL-04` | `P0-D03`, `P0-D04`, `P3-T07`, `P3-T09` |
| `RULE-CANCEL-05` | `P0-D03`, `P3-T07`, `P5-T07` |
| `RULE-CANCEL-06` | `P3-T08`, `P3-T09` |
| `RULE-CANCEL-07` | `P0-D03`, `P2-T08`, `P2-T09`, `P3-T04`, `P3-T05`, `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P5-T07`, `P5-T08`, `P5-T09`, `P6-T06`, `P6-T07` |
| `RULE-COMPLETE-01` | `P4-T07` |
| `RULE-COMPLETE-02` | `P4-T07`, `P4-T08`, `P4-T09`, `P4-T10`, `P4-T11` |
| `RULE-COMPLETE-03` | `P4-T09`, `P4-T10` |
| `RULE-COMPLETE-04` | `P4-T10`, `P4-T11`, `P6-T06`, `P6-T07` |
| `RULE-COMPLETE-05` | `P4-T11` |
| `RULE-COPY-01` | `P1-T08`, `P2-T02`, `P2-T09`, `P2-T14`, `P3-T05`, `P3-T08`, `P3-T09`, `P4-T01`, `P4-T02`, `P4-T04`, `P4-T06`, `P4-T08`, `P4-T10`, `P4-T13`, `P6-T02`, `P6-T04`, `P6-T11`, `P7-T01`, `P7-T02` |
| `RULE-DEV-CI` | `P0-T04` |
| `RULE-DISCOVERY-01` | `P2-T04`, `P2-T05` |
| `RULE-DISCOVERY-02` | `P0-D06`, `P2-T04` |
| `RULE-DISCOVERY-03` | `P1-T06`, `P2-T04` |
| `RULE-DISCOVERY-04` | `P0-D06`, `P1-T12`, `P2-T04`, `P2-T06`, `P2-T07`, `P2-T10` |
| `RULE-DISCOVERY-05` | `P0-D06`, `P1-T06`, `P2-T01`, `P2-T04`, `P2-T06`, `P2-T07`, `P4-T05`, `P4-T06` |
| `RULE-DISPUTE-01` | `P4-T09`, `P4-T12`, `P4-T13`, `P5-T06` |
| `RULE-DISPUTE-02` | `P4-T09`, `P4-T12`, `P5-T06` |
| `RULE-DISPUTE-03` | `P4-T12`, `P4-T13` |
| `RULE-DISPUTE-04` | `P5-T07`, `P5-T08`, `P6-T08` |
| `RULE-DISPUTE-05` | `P5-T07`, `P5-T08` |
| `RULE-DISPUTE-06` | `P4-T12`, `P5-T07` |
| `RULE-EARN-01` | `P0-D02`, `P0-T10`, `P3-T04`, `P3-T07` |
| `RULE-EARN-02` | `P0-D03`, `P3-T04`, `P3-T05`, `P3-T07`, `P3-T10`, `P3-T11`, `P4-T07`, `P4-T08`, `P4-T09`, `P4-T11`, `P5-T05`, `P5-T07` |
| `RULE-EARN-03` | `P0-D03`, `P3-T04`, `P3-T07`, `P3-T10`, `P3-T11`, `P4-T09`, `P4-T11`, `P4-T12`, `P5-T06`, `P5-T07`, `P6-T07` |
| `RULE-EARN-04` | `P0-D05`, `P3-T05`, `P3-T10`, `P3-T11`, `P4-T08`, `P6-T02`, `P6-T06`, `P7-T01` |
| `RULE-EARN-05` | `P0-D05`, `P0-T18`, `P3-T03`, `P3-T05`, `P3-T10`, `P3-T11`, `P5-T10` |
| `RULE-EARN-06` | `P0-D05`, `P3-T03`, `P3-T10`, `P3-T11`, `P5-T10`, `P6-T07` |
| `RULE-EARN-07` | `P0-D05`, `P0-T10`, `P0-T18`, `P1-T07`, `P3-T03`, `P3-T05`, `P3-T10`, `P3-T11`, `P5-T10`, `P6-T02` |
| `RULE-ETA-01` | `P4-T03`, `P4-T04` |
| `RULE-ETA-02` | `P0-D06`, `P0-T03`, `P0-T18`, `P4-T05`, `P6-T09`, `P6-T10`, `P6-T11` |
| `RULE-ETA-03` | `P0-D06`, `P4-T05`, `P4-T06` |
| `RULE-ETA-04` | `P0-D06`, `P4-T05`, `P4-T06` |
| `RULE-ETA-05` | `P4-T04`, `P4-T05`, `P4-T06` |
| `RULE-NOTIF-01` | `P3-T11`, `P6-T02` |
| `RULE-NOTIF-02` | `P6-T01`, `P6-T02`, `P6-T03`, `P6-T04`, `P6-T05` |
| `RULE-NOTIF-03` | `P3-T11`, `P6-T01`, `P6-T02` |
| `RULE-NOTIF-04` | `P6-T02` |
| `RULE-ONBOARD-01` | `P0-T11`, `P1-T01`, `P1-T03` |
| `RULE-ONBOARD-02` | `P1-T04`, `P1-T05` |
| `RULE-ONBOARD-03` | `P1-T06` |
| `RULE-ONBOARD-04` | `P0-T18`, `P1-T07`, `P1-T08`, `P1-T09`, `P1-T11`, `P2-T04`, `P3-T11`, `P5-T03`, `P7-T01` |
| `RULE-ONBOARD-05` | `P0-T11`, `P1-T06`, `P1-T12`, `P2-T06` |
| `RULE-PAY-01` | `P0-D02`, `P0-T07`, `P3-T01` |
| `RULE-PAY-02` | `P3-T01`, `P3-T06` |
| `RULE-PAY-03` | `P3-T02`, `P3-T06` |
| `RULE-PAY-04` | `P3-T02`, `P3-T11`, `P5-T07`, `P6-T07` |
| `RULE-PAY-05` | `P3-T02`, `P3-T06`, `P5-T04`, `P6-T07` |
| `RULE-PAY-06` | `P3-T02`, `P3-T03`, `P3-T11` |
| `RULE-PAY-07` | `P1-T09`, `P3-T03`, `P6-T09`, `P6-T11` |
| `RULE-PAY-08` | `P0-D02`, `P3-T01`, `P3-T04`, `P5-T09` |
| `RULE-PAY-09` | `P3-T02`, `P3-T11` |
| `RULE-PAY-10` | `P0-T03`, `P0-T18`, `P1-T07`, `P1-T09`, `P3-T01`, `P3-T03`, `P5-T09`, `P5-T10`, `P6-T03`, `P6-T05`, `P6-T09`, `P6-T10`, `P6-T11` |
| `RULE-PAY-11` | `P0-D02`, `P0-D03`, `P0-T12`, `P2-T08`, `P3-T01`, `P3-T02`, `P3-T04`, `P3-T07`, `P5-T07`, `P5-T08`, `P5-T09` |
| `RULE-RELY-01` | `P0-D04`, `P0-T10`, `P3-T09`, `P3-T12`, `P5-T03`, `P5-T13` |
| `RULE-RELY-02` | `P0-D04`, `P3-T12`, `P5-T13` |
| `RULE-RELY-03` | `P0-D04`, `P3-T09`, `P3-T12` |
| `RULE-RELY-04` | `P0-D04`, `P3-T12` |
| `RULE-RELY-05` | `P0-D04`, `P3-T12`, `P5-T13` |
| `RULE-RELY-06` | `P0-D04`, `P2-T01`, `P2-T02`, `P2-T03`, `P2-T04`, `P2-T08`, `P2-T12`, `P2-T14`, `P3-T07`, `P3-T09`, `P3-T12`, `P5-T03`, `P5-T13` |
| `RULE-REQUEST-01` | `P2-T08` |
| `RULE-REQUEST-02` | `P2-T08` |
| `RULE-REQUEST-03` | `P2-T08`, `P2-T09` |
| `RULE-REQUEST-04` | `P2-T08`, `P2-T09` |
| `RULE-REQUEST-05` | `P2-T12`, `P2-T14`, `P2-T15`, `P6-T07` |
| `RULE-REQUEST-06` | `P2-T13`, `P2-T15`, `P3-T06` |
| `RULE-REVIEW-01` | `P0-D08`, `P4-T14`, `P4-T15` |
| `RULE-REVIEW-02` | `P0-D08`, `P0-T10`, `P4-T14`, `P4-T15` |
| `RULE-REVIEW-03` | `P4-T14`, `P4-T15` |
| `RULE-REVIEW-04` | `P1-T12`, `P4-T14`, `P5-T12` |
| `RULE-REVIEW-05` | `P4-T14`, `P5-T12` |
| `RULE-REVIEW-06` | `P0-D08`, `P4-T14`, `P4-T15`, `P5-T07` |
| `RULE-SCHED-01` | `P0-D08`, `P2-T08` |
| `RULE-SCHED-02` | `P0-D08`, `P2-T09`, `P2-T11`, `P2-T15` |
| `RULE-SCHED-03` | `P2-T08` |
| `RULE-SCHED-04` | `P0-D08`, `P2-T05`, `P2-T08`, `P2-T09` |
| `RULE-SERVICE-01` | `P0-D01`, `P1-T10`, `P5-T11` |
| `RULE-SERVICE-02` | `P0-D01`, `P1-T11` |
| `RULE-SERVICE-03` | `P0-D01`, `P1-T10`, `P5-T11` |
| `RULE-SERVICE-04` | `P1-T11` |
| `RULE-SERVICE-05` | `P0-D01`, `P0-T12`, `P1-T10`, `P1-T11`, `P2-T04`, `P2-T08`, `P5-T11` |
| `CFG-AVAIL-EXPIRY-MIN` | `P2-T08`, `P2-T09`, `P2-T15` |
| `CFG-CANCEL-REFUND-PCT` | `P0-D03`, `P2-T08`, `P3-T07`, `P3-T08` |
| `CFG-COMMISSION-PCT` | `P0-D02`, `P2-T08`, `P3-T01`, `P3-T04` |
| `CFG-COMPLETION-RESPONSE-MIN` | `P4-T07`, `P4-T10`, `P4-T11` |
| `CFG-ETA-REFRESH-MIN` | `P0-D06`, `P4-T05`, `P4-T06` |
| `CFG-ETA-STALE-MIN` | `P0-D06`, `P4-T06` |
| `CFG-FINAL-DISPUTE-WINDOW-MIN` | `P4-T10`, `P4-T11` |
| `CFG-INCONVENIENCE-FEE` | `P0-D03`, `P2-T08`, `P3-T07` |
| `CFG-LATE-CANCEL-WINDOW-HOURS` | `P0-D03`, `P2-T08`, `P3-T07`, `P3-T08` |
| `CFG-MISSED-REQUEST-THRESHOLD` | `P0-D04`, `P2-T03` |
| `CFG-NO-ACTION-WARNING-HOURS` | `P4-T11` |
| `CFG-PAYOUT-MIN-CENTS` | `P0-D05`, `P3-T10` |
| `CFG-PAYOUT-SCHEDULE` | `P0-D05`, `P3-T10`, `P3-T11` |
| `CFG-RELIABILITY-COOLDOWN-MIN` | `P0-D04`, `P3-T12` |
| `CFG-RELIABILITY-RESET-DAYS` | `P0-D04`, `P3-T12` |
| `CFG-RELIABILITY-SEARCH-PENALTY` | `P0-D04`, `P2-T04`, `P3-T12` |
| `CFG-RELIABILITY-THRESHOLDS` | `P0-D04`, `P3-T12` |
| `CFG-RELIABILITY-WINDOW-DAYS` | `P0-D04`, `P3-T12`, `P5-T13` |
| `CFG-REVIEW-DEADLINE-DAYS` | `P0-D08`, `P4-T14`, `P4-T15` |
| `CFG-SCHED-EXPIRY-HOURS` | `P2-T08`, `P2-T09`, `P2-T15` |
| `CFG-SCHED-MAX-HORIZON-DAYS` | `P0-D08`, `P2-T05`, `P2-T08`, `P2-T09` |
| `CFG-SCHED-MIN-LEAD-MIN` | `P0-D08`, `P2-T05`, `P2-T08`, `P2-T09` |
| `ENUM-AVAIL-STATUS` | `P0-T06`, `P0-T10`, `P0-T12`, `P2-T01`, `P2-T02`, `P2-T03` |
| `ENUM-BOOKING-STATUS` | `P0-T06`, `P0-T10`, `P0-T12`, `P0-T14`, `P0-T17`, `P2-T12`, `P3-T02`, `P3-T06`, `P3-T07`, `P4-T01`, `P4-T02`, `P4-T03`, `P4-T07`, `P4-T09`, `P4-T11`, `P4-T12`, `P5-T01`, `P5-T04`, `P5-T05` |
| `ENUM-BOOKING-TYPE` | `P0-T06`, `P0-T10`, `P0-T12`, `P2-T05`, `P2-T08` |
| `ENUM-DISPUTE-STATUS` | `P0-D08`, `P0-T06`, `P0-T10`, `P0-T12`, `P0-T17`, `P4-T12`, `P5-T01`, `P5-T06`, `P5-T07` |
| `ENUM-EARNING-STATUS` | `P0-T06`, `P0-T10`, `P0-T12`, `P3-T04`, `P3-T05`, `P3-T10`, `P3-T11`, `P5-T04`, `P5-T07`, `P5-T09`, `P5-T10` |
| `ENUM-PAYMENT-STATUS` | `P0-T06`, `P0-T10`, `P0-T12`, `P0-T17`, `P3-T01`, `P3-T02`, `P3-T03`, `P3-T06`, `P3-T07`, `P5-T01`, `P5-T04`, `P5-T09` |
| `ENUM-PAYOUT-STATUS` | `P0-T06`, `P0-T10`, `P0-T12`, `P3-T10`, `P3-T11`, `P5-T10` |
| `ENUM-RELIABILITY-LEVEL` | `P0-D04`, `P0-T06`, `P0-T10`, `P0-T12`, `P3-T12`, `P5-T03`, `P5-T13` |
| `ENUM-REQUEST-STATUS` | `P0-T06`, `P0-T10`, `P0-T12`, `P2-T08`, `P2-T09`, `P2-T10`, `P2-T11`, `P2-T12`, `P2-T13`, `P2-T14`, `P2-T15` |
| `ENUM-USER-ROLE` | `P0-T06`, `P0-T10`, `P0-T12`, `P1-T03` |
| `ENUM-VERIFICATION-STATUS` | `P0-T06`, `P0-T10`, `P0-T12`, `P1-T03`, `P1-T04`, `P1-T07`, `P1-T08`, `P1-T09`, `P5-T03` |
| `ROLE-ADMIN` | `P0-T11`, `P1-T02`, `P5-T02`, `P5-T03`, `P5-T04`, `P5-T06`, `P5-T09`, `P5-T10` |
| `ROLE-BARBER` | `P0-T11`, `P1-T01`, `P1-T03`, `P2-T10`, `P4-T02`, `P4-T03` |
| `ROLE-CLIENT` | `P0-T11`, `P1-T01`, `P1-T03`, `P1-T05` |

---

## 9. Reverse Dependency Index

**Generated by `scripts/jira/generate-indexes.mjs`. Do not hand-maintain.**

The inverse of every `dependsOn` and `affects` edge. Nobody writes reverse edges by hand —
that is what rotted `canRunInParallelWith` in the previous backlog (§3.1).

- **Blocks** — tickets that cannot start until this one closes.
- **Changed by** — tickets that declared this one in their `affects`: if they change, check this.

| Ticket | Blocks | Changed by |
|---|---|---|
| `P0-D01` | `P0-T12`, `P1-T10`, `P1-T11`, `P1-T12`, `P2-T04`, `P2-T08` | — |
| `P0-D02` | `P0-D03`, `P0-D05`, `P2-T08`, `P3-T01`, `P3-T02`, `P3-T04`, `P3-T07`, `P3-T10`, `P5-T07`, `P5-T09` | — |
| `P0-D03` | `P2-T08`, `P3-T04`, `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P5-T07`, `P5-T08` | `P0-D02` |
| `P0-D04` | `P2-T01`, `P2-T03`, `P2-T04`, `P2-T08`, `P2-T12`, `P3-T07`, `P3-T09`, `P3-T12`, `P5-T13` | — |
| `P0-D05` | `P0-T18`, `P1-T07`, `P3-T03`, `P3-T05`, `P3-T10`, `P3-T11`, `P5-T10`, `P6-T02` | — |
| `P0-D06` | `P1-T06`, `P2-T01`, `P2-T04`, `P2-T07`, `P4-T05`, `P4-T06` | — |
| `P0-D07` | `P2-T03`, `P2-T15`, `P3-T11`, `P3-T12`, `P4-T05`, `P4-T11`, `P6-T02` | — |
| `P0-D08` | `P2-T05`, `P2-T08`, `P2-T09`, `P4-T14`, `P4-T15`, `P5-T07` | — |
| `P0-T01` | `P0-T02`, `P0-T03`, `P0-T05`, `P0-T06`, `P0-T09`, `P0-T13`, `P0-T16` | — |
| `P0-T02` | `P0-T04` | `P0-T01` |
| `P0-T03` | `P0-T04`, `P0-T09`, `P0-T18`, `P1-T07`, `P6-T03`, `P6-T04`, `P6-T09` | — |
| `P0-T04` | `P6-T08` | `P0-T01`, `P0-T02`, `P0-T03` |
| `P0-T05` | — | `P0-T02`, `P0-T04` |
| `P0-T06` | `P0-T07`, `P0-T10`, `P0-T14`, `P0-T17`, `P2-T01`, `P4-T07` | `P0-D08`, `P0-T01` |
| `P0-T07` | `P0-T08`, `P0-T15`, `P1-T03`, `P2-T08`, `P2-T12`, `P4-T07`, `P4-T09` | `P0-T06` |
| `P0-T08` | — | `P0-T07` |
| `P0-T09` | `P0-T10`, `P6-T05`, `P6-T09` | `P0-T03` |
| `P0-T10` | `P0-T11`, `P0-T12`, `P1-T03`, `P1-T10`, `P2-T01`, `P2-T08`, `P3-T04`, `P3-T12`, `P4-T12`, `P4-T14` | `P0-D08`, `P0-T06`, `P0-T09` |
| `P0-T11` | `P0-T12`, `P1-T01`, `P1-T02`, `P1-T03`, `P1-T10`, `P2-T10` | `P0-T09`, `P0-T10` |
| `P0-T12` | `P5-T01` | `P0-D01`, `P0-T09`, `P0-T10`, `P0-T11` |
| `P0-T13` | `P0-T14`, `P0-T15`, `P1-T01`, `P6-T01`, `P6-T03`, `P6-T04`, `P6-T10` | `P0-T01` |
| `P0-T14` | `P1-T01`, `P1-T04`, `P1-T06`, `P2-T02`, `P2-T09`, `P2-T11`, `P3-T05`, `P3-T08`, `P3-T09`, `P4-T01`, `P4-T02`, `P4-T08`, `P4-T10`, `P4-T13`, `P4-T15` | `P0-T06`, `P0-T13` |
| `P0-T15` | `P1-T01`, `P2-T05`, `P2-T06`, `P4-T01`, `P4-T06` | `P0-T13` |
| `P0-T16` | `P0-T17`, `P1-T02`, `P6-T03`, `P6-T04` | `P0-T01` |
| `P0-T17` | `P5-T01`, `P5-T02`, `P5-T03`, `P5-T04`, `P5-T06`, `P5-T08`, `P5-T09`, `P5-T10`, `P5-T11`, `P5-T12` | `P0-T06`, `P0-T12`, `P0-T16` |
| `P0-T18` | `P1-T05`, `P1-T07`, `P1-T09`, `P3-T01`, `P3-T03`, `P3-T11`, `P4-T05`, `P6-T09`, `P6-T11` | `P0-D05`, `P0-D08`, `P0-T03` |
| `P0-T19` | `P0-T01` | — |
| `P1-T01` | `P1-T03`, `P6-T01` | `P0-T11`, `P0-T13` |
| `P1-T02` | `P5-T01`, `P5-T02`, `P5-T03`, `P5-T04`, `P5-T06`, `P5-T09`, `P5-T11`, `P5-T12`, `P5-T13` | `P0-T11`, `P0-T16` |
| `P1-T03` | `P1-T04`, `P1-T06`, `P1-T07` | `P0-T06`, `P0-T07`, `P0-T10`, `P0-T11`, `P1-T01` |
| `P1-T04` | `P1-T05`, `P2-T08`, `P5-T02` | `P0-T14`, `P1-T01`, `P1-T03` |
| `P1-T05` | `P2-T05`, `P2-T08`, `P4-T03`, `P5-T02` | `P1-T04` |
| `P1-T06` | `P1-T08`, `P1-T11`, `P2-T01` | `P0-D06`, `P0-T14`, `P1-T01`, `P1-T03` |
| `P1-T07` | `P1-T08`, `P1-T09`, `P3-T11` | `P0-D05`, `P0-T03`, `P0-T18` |
| `P1-T08` | `P3-T05` | `P1-T07` |
| `P1-T09` | `P2-T04`, `P3-T03`, `P5-T03` | `P0-T18`, `P1-T07` |
| `P1-T10` | `P1-T11`, `P1-T12`, `P5-T11` | `P0-D01` |
| `P1-T11` | `P1-T12`, `P2-T04`, `P2-T08`, `P5-T03` | `P0-D01`, `P1-T06`, `P1-T08`, `P1-T10` |
| `P1-T12` | `P2-T06`, `P2-T09`, `P4-T15` | `P0-D01`, `P1-T06`, `P1-T10`, `P1-T11` |
| `P2-T01` | `P2-T02`, `P2-T03`, `P2-T04`, `P2-T08`, `P2-T12`, `P3-T12` | `P0-D04`, `P0-D06`, `P0-T06`, `P0-T10`, `P1-T06`, `P3-T12` |
| `P2-T02` | `P2-T11`, `P3-T12` | `P0-D04`, `P2-T01`, `P2-T03`, `P3-T12` |
| `P2-T03` | `P2-T12`, `P2-T15` | `P0-D04`, `P0-D07`, `P2-T01` |
| `P2-T04` | `P2-T05`, `P2-T06`, `P2-T07`, `P3-T12` | `P0-D01`, `P0-D04`, `P0-D06`, `P0-T18`, `P1-T06`, `P1-T09`, `P1-T10`, `P1-T11`, `P2-T01`, `P3-T12` |
| `P2-T05` | `P2-T06`, `P2-T07`, `P2-T09` | `P0-D08`, `P0-T14`, `P0-T15`, `P1-T05`, `P2-T04` |
| `P2-T06` | — | `P0-D06`, `P0-T15`, `P1-T12`, `P2-T04`, `P2-T05` |
| `P2-T07` | — | `P0-D06`, `P2-T04`, `P2-T05` |
| `P2-T08` | `P2-T09`, `P2-T10`, `P2-T12`, `P2-T13`, `P2-T15`, `P3-T01`, `P3-T06`, `P6-T02` | `P0-D01`, `P0-D02`, `P0-D03`, `P0-D04`, `P0-D08`, `P0-T06`, `P0-T07`, `P0-T10`, `P1-T04`, `P1-T05`, `P1-T11`, `P2-T01`, `P3-T12` |
| `P2-T09` | `P3-T06`, `P3-T08`, `P4-T01` | `P0-D03`, `P0-D08`, `P0-T14`, `P0-T15`, `P1-T12`, `P2-T04`, `P2-T05`, `P2-T06`, `P2-T08` |
| `P2-T10` | `P2-T11`, `P2-T12`, `P2-T13` | `P0-T11`, `P2-T08` |
| `P2-T11` | `P2-T14` | `P0-T14`, `P2-T02`, `P2-T10` |
| `P2-T12` | `P2-T14`, `P3-T02`, `P3-T06`, `P4-T02`, `P6-T02`, `P6-T07` | `P0-D04`, `P0-T07`, `P2-T01`, `P2-T03`, `P2-T08`, `P2-T10`, `P3-T12` |
| `P2-T13` | `P2-T14`, `P3-T06` | `P2-T08`, `P2-T10` |
| `P2-T14` | `P4-T02` | `P0-D04`, `P2-T11`, `P2-T12`, `P2-T13`, `P3-T12` |
| `P2-T15` | `P3-T06`, `P4-T01` | `P0-D07`, `P2-T08`, `P2-T13` |
| `P3-T01` | `P3-T02`, `P3-T03`, `P3-T06` | `P0-D02`, `P0-T06`, `P0-T07`, `P0-T10`, `P0-T18`, `P2-T08` |
| `P3-T02` | `P3-T04`, `P3-T06`, `P3-T07`, `P5-T04`, `P6-T07` | `P0-D02`, `P2-T12`, `P3-T01` |
| `P3-T03` | `P3-T04`, `P3-T07`, `P3-T11`, `P5-T09` | `P0-D05`, `P0-T18`, `P1-T09`, `P3-T01` |
| `P3-T04` | `P3-T05`, `P3-T07`, `P3-T10`, `P4-T07`, `P4-T09`, `P4-T11`, `P4-T12`, `P5-T09` | `P0-D02`, `P0-D03`, `P0-T06`, `P0-T10`, `P3-T02`, `P3-T03` |
| `P3-T05` | — | `P0-D03`, `P0-D05`, `P0-T14`, `P1-T08`, `P3-T04`, `P3-T11` |
| `P3-T06` | `P3-T07`, `P4-T01`, `P4-T02`, `P5-T04`, `P6-T02` | `P2-T08`, `P2-T12`, `P2-T13`, `P2-T15`, `P3-T01`, `P3-T02` |
| `P3-T07` | `P3-T08`, `P3-T09`, `P3-T10`, `P3-T12`, `P5-T07`, `P6-T06`, `P6-T07` | `P0-D02`, `P0-D03`, `P0-D04`, `P3-T01`, `P3-T03`, `P3-T04` |
| `P3-T08` | — | `P0-D03`, `P2-T09`, `P3-T07` |
| `P3-T09` | — | `P0-D03`, `P0-D04`, `P3-T07`, `P3-T12` |
| `P3-T10` | `P3-T11`, `P5-T10` | `P0-D02`, `P0-D03`, `P0-D05`, `P3-T04` |
| `P3-T11` | `P3-T05`, `P5-T10`, `P6-T02`, `P6-T07` | `P0-D05`, `P0-D07`, `P0-T18`, `P1-T07`, `P1-T09`, `P3-T03`, `P3-T10` |
| `P3-T12` | `P3-T09`, `P5-T03`, `P5-T13` | `P0-D04`, `P0-D07`, `P2-T01`, `P2-T03`, `P3-T07` |
| `P4-T01` | `P4-T06`, `P4-T10`, `P4-T15`, `P5-T04` | `P0-T11`, `P0-T14`, `P0-T15`, `P2-T08`, `P2-T09`, `P2-T12`, `P2-T15`, `P3-T06` |
| `P4-T02` | `P4-T03`, `P4-T04`, `P4-T07`, `P4-T08`, `P5-T04` | `P0-T11`, `P2-T12`, `P2-T14`, `P3-T06` |
| `P4-T03` | `P4-T04`, `P4-T05` | `P1-T05`, `P4-T02` |
| `P4-T04` | — | `P4-T02`, `P4-T03` |
| `P4-T05` | `P4-T06` | `P0-D06`, `P0-D07`, `P0-T03`, `P0-T18`, `P4-T03` |
| `P4-T06` | — | `P0-D06`, `P0-T15`, `P4-T01`, `P4-T03`, `P4-T05` |
| `P4-T07` | `P4-T08`, `P4-T09`, `P4-T11` | `P0-T06`, `P0-T07` |
| `P4-T08` | — | `P4-T02`, `P4-T07` |
| `P4-T09` | `P4-T10`, `P4-T11`, `P4-T12`, `P4-T14` | `P0-T07`, `P3-T04`, `P4-T07` |
| `P4-T10` | `P4-T13` | `P0-T14`, `P4-T01`, `P4-T09` |
| `P4-T11` | `P5-T04`, `P5-T05`, `P6-T02`, `P6-T06`, `P6-T07` | `P0-D07`, `P3-T04`, `P4-T07`, `P4-T09` |
| `P4-T12` | `P4-T13`, `P5-T06`, `P5-T07` | `P0-T10`, `P4-T09` |
| `P4-T13` | — | `P4-T10`, `P4-T12` |
| `P4-T14` | `P4-T15`, `P5-T12` | `P0-D08`, `P0-T07`, `P0-T10`, `P4-T09` |
| `P4-T15` | — | `P0-D08`, `P1-T12`, `P4-T01`, `P4-T14` |
| `P5-T01` | — | `P0-T12`, `P0-T16`, `P0-T17`, `P1-T02` |
| `P5-T02` | — | `P0-T11`, `P0-T17`, `P1-T02`, `P1-T03`, `P1-T04`, `P1-T05` |
| `P5-T03` | `P5-T13` | `P0-D04`, `P0-T17`, `P1-T02`, `P1-T03`, `P1-T06`, `P1-T07`, `P1-T09`, `P1-T11`, `P3-T12` |
| `P5-T04` | `P5-T05`, `P6-T08` | `P0-T12`, `P0-T17`, `P1-T02`, `P3-T02`, `P3-T06`, `P4-T11` |
| `P5-T05` | — | `P5-T04` |
| `P5-T06` | `P5-T07`, `P5-T08`, `P6-T08` | `P0-T17`, `P1-T02`, `P4-T12` |
| `P5-T07` | `P5-T08`, `P6-T06`, `P6-T07` | `P0-D02`, `P0-D03`, `P0-D08`, `P3-T07`, `P4-T12` |
| `P5-T08` | `P6-T08` | `P0-D03`, `P5-T06`, `P5-T07` |
| `P5-T09` | `P5-T10` | `P0-D02`, `P0-D03`, `P0-T17`, `P1-T02`, `P3-T02`, `P3-T03`, `P3-T04`, `P3-T07` |
| `P5-T10` | — | `P0-D05`, `P3-T10`, `P3-T11`, `P5-T09` |
| `P5-T11` | — | `P0-D01`, `P0-T17`, `P1-T02`, `P1-T10` |
| `P5-T12` | — | `P0-T17`, `P1-T02`, `P4-T14` |
| `P5-T13` | — | `P0-D04`, `P1-T02`, `P3-T12`, `P5-T03` |
| `P6-T01` | `P6-T02` | `P0-T13`, `P1-T01` |
| `P6-T02` | — | `P0-D05`, `P0-D07`, `P3-T11`, `P6-T01` |
| `P6-T03` | — | `P0-T03` |
| `P6-T04` | — | `P0-T03` |
| `P6-T05` | `P6-T07` | — |
| `P6-T06` | `P6-T11` | `P0-D03` |
| `P6-T07` | `P6-T11` | `P0-D03`, `P6-T05` |
| `P6-T08` | — | `P0-T04` |
| `P6-T09` | `P6-T10`, `P6-T11` | `P0-T03`, `P0-T18` |
| `P6-T10` | `P6-T11` | `P0-T13`, `P6-T09` |
| `P6-T11` | `P7-T01` | `P6-T06`, `P6-T09`, `P6-T10` |
| `P7-T01` | `P7-T02` | — |
| `P7-T02` | — | `P7-T01` |

**Blocks nothing and is changed by nothing** (0): —. These are safe to defer.
