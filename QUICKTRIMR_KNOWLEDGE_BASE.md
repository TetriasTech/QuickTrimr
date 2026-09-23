# QuickTrimr Knowledge Base

> **The three files work together:**
>
> | File | Role |
> |---|---|
> | `QUICKTRIMR_KNOWLEDGE_BASE.md` | **This file. Upstream source of truth** — product rules, architecture decisions, open decisions, workflow. |
> | `QUICKTRIMR_BACKLOG_README.md` | The tickets that implement what is written here. Source of truth for tickets; Jira is a projection of it. |
> | `QUICKTRIMR_TICKET_PROMPT.md` | The prompt used to hand a ticket to an AI agent. Enforces the §1.3 sync contract at the point of work. |
>
> To implement a ticket, do not paste it at an agent. Paste `QUICKTRIMR_TICKET_PROMPT.md` and name the ticket id.

---

## 1. How to Use This File

### 1.1 For implementation agents

This document is the product and engineering source of truth for QuickTrimr.

1. Read this knowledge base first, then read `QUICKTRIMR_BACKLOG_README.md`.
2. Do not invent product behaviour. If a rule is not written here, it is not decided.
3. Do not implement anything marked future scope (§16) or unresolved (§14).
4. Prefer shared types, shared validation, shared business rules, and shared UI primitives.
5. Sensitive marketplace logic is server-side, never frontend-controlled (`ADR-001`).
6. If a decision is genuinely unclear, stop and raise it as a new `TBC-*` entry in §14. Do not guess and do not leave a silent TODO.

Conflict priority, highest first:

1. User-confirmed decisions in this file.
2. `QUICKTRIMR_BACKLOG_README.md`.
3. The accepted QuickTrimr proposal.
4. Implementation assumptions.

### 1.2 Stable IDs — how this file is referenced

Every rule a ticket can depend on has a **stable ID**. Backlog tickets cite these IDs, never section numbers, so this file can be reordered or renumbered without breaking a single ticket.

| Prefix | Meaning | Example |
|---|---|---|
| `ADR-*` | Architecture decision | `ADR-006` |
| `RULE-*` | Product rule | `RULE-AVAIL-04` |
| `CFG-*` | Configurable value | `CFG-COMMISSION-PCT` |
| `ENUM-*` | Status set | `ENUM-BOOKING-STATUS` |
| `ROLE-*` | Role and permissions | `ROLE-BARBER` |
| `TBC-*` | Unresolved decision | `TBC-COMMISSION-PCT` |

Rules:

- **IDs are permanent.** Never renumber, never reuse. To retire a rule, mark it `SUPERSEDED BY <id>` and leave it in place.
- **Never delete a `TBC-*`.** When it is decided, convert it in place to a `RULE-*` or `CFG-*` and leave a `RESOLVED → <id>` pointer behind, so tickets citing the old ID still lead somewhere.
- Tickets cite IDs in their `knowledgeBase:` field. The traceability table at the bottom of the backlog is **generated** from those citations — do not maintain a ticket list inside this file.

### 1.3 The sync contract

This file and the backlog must never disagree. Three rules keep them honest:

1. **This file is upstream.** A ticket implements a rule; a ticket never invents one. If a ticket needs a rule that does not exist here, the rule is added here first, in the same pull request.
2. **Changing a rule here means revisiting its tickets.** Find them in the backlog's traceability table, under the ID you changed. Every one of them is either still correct or needs a follow-up ticket. Record which, in the pull request.
3. **The backlog file is the source of truth for tickets. Jira is a projection.** Jira issues are created from the backlog and linked back by `jiraKey`. If a Jira issue and the backlog disagree, the backlog wins and Jira is corrected — never the reverse.

---

## 2. Product Identity

**Product name:** QuickTrimr
**Delivery team:** Tetrias Tech
**Engineers:** Tony and Andrew
**Product type:** Two-sided barber marketplace, mobile-first.

QuickTrimr connects clients who need a haircut with barbers who travel to them. A client either requests a barber **immediately** (Available Now) or **for a future time** (Scheduled). The barber accepts or declines.

**Previous proposal name: QuikTrim.** Do not use `QuikTrim` in code, comments, documentation, tickets, UI text, branch names, folders, or Jira issues, except when explicitly referring to legacy proposal context.

The team deliberately undercharged commercially. That is a commercial decision and it does not lower the engineering standard: this is real money, real home addresses, and a stranger arriving at a client's door.

---

## 3. Product Components

QuickTrimr has three deliverables.

### 3.1 Mobile app

One Expo React Native app carrying both journeys, role-switched: client signup, addresses, discovery, Available Now and Scheduled requests, payment, booking views, ETA, completion, disputes, reviews — and barber onboarding, Stripe Connect, service and pricing setup, Available Now sessions, request inbox, accept/decline, on-my-way, completion, earnings.

### 3.2 Admin dashboard

Web-only Next.js operations dashboard covering clients, barbers, verification and Stripe Connect status, service categories, booking requests, bookings, payments, earnings, payout batches, refunds, disputes, reliability state and events, reviews, audit logs, and platform analytics.

Admin is web-only. There is no admin surface in the mobile app.

### 3.3 Wix marketing website

Final-stage marketing and credibility site only.

Wix must not power authentication, bookings, payments, admin, booking lifecycle, or any marketplace logic.

---

## 4. Technology Stack

| Area | Technology |
|---|---|
| Mobile app | Expo React Native + TypeScript |
| Mobile routing | Expo Router |
| Server state | TanStack Query |
| Local UI state | Zustand |
| Forms | React Hook Form |
| Validation | Zod |
| Admin dashboard | Next.js + TypeScript |
| Admin UI | Tailwind CSS + shadcn/ui |
| Admin tables | TanStack Table |
| Repo | TypeScript monorepo |
| Database | Supabase Postgres |
| Geo / location search | PostGIS |
| Auth | Supabase Auth |
| Access control | Supabase RLS |
| Backend/API runtime | Supabase Edge Functions |
| Storage | Supabase Storage |
| Payments | Stripe Payments |
| Marketplace payouts | Stripe Connect |
| Barber identity | Stripe Connect hosted onboarding |
| Client identity | Not at launch; architecture Stripe Identity-ready (`ADR-005`) |
| Push | Expo Notifications |
| Maps | Google Maps SDK |
| Address search | Google Places API |
| ETA | Google Routes API |
| Workflows / timers | `TBC-WORKFLOW-ENGINE` (`ADR-011`) |
| Mobile builds | Expo EAS |
| Admin hosting | Vercel |
| Marketing | Wix |
| Analytics / flags | PostHog |
| Monitoring | Sentry |
| CI/CD | GitHub Actions |

---

## 5. Architecture Decisions

### ADR-001 — Supabase is infrastructure, not casual frontend CRUD

Supabase Postgres, Auth, Storage, RLS, PostGIS and Edge Functions are the backend. A separate custom backend is not required at launch.

**The constraint that matters:** Supabase must not be used as a frontend-controlled CRUD backend. Every sensitive marketplace action goes through an Edge Function that validates auth, role and input server-side.

Sensitive actions: booking request creation, acceptance, decline, expiry, cancellation, payment authorisation, capture, refund, payout release, completion, disputes, admin overrides, reliability consequences, ETA calculation, and Stripe webhooks.

RLS is the access model. A table without RLS is a bug, not an oversight.

### ADR-002 — Edge Functions are thin controllers

Edge Functions are the API layer for launch. They authenticate, authorise, validate with Zod, delegate to a service, and shape the response. They are not the place business rules live.

They must be structured like a real backend, not one-file scripts:

```txt
supabase/functions/
  create-booking-request/index.ts
  accept-booking-request/index.ts
  stripe-webhook/index.ts
  update-eta/index.ts
  _shared/
    auth/  errors/  logging/  responses/  validation/  services/
```

Structuring them this way is what makes a later extraction into a dedicated backend possible without a rewrite.

### ADR-003 — No Redux

State is split by kind, and the split is not negotiable per-feature:

| State | Tool |
|---|---|
| Server data | TanStack Query |
| Temporary local UI/app state | Zustand |
| Form state | React Hook Form |
| Validation | Zod |

Server data is never mirrored into Zustand. Payment state, booking status and verification status are server truth and are read through TanStack Query only.

Redux is not banned forever, but introducing it requires a decision recorded here first.

### ADR-004 — No Uber-style live tracking

QuickTrimr does not implement continuous live tracking. It costs more, drains battery, complicates permissions, and creates a privacy surface the product does not need.

**Replacement:** controlled ETA updates that begin only when the barber taps "I'm on my way" and stop when the booking is no longer active (`RULE-ETA-*`).

The UI must not imply live tracking it does not do.

### ADR-005 — Client Stripe Identity is not required at launch

Clients can sign up, browse, request, and pay without identity document verification. The friction is not worth it at launch.

**Implementation requirement:** the profile model carries verification-ready fields and a `verification_status` from day one (`ENUM-VERIFICATION-STATUS`), so enabling Stripe Identity later is a flow change, not a schema migration.

Barbers are different: Stripe Connect onboarding is required before they can be paid (`RULE-ONBOARD-04`).

### ADR-006 — Authorise at request, capture on acceptance

When a client submits a request, the payment is **authorised** with a manual-capture PaymentIntent. When the barber accepts, it is **captured**.

The client must not have to come back and pay after acceptance, and the barber must not accept a job only to find the payment fails.

```txt
Client submits request   → payment authorised / held
Barber accepts           → payment captured, booking confirmed
Booking completes        → barber earning moves pending → available
Payout run               → money moves to the barber's bank
```

`ADR-006` is why authorisation expiry matters: a Scheduled request may sit pending for up to `CFG-SCHED-EXPIRY-HOURS`, and a Scheduled booking may sit confirmed for days before the appointment. Authorisation lifetime is a real constraint on `RULE-SCHED-*`.

### ADR-007 — Monorepo with shared contracts

One TypeScript monorepo. Shared types in `packages/shared`, shared Zod schemas in `packages/validation`, shared UI primitives in `packages/ui` (§7).

A constant, status string, or validation shape that exists in two of mobile / admin / functions is a defect. The shared package is what lets two engineers work in parallel without agreeing verbally on a payload shape.

### ADR-008 — Location filtering is PostGIS, server-side

Barber discovery filters by geography **in the database**, using PostGIS. Never fetch a set of barbers and filter by distance on the device.

Google Routes and Places are called **from Edge Functions only**. Server API keys never reach the mobile bundle.

### ADR-009 — Money is integer cents, snapshotted per booking

All monetary values are integer cents. A float in a money path is a defect, not a rounding preference.

Every booking stores its own snapshot of:

- the service price at request time,
- the commission percentage at request time (`CFG-COMMISSION-PCT`),
- the resulting gross, commission, and barber net.

A barber changing their prices, or an admin changing the commission, must never alter an existing booking's financial record. The snapshot is what makes that true.

### ADR-010 — Statuses are backend-controlled and written to history

Booking status is set by backend logic only. A mobile app or admin frontend never writes a status directly.

Every transition writes a row to `booking_status_history` with the actor, the previous status, the new status, and the reason. That table, plus `audit_logs` (`ADR-013`), is how a payment dispute gets reconstructed six weeks later.

Illegal transitions are rejected server-side, not merely hidden in the UI.

### ADR-011 — A workflow engine is required

QuickTrimr's core rules are timers, and there are a lot of them: a 5-minute Available Now expiry, a 2-hour Scheduled expiry, a 1-hour client completion window, a 6-hour no-action warning, a further 1-hour dispute window, throttled ETA refreshes, and a batched payout run.

**No client-side timers, ever.** A device that is backgrounded, offline, or uninstalled must not be able to prevent a request expiring or an earning releasing.

Scheduled work must:

- re-check state at execution time — the schedule is a hint, the database is the truth;
- be idempotent, because it will fire twice;
- have a reconciliation path that catches a dropped schedule.

Which engine runs it is `TBC-WORKFLOW-ENGINE`, resolved by `P0-D07`.

### ADR-012 — Vertical feature ownership

Each ticket has exactly one named owner who delivers it end to end: migration → RLS → Edge Function → mobile/admin UI → tests.

There is no "backend person" to hand off to, no "Shared" owner, and no separate integration ticket to defer the hard part into. A ticket is done when the feature works in the running app.

This replaces the previous backlog's stream model (`Owner stream: Shared`), which produced tickets nobody owned and integration nobody scheduled.

### ADR-013 — Audit logs for sensitive actions, append-only

Every sensitive action writes an audit log: booking status changes, payment state changes, refunds, dispute creation and resolution, admin actions, barber verification and Stripe Connect status changes, reliability consequences, payout status changes, manual overrides, and service category changes.

An audit row records actor id, actor role, action, entity type, entity id, previous value, new value, reason where required, timestamp, and safe metadata.

**Audit logs are append-only.** A correction is a new row. Never a card number, never a secret, never a raw Stripe payload.

### ADR-014 — QuickTrimr is the product and repository identity

The customer-facing product name is **QuickTrimr**. The GitHub repository is
`TetriasTech/QuickTrimr`, the monorepo package scope is `@quicktrimr/*`, and new project labels use
`quicktrimr`.

The existing Jira project key remains `TRIMR`, and existing issue keys such as `TRIMR-21` remain
unchanged. Those are stable external identifiers, not customer-facing branding. The Jira project
display name, epic summaries, issue content, and labels use QuickTrimr. Existing issues are updated
in place; they are never deleted or duplicated to obtain new keys.

---

## 6. Team and Workflow

QuickTrimr is built by **Tony and Andrew** in one monorepo.

### 6.1 Feature ownership

Ownership is vertical (`ADR-012`). One named owner per ticket.

**Tony — money and trust.** Stripe payments, webhooks, capture, refunds, earnings, payout batches, cancellations, disputes, reliability, the workflow engine, schema and RLS foundations, admin dashboard, roles and access control, audit logging.

**Andrew — the marketplace.** Auth, profiles, addresses, client and barber onboarding, service catalogue and pricing, Available Now sessions, discovery and search, booking requests, request inbox, accept/decline surfaces, booking and job views, ETA display, completion flows, reviews, notifications, analytics, mobile shell and shared UI, Wix.

### 6.2 Shared foundations

Shared constants, enums, Zod schemas and UI primitives are built **first**, in Phase 0, because both engineers build against them. They still have one owner each; they are just sequenced early.

### 6.3 Anti-blocking rules

- Define the shared contract before the code that consumes it.
- Every API contract has a worked request and response example. That example is what unblocks the other engineer.
- Mobile screens run against mock data while a function is being built.
- Admin pages run against seed data.
- Migrations ship with the feature that needs them, not in a big-bang schema ticket.
- Avoid both engineers editing the same large file.

### 6.4 Definition of ready

A ticket may not start until:

- It has exactly one named owner — `Tony` or `Andrew`.
- Every ticket in `dependsOn:` is closed.
- Every ID in `blockedByTbc:` is resolved in §14.
- Every ID in `knowledgeBase:` exists in this file, **including reserved rules** (§9's *Pending rules* table).
- Contract examples exist for anything with an API.
- Every acceptance criterion is individually checkable.

---

## 7. Monorepo Structure

```txt
quicktrimr/
  apps/
    mobile/            Expo app — client and barber journeys
      app/             Expo Router routes
      src/features/ src/components/ src/hooks/ src/lib/ src/stores/ src/theme/
    admin/             Next.js admin dashboard
      app/
      src/features/ src/components/ src/lib/ src/hooks/
  packages/
    shared/            types, constants, enums  — no I/O
    domain/            pure business rules       — no I/O, unit-testable
    validation/        Zod schemas
    ui/                shared primitives
  supabase/
    functions/
      _shared/ auth/ errors/ logging/ responses/ validation/ services/
    migrations/
    seed/
  scripts/
    jira/  db/  stripe/
  docs/
    architecture/ decisions/ api/ qa/
```

Rules:

- Shared TypeScript types live in `packages/shared`.
- **Business rules live in `packages/domain`, pure, with no I/O.** Refund calculation, commission split, reliability level transitions, expiry arithmetic, and cancellation windows belong there. If a rule cannot be unit-tested without a network, it is in the wrong place.
- Shared Zod schemas live in `packages/validation` and are imported by mobile, admin, and functions — one schema, three consumers.
- Shared UI primitives live in `packages/ui`. Feature-specific UI composes them.
- Edge Functions reuse the shared auth, validation, error, logging and response helpers.
- All schema changes are migrations. No dashboard edits to a deployed database.
- No secrets in source control — not in code, markdown, seed files, fixtures, or tests.

---

## 8. Roles and Permissions

Roles: `client`, `barber`, `admin` (`ENUM-USER-ROLE`).

The role comes from the verified JWT and the server's own lookup. **Never from the request body.**

### ROLE-CLIENT

Can: sign up and log in; complete a profile; manage service addresses; browse and filter barbers; send Available Now and Scheduled requests; pay; cancel under `RULE-CANCEL-*`; confirm completion; open a dispute; review a completed booking.

Cannot: reach the admin dashboard; see another client's data; see a barber's private data; set or change an amount, a commission, a status, or a payout; release funds.

### ROLE-BARBER

Can: sign up and log in; complete a profile and upload a photo; set service area and radius; select offered services and set own prices; complete Stripe Connect onboarding; run an Available Now session; receive multiple requests; accept or decline; view own bookings; mark on-the-way, arrived, and complete; view own earnings and reviews.

Cannot: reach the admin dashboard; see unrelated clients or bookings; change commission, refunds, or payouts; accept an expired request; hold more than one active Available Now job (`RULE-AVAIL-05`).

A barber sees a client's exact address and contact details **only for an accepted, active booking**, and only for as long as it is active.

### ROLE-ADMIN

Can: view and manage clients and barbers; view bookings, payments, earnings, payouts, refunds, disputes, reliability state and reviews; manage service categories; resolve disputes; issue refunds; override a booking status where operationally required; manage barber reliability state; view analytics.

Every admin action is server-side authorised and audit logged (`ADR-013`). Hiding an admin route in the frontend is not access control — denial is verified at the API.

---

## 9. Product Rules

### Onboarding

- `RULE-ONBOARD-01` — Every authenticated user has exactly one `profiles` row, created or synced server-side from the verified JWT. Client- and barber-specific data lives in `client_profiles` / `barber_profiles`.
- `RULE-ONBOARD-02` — Client onboarding at launch collects profile basics and at least one service address. No identity document verification (`ADR-005`).
- `RULE-ONBOARD-03` — Barber onboarding collects profile, photo, service area and travel radius, offered services and prices, and Stripe Connect.
- `RULE-ONBOARD-04` — **A barber cannot receive a paid booking until their Stripe Connect account satisfies charges-enabled and payouts-enabled requirements.** Discovery excludes them. This is enforced server-side in search and at request creation, not by hiding a toggle.
- `RULE-ONBOARD-05` — Barber public profile fields and private fields are separated. Discovery and the client-facing profile return public fields only.

### Service catalogue and pricing

- `RULE-SERVICE-01` — Service categories are global and admin-managed. They are data, not code: created, updated, archived, and display-ordered from the admin dashboard.
- `RULE-SERVICE-02` — A barber selects which global categories they offer and sets their own price per category. Prices are per-barber; there is no platform price.
- `RULE-SERVICE-03` — A category is **archived, never deleted.** Bookings reference it historically.
- `RULE-SERVICE-04` — A barber updating a price never changes an existing booking. The booking's price snapshot governs (`ADR-009`).
- `RULE-SERVICE-05` — QuickTrimr launches with the five service categories below. Price bounds are
  inclusive, expressed in integer AUD cents, and enforced server-side. No category is mandatory or
  preselected; a barber chooses the categories they offer, but must have at least one active,
  priced category to be discoverable. Each price is the barber's single category price within
  their configured service area. Distance, day-of-week and after-hours surcharges, and dynamic
  pricing are not supported at launch.

| Display order | Stable slug | Display name | Minimum price | Maximum price |
|---:|---|---|---:|---:|
| 1 | `haircut` | Haircut | 2,000 | 15,000 |
| 2 | `skin_fade` | Skin Fade | 2,500 | 17,500 |
| 3 | `beard_trim` | Beard Trim | 1,000 | 10,000 |
| 4 | `haircut_beard` | Haircut + Beard | 3,000 | 20,000 |
| 5 | `skin_fade_beard` | Skin Fade + Beard | 3,500 | 22,500 |

### Discovery

- `RULE-DISCOVERY-01` — Discovery filters server-side by service category, booking type, geography and barber eligibility, using PostGIS (`ADR-008`). Results are paginated or bounded.
- `RULE-DISCOVERY-02` — **Available Now** discovery is distance from the barber's *current session location*, within the session radius, for sessions that are `active` and not expired.
- `RULE-DISCOVERY-03` — **Scheduled** discovery is against the barber's configured *service area and radius*, not a live GPS position.
- `RULE-DISCOVERY-04` — Discovery returns public barber data only. A client learns a barber's approximate area, never their home address.
- `RULE-DISCOVERY-05` — A client never receives a barber's exact coordinate or exact distance.
  Before acceptance, discovery returns only the server-derived approximate area and one of four
  distance bands: `under-2km` for distances below 2 km, `2-5km` for distances from 2 km up to but
  not including 5 km, `5-10km` for distances from 5 km up to but not including 10 km, and `10km+`
  for distances of 10 km or more. Exact distance may be used server-side for filtering and ordering
  but is never returned. The approximate area is the matching Australian Bureau of Statistics
  Suburb or Locality (SAL), resolved server-side from the relevant point under `RULE-DISCOVERY-02`
  or `RULE-DISCOVERY-03`; its public label and representative map point come from the licensed SAL
  boundary data, never from averaging barber positions. The source and dataset vintage are recorded.
  The client map renders one shared cluster per approximate area at that representative point, not
  an individual barber marker. Selecting a cluster opens the matching barber results. Jitter is not
  used. Acceptance does not increase coordinate precision for the client: after the booking's barber
  taps "I'm on my way", the server may use that barber's exact current location solely to calculate
  the route, while the booked client receives only the ETA and its last-updated time. The origin,
  route polyline and barber coordinates are not returned, and every other user remains limited to
  the pre-acceptance projection. The first ETA is calculated immediately, subsequent refreshes use
  the fixed `CFG-ETA-REFRESH-MIN` interval rather than distance scaling, and the display becomes
  stale when its age reaches `CFG-ETA-STALE-MIN`.

### Available Now

- `RULE-AVAIL-01` — A barber has at most **one** active Available Now session. Starting one closes any other.
- `RULE-AVAIL-02` — A session stores location, the source of that location (GPS or manual), radius, available-until time, and status (`ENUM-AVAIL-STATUS`).
- `RULE-AVAIL-03` — A session auto-disables when: the available-until time passes; the barber misses `CFG-MISSED-REQUEST-THRESHOLD` consecutive requests; the barber accepts an Available Now booking; or the barber toggles off.
- `RULE-AVAIL-04` — A client has at most **one** active pending Available Now request at a time, and it goes to one barber. QuickTrimr does not fan a request out to several barbers at once.
- `RULE-AVAIL-05` — A barber may hold **one** accepted, active Available Now job at a time. Accepting a second is rejected server-side, under concurrency.
- `RULE-AVAIL-06` — An Available Now request expires after `CFG-AVAIL-EXPIRY-MIN`. On expiry the payment authorisation is cancelled.
- `RULE-AVAIL-07` — When a barber accepts, their remaining pending Available Now requests are resolved safely — expired or declined — and each client is told.

### Scheduled bookings

- `RULE-SCHED-01` — A client requests a specific future time from a specific barber.
- `RULE-SCHED-02` — A Scheduled request expires after `CFG-SCHED-EXPIRY-HOURS` if the barber does not respond. On expiry the authorisation is cancelled.
- `RULE-SCHED-03` — A client has at most one active pending request for the same booking intent (same barber, same service, same time).
- `RULE-SCHED-04` *(reserved — `P0-D08`)* — The minimum lead time between now and a requested Scheduled appointment, and how far ahead a booking may be made.

### Booking requests

- `RULE-REQUEST-01` — A booking request is created server-side. It validates the client, barber, service, address and booking type, and rejects a barber who is ineligible (`RULE-ONBOARD-04`).
- `RULE-REQUEST-02` — Request creation writes the price snapshot and the commission snapshot (`ADR-009`) before any payment call.
- `RULE-REQUEST-03` — Request creation is protected against double-submit by a deterministic, server-derived key. A double-tap creates one request.
- `RULE-REQUEST-04` — A request cannot be edited after submission. To change anything, cancel and send a new one.
- `RULE-REQUEST-05` — Accepting is **first valid acceptance wins**, decided server-side under real concurrency. A request already accepted, declined, cancelled, or expired cannot be accepted.
- `RULE-REQUEST-06` — Declining or expiring a pending request cancels its payment authorisation.

### Payments

- `RULE-PAY-01` — The amount is calculated server-side from the booking's own price snapshot. A client-supplied amount is ignored, never trusted.
- `RULE-PAY-02` — Payment is authorised at request time with a **manual-capture** PaymentIntent (`ADR-006`).
- `RULE-PAY-03` — Payment is captured when — and only when — a valid acceptance succeeds. A booking becomes confirmed only after the capture succeeds.
- `RULE-PAY-04` — **Capture is idempotent.** A duplicate call charges once. The idempotency key is deterministic and server-derived; a client-supplied key can be varied and defeats the guard.
- `RULE-PAY-05` — A failed capture leaves the booking and request in a defined, recoverable state, and both parties are told. It never leaves a booking confirmed with no money.
- `RULE-PAY-06` — Stripe is the source of truth for payment state: the API response and the verified webhook. **A mobile client reporting success is not evidence.**
- `RULE-PAY-07` — Webhook signatures are verified. Duplicate deliveries produce exactly one effect.
- `RULE-PAY-08` — Money is integer cents (`ADR-009`). Every payment row stores gross, commission, barber net, and refunded amount where applicable.
- `RULE-PAY-09` — Never hold a database lock across a Stripe call.
- `RULE-PAY-10` — Stripe secret keys and webhook secrets are server-only. Stripe identifiers are stored but not exposed to clients or barbers beyond what a surface genuinely needs.

### Barber earnings and payouts

- `RULE-EARN-01` — An earning row is created on successful capture, with status `pending`, using the booking's snapshots. It cannot be duplicated for a booking.
- `RULE-EARN-02` — An earning moves `pending → available` **only** on completion or auto-completion (`RULE-COMPLETE-*`).
- `RULE-EARN-03` — An open dispute holds the earning at `pending`. It does not become available while a dispute is open.
- `RULE-EARN-04` — **"Available" is a QuickTrimr balance, not money in a bank account.** Cash reaches the barber on the payout run. Every barber-facing surface must say this plainly; a barber who believes "available" means "paid" will call about a missing payout.
- `RULE-EARN-05` — Payouts are batched. Available earnings are queued into a payout batch, moving to `queued_for_payout`, then `paid_out` when the batch settles.
- `RULE-EARN-06` — Batch creation and processing are idempotent. An earning is never in two open batches and is never paid twice.
- `RULE-EARN-07` *(reserved — `P0-D05`)* — The payout schedule and batch cadence.

### Cancellations

- `RULE-CANCEL-01` — A client may cancel freely **before acceptance**, with no penalty. The authorisation is cancelled and nothing is captured.
- `RULE-CANCEL-02` — For a Scheduled booking more than `CFG-LATE-CANCEL-WINDOW-HOURS` before the appointment, either party may cancel without penalty and the client is refunded in full.
- `RULE-CANCEL-03` — Inside that window, or at any time after acceptance for Available Now, a **client** cancellation produces a partial refund to the client and an inconvenience payment to the barber.
- `RULE-CANCEL-04` — Inside that window, or at any time after acceptance for Available Now, a **barber** cancellation produces a full refund to the client and a reliability event against the barber (`RULE-RELY-*`).
- `RULE-CANCEL-05` — Refund amounts are calculated server-side from the booking snapshot and are never supplied by a client. Every refund is audit logged.
- `RULE-CANCEL-06` — The cancellation surface states the financial consequence **before** the client or barber confirms.
- `RULE-CANCEL-07` *(reserved — `P0-D03`)* — The partial refund split, the inconvenience fee amount, and which side of the ledger funds it.

### Barber reliability

- `RULE-RELY-01` — Reliability is a rolling-window level per barber (`ENUM-RELIABILITY-LEVEL`), backed by an append-only event log.
- `RULE-RELY-02` — Reliability consequences are **recoverable**. After a configured period of good behaviour the level improves or resets. Only a repeated, serious pattern leads to suspension.
- `RULE-RELY-03` — Reliability consequences escalate: a logged warning, then a temporary Available Now cooldown, then reduced search priority plus an admin review flag, then suspension or platform review.
- `RULE-RELY-04` — Reliability thresholds and windows are configuration, read from config. A literal threshold inside feature logic is a defect.
- `RULE-RELY-05` — An admin can adjust a barber's reliability state, with a recorded reason and an audit log. It is never silently adjusted by a feature.
- `RULE-RELY-06` *(reserved — `P0-D04`)* — The reliability thresholds, window lengths, cooldown duration, search penalty and suspension criteria.

### ETA and location

- `RULE-ETA-01` — ETA starts only when the barber taps "I'm on my way" and the booking is in a valid status. There is no tracking before that (`ADR-004`).
- `RULE-ETA-02` — ETA is calculated in an Edge Function via the Google Routes API. The server API key never reaches the device (`ADR-008`).
- `RULE-ETA-03` — ETA and its last-updated timestamp are stored and shown together. A client always sees how stale the figure is. An ETA whose age has reached `CFG-ETA-STALE-MIN` is visibly marked stale and is not presented as current.
- `RULE-ETA-04` — The first ETA is calculated immediately when the barber taps "I'm on my way". Subsequent updates use the fixed `CFG-ETA-REFRESH-MIN` interval; a request inside the interval returns the cached ETA without a Routes call or another location read. Updates stop when the booking is completed, cancelled, disputed, or otherwise inactive.
- `RULE-ETA-05` — The UI must not imply live tracking. No moving barber marker.

### Completion

- `RULE-COMPLETE-01` — Completion is driven by user action and timeouts, not by service duration.
- `RULE-COMPLETE-02` — **Barber marks complete:** status becomes `completed_by_barber` and the client has `CFG-COMPLETION-RESPONSE-MIN` to respond. Client confirms → completed, earning available. Client disputes → disputed, earning stays pending. Client does nothing → auto-completes, earning available.
- `RULE-COMPLETE-03` — **Client marks complete first:** the booking completes immediately and the earning becomes available. No waiting window.
- `RULE-COMPLETE-04` — **Neither party acts:** after `CFG-NO-ACTION-WARNING-HOURS` a final completion prompt is sent, giving the client `CFG-FINAL-DISPUTE-WINDOW-MIN` to dispute. No dispute → auto-completes. This stops bookings hanging open forever while still warning the client before money moves.
- `RULE-COMPLETE-05` — Auto-completion runs on the workflow engine (`ADR-011`), re-checks state at execution, and is idempotent.

### Disputes

- `RULE-DISPUTE-01` — A dispute is opened by the booking's client within a completion response window, or by an admin where operationally required.
- `RULE-DISPUTE-02` — Opening a dispute sets the booking to `disputed` and holds the barber's earning at `pending` (`RULE-EARN-03`).
- `RULE-DISPUTE-03` — One open dispute per booking. A repeat submission does not create a second.
- `RULE-DISPUTE-04` — Only an admin resolves a dispute: full refund, partial refund, barber paid, or a recorded operational outcome. A reason is mandatory.
- `RULE-DISPUTE-05` — Resolution updates the dispute, the booking, the payment and the earning consistently, or it does none of them. A partial application is a financial inconsistency.
- `RULE-DISPUTE-06` — Every dispute action is audit logged (`ADR-013`).

### Reviews

- `RULE-REVIEW-01` — A client may review a barber only for their own **completed** booking.
- `RULE-REVIEW-02` — One review per booking.
- `RULE-REVIEW-03` — A rating is required; review text is optional and validated.
- `RULE-REVIEW-04` — A review contributes to the barber's rating aggregate. The aggregate is computed server-side and cannot be written by a client.
- `RULE-REVIEW-05` — An admin can hide or unhide a review, with an audit log. Hidden reviews are excluded from the public aggregate.
- `RULE-REVIEW-06` *(reserved — `P0-D08`)* — Whether a disputed, admin-resolved, or cancelled booking is reviewable.

### Admin operations

- `RULE-ADMIN-01` — Every admin surface and function verifies the admin role server-side. No admin data is fetched before the role is verified.
- `RULE-ADMIN-02` — An admin booking status override validates the transition, requires a reason, and writes history and an audit log. It never silently bypasses a financial rule.
- `RULE-ADMIN-03` — Refunds are issued only by an admin, calculated server-side, and idempotent against Stripe.
- `RULE-ADMIN-04` — Admin list views are filtered, paginated and indexed. An unbounded admin query is a defect.

### Notifications

- `RULE-NOTIF-01` — Push notifications are sent for: request received, accepted, declined, expired, cancelled, barber on the way, useful ETA changes, barber marked complete, client completion prompt, final completion warning, dispute opened and resolved, review prompt, and payout or balance changes.
- `RULE-NOTIF-02` — A notification payload carries no more personal data than the surface needs. Never an address, a phone number, or an amount that is not already the recipient's.
- `RULE-NOTIF-03` — Notification sends are recorded and failures logged. A failed push never blocks or reverses the state change that triggered it.
- `RULE-NOTIF-04` — No SMS at launch.

### Copy and claims

- `RULE-COPY-01` — Client-facing and barber-facing copy must describe what the system actually does. Do not imply live tracking (`ADR-004`), do not describe a QuickTrimr balance as money already paid (`RULE-EARN-04`), and do not describe authorised funds as captured. This applies to the app, notifications, and the Wix site.

### Pending rules — reserved IDs, not yet decided

These IDs are cited by tickets but the rule does not exist yet. The decision ticket named writes it. **A ticket citing one of these cannot start until that decision closes.**

| Reserved ID | What it will say | Written by |
|---|---|---|
| `RULE-PAY-11` | Commission percentage and Stripe fee absorption | `P0-D02` |
| `RULE-CANCEL-07` | Partial refund split and inconvenience fee funding | `P0-D03` |
| `RULE-RELY-06` | Reliability thresholds, windows and consequences | `P0-D04` |
| `RULE-EARN-07` | Payout schedule and batch cadence | `P0-D05` |
| `RULE-SCHED-04` | Scheduled booking lead time and horizon | `P0-D08` |
| `RULE-REVIEW-06` | Review eligibility after dispute or cancellation | `P0-D08` |

---

## 10. Statuses and Enums

Statuses are backend-controlled (`ADR-010`). Every set below is defined once in `packages/shared` and imported everywhere — mobile, admin, and functions.

### ENUM-USER-ROLE

```txt
client  barber  admin
```

### ENUM-VERIFICATION-STATUS

```txt
not_started  pending  verified  failed  requires_review
```

### ENUM-BOOKING-TYPE

```txt
available_now  scheduled
```

### ENUM-BOOKING-STATUS

```txt
requested
expired
declined
accepted_pending_payment
paid_confirmed
on_the_way
arrived
completed_by_barber
completed_by_client
completion_prompt_sent
completed
cancelled
disputed
refunded
admin_resolved
```

`accepted_pending_payment` exists because acceptance and capture are two steps (`ADR-006`). A booking sitting in it means capture is in flight or has failed — it is the state `RULE-PAY-05` recovers from, and it must be visible to admin.

### ENUM-REQUEST-STATUS

```txt
pending  accepted  declined  expired  cancelled
```

### ENUM-PAYMENT-STATUS

```txt
requires_authorisation
authorised
authorisation_cancelled
capture_pending
captured
capture_failed
refunded
partially_refunded
disputed
```

### ENUM-EARNING-STATUS

```txt
pending  available  queued_for_payout  paid_out  reversed
```

| Status | Meaning |
|---|---|
| `pending` | Client has paid; the job is not completed or auto-completed yet |
| `available` | Job complete; the amount sits in the barber's **QuickTrimr balance**, not their bank (`RULE-EARN-04`) |
| `queued_for_payout` | Included in an open payout batch |
| `paid_out` | The batch has settled |
| `reversed` | Reversed by refund, dispute resolution, or chargeback |

### ENUM-PAYOUT-STATUS

```txt
draft  queued  processing  paid  failed  cancelled
```

### ENUM-AVAIL-STATUS

```txt
active  busy  expired  manually_disabled  auto_disabled  cancelled
```

### ENUM-DISPUTE-STATUS

```txt
open  under_review  resolved_client_refund  resolved_barber_paid  resolved_partial_refund  cancelled
```

### ENUM-RELIABILITY-LEVEL

```txt
good_standing  watch  limited  restricted  suspended
```

---

## 11. Database Model Reference

Starting tables:

```txt
profiles                    client_profiles           barber_profiles
client_addresses            service_categories        barber_services
available_now_sessions      booking_requests          bookings
booking_services            booking_status_history    payments
barber_earnings             payout_batches            payout_batch_items
disputes                    reviews                   notifications
audit_logs                  barber_reliability_events barber_reliability_state
```

Principles:

- **Every table has RLS.** A table without it is a bug (`ADR-001`). Verify denial at the API, never the UI.
- PostGIS for every location column and every distance query (`ADR-008`).
- Integer cents for every monetary column (`ADR-009`).
- Price and commission snapshots on the booking, not looked up live.
- Every booking status transition writes `booking_status_history` (`ADR-010`).
- Every sensitive action writes `audit_logs`, append-only (`ADR-013`).
- Payments and earnings are separate tables. A payment is what the client paid; an earning is what the barber is owed. They are not the same number and never share a row.
- Config-driven values are read from config (§13), never baked into a column default that silently becomes the rule.
- Indexes for the access patterns that actually exist: booking status, barber id, client id, booking type, created date, Available Now session status, geography, payment status, dispute status.
- Pagination on anything that grows.

### Access expectations

**Client** reads: own profile, own addresses, own requests, bookings, payments in safe form, own disputes, own reviews, and public barber data. Never another client's anything, never barber private data, never payout internals, never audit logs.

**Barber** reads: own profile and services, own Available Now sessions, requests addressed to them, own bookings, own earnings, own reviews, and client contact details **only for an accepted active booking**. Never another barber's data, never unrelated client data, never platform payment totals, never audit logs.

**Admin** reads operational data through admin-authorised paths only (`RULE-ADMIN-01`).

---

## 12. API / Edge Function Rules

Every Edge Function must:

- Validate authentication. The user id comes from the verified JWT, **never the body**.
- Validate role.
- Validate input with a Zod schema from `packages/validation`.
- Recompute anything financial server-side. Never trust a client-supplied amount, commission, status, role, or user id.
- Use the shared error and response helpers, and return typed, safe errors that do not leak internals.
- Use a deterministic, server-derived idempotency key wherever a repeat call is possible.
- Handle concurrency where two callers can race (acceptance is the obvious one).
- Write an audit log for sensitive actions (`ADR-013`).
- Return only what the caller needs.

Function inventory:

```txt
auth / onboarding    create-or-sync-profile  complete-client-profile  complete-barber-profile
                     create-stripe-connect-onboarding-link  refresh-stripe-connect-status

services / pricing   create-service-category  update-service-category  archive-service-category
                     upsert-barber-service  archive-barber-service

available now        start-available-now-session  update-available-now-session
                     stop-available-now-session  search-available-now-barbers
                     auto-disable-unresponsive-barber

booking requests     create-booking-request  accept-booking-request  decline-booking-request
                     expire-booking-request  cancel-booking-request

payments             create-payment-authorisation  capture-authorised-payment
                     cancel-payment-authorisation  stripe-webhook  create-refund

lifecycle            mark-on-the-way  update-eta  mark-arrived
                     mark-job-complete-by-barber  confirm-job-complete-by-client
                     open-dispute  auto-complete-after-barber-complete-timeout
                     send-final-completion-prompt  auto-complete-after-final-prompt
                     cancel-booking

earnings / payouts   create-barber-earning  release-barber-earning
                     queue-payout-batch  process-payout-batch  mark-payout-batch-paid

reviews              create-review  update-review-admin-visibility

admin                admin-list-bookings  admin-get-booking-detail  admin-resolve-dispute
                     admin-issue-refund  admin-update-barber-status
                     admin-update-reliability-state  admin-view-platform-analytics
```

---

## 13. Configuration Values

These are read from config. **A literal `5`, `12`, `20`, `60` or `2` inside feature logic is a defect**, and where a value affects money or history it is snapshotted on the booking (`ADR-009`).

| ID | Value | Notes |
|---|---|---|
| `CFG-COMMISSION-PCT` | `TBC-COMMISSION-PCT` | Platform commission. Snapshotted per booking. |
| `CFG-AVAIL-EXPIRY-MIN` | `5` | Available Now request expiry, minutes (`RULE-AVAIL-06`). |
| `CFG-SCHED-EXPIRY-HOURS` | `2` | Scheduled request expiry, hours (`RULE-SCHED-02`). |
| `CFG-COMPLETION-RESPONSE-MIN` | `60` | Client response window after barber marks complete (`RULE-COMPLETE-02`). |
| `CFG-NO-ACTION-WARNING-HOURS` | `6` | Before the final completion prompt (`RULE-COMPLETE-04`). |
| `CFG-FINAL-DISPUTE-WINDOW-MIN` | `60` | Dispute window after the final prompt (`RULE-COMPLETE-04`). |
| `CFG-MISSED-REQUEST-THRESHOLD` | `2` | Consecutive missed requests before auto-disable (`RULE-AVAIL-03`). |
| `CFG-LATE-CANCEL-WINDOW-HOURS` | `12` | Late-cancellation window for Scheduled bookings (`RULE-CANCEL-02`). |
| `CFG-ETA-REFRESH-MIN` | `3` | Fixed ETA refresh interval in minutes (`RULE-ETA-04`). |
| `CFG-ETA-STALE-MIN` | `6` | ETA is stale after two missed refresh intervals (`RULE-ETA-03`). |
| `CFG-PAYOUT-SCHEDULE` | `TBC-PAYOUT-SCHEDULE` | Payout batch cadence (`RULE-EARN-05`). |
| `CFG-CANCEL-REFUND-PCT` | `TBC-CANCEL-SPLIT` | Client partial-refund percentage (`RULE-CANCEL-03`). |
| `CFG-INCONVENIENCE-FEE` | `TBC-INCONVENIENCE-FEE` | Barber inconvenience payment (`RULE-CANCEL-03`). |
| `CFG-RELIABILITY-WINDOW-DAYS` | `TBC-RELIABILITY-THRESHOLDS` | Rolling window (`RULE-RELY-01`). |
| `CFG-RELIABILITY-RESET-DAYS` | `TBC-RELIABILITY-THRESHOLDS` | Good-behaviour reset period (`RULE-RELY-02`). |
| `CFG-RELIABILITY-COOLDOWN-MIN` | `TBC-RELIABILITY-THRESHOLDS` | Available Now cooldown (`RULE-RELY-03`). |
| `CFG-SCHED-MIN-LEAD-MIN` | `TBC-SCHED-LEAD-TIME` | Minimum lead time for a Scheduled request (`RULE-SCHED-04`). |

Config stored in the database lives in a platform config table, is updatable only by an admin, and is audit logged.

---

## 14. Open Decisions (TBC Register)

**Never delete a row.** When a decision is made, rewrite the row in place as `RESOLVED → <id>` and leave it. Tickets cite these IDs.

| ID | Question | Blocks | Decided by |
|---|---|---|---|
| `TBC-SERVICE-CATEGORIES` | **RESOLVED → `RULE-SERVICE-05`** | Catalogue, barber pricing, discovery, seed data | `P0-D01` |
| `TBC-COMMISSION-PCT` | What is the platform commission percentage? 20% is an assumption carried from the proposal, not a decision. | Every payment, earning and payout row | `P0-D02` |
| `TBC-STRIPE-FEES` | Who absorbs the Stripe processing fee — QuickTrimr, the barber, or the client? What happens to it on a full and on a partial refund? | Commission maths, refunds, barber net | `P0-D02` |
| `TBC-CANCEL-SPLIT` | What percentage does a client get back on a late cancellation? | Cancellation, refunds, admin resolution | `P0-D03` |
| `TBC-INCONVENIENCE-FEE` | How much is the barber's inconvenience payment, and **which side funds it** — the client's withheld amount, or QuickTrimr? | Cancellation, earnings, refund maths | `P0-D03` |
| `TBC-RELIABILITY-THRESHOLDS` | What counts as an offence, over what rolling window, with what cooldown, search penalty and suspension criteria? | Reliability engine, barber cancellation, admin | `P0-D04` |
| `TBC-PAYOUT-SCHEDULE` | How often do payout batches run, on what day, with what minimum balance? | Payout batching and processing | `P0-D05` |
| `TBC-LOCATION-PRECISION` | **RESOLVED → `RULE-DISCOVERY-05`** | Discovery, map view, search function | `P0-D06` |
| `TBC-ETA-INTERVAL` | **RESOLVED → `RULE-DISCOVERY-05`** | ETA update function and display | `P0-D06` |
| `TBC-WORKFLOW-ENGINE` | What runs scheduled and delayed work — Supabase cron, Inngest, Trigger.dev, or another? | Every expiry, auto-completion, prompt and payout run | `P0-D07` |
| `TBC-SCHED-LEAD-TIME` | What is the minimum lead time for a Scheduled request, and how far ahead can one be made? | Scheduled request validation and discovery | `P0-D08` |
| `TBC-REVIEW-ELIGIBILITY` | Can a client review after a dispute, an admin resolution, or a cancellation? | Review creation and prompts | `P0-D08` |

---

## 15. Testing and QA Expectations

Rules that must have automated coverage — these are the ones that cost money or leak data when they break:

- A client cannot hold two active pending Available Now requests (`RULE-AVAIL-04`).
- An Available Now request expires at `CFG-AVAIL-EXPIRY-MIN`; a Scheduled one at `CFG-SCHED-EXPIRY-HOURS`. Test the boundary, not the middle.
- A barber cannot accept an expired, declined, or cancelled request.
- A barber cannot hold two accepted Available Now jobs — **under real parallel calls**, not sequential ones.
- Capture is idempotent: a duplicate call charges once (`RULE-PAY-04`).
- A failed capture leaves a recoverable state (`RULE-PAY-05`).
- Webhook signature rejection, and duplicate delivery producing one effect (`RULE-PAY-07`).
- Client and barber cancellation maths, at and either side of `CFG-LATE-CANCEL-WINDOW-HOURS`.
- Completion in all three cases, including both auto-completion paths (`RULE-COMPLETE-02/03/04`).
- An open dispute holds the earning at `pending` (`RULE-EARN-03`).
- Reliability escalation and reset (`RULE-RELY-02`).
- Admin-only actions denied for client and barber roles, **called directly at the API**.
- RLS cross-user denial on every table, read and write, every verb, at the API.

Manual QA covers: client onboarding, barber onboarding, Stripe Connect, Available Now end to end, Scheduled end to end, cancellation, payment, completion, dispute, admin dispute and refund, ETA, and reviews.

---

## 16. Scope

### In scope for MVP

Client and barber mobile journeys, Available Now and Scheduled bookings, Stripe authorise/capture/refund, Stripe Connect onboarding and batched payouts, PostGIS discovery, controlled ETA, completion and auto-completion, disputes, reviews, reliability, push notifications, the admin dashboard, and the Wix marketing site.

### Out of scope unless separately approved

Full live tracking, in-app chat, SMS, promo codes, loyalty or referral schemes, barber subscriptions, advanced fraud detection, tax or accounting exports, support ticketing, multi-city operations tooling, AI matching, dynamic pricing, legal policy drafting, insurance and compliance workflow, a dedicated backend replacing Edge Functions, AWS migration, Firebase, a GraphQL layer, and Detox mobile E2E.

The following service categories and pricing variants are also deferred until after launch:

- kids haircuts — this requires an explicit guardian and minor-booking policy first;
- buzz or crew cuts;
- specialist scissor or long-hair cuts;
- head shaves and face shaves;
- line-up-only services;
- student, senior, or other concession pricing;
- colouring, waxing, and grooming add-ons; and
- wedding, event, after-hours, hospital, NDIS, or distance-priced services.

Student, senior, Sunday, after-hours, and distance pricing describe customer eligibility or booking
conditions, not separate launch service categories.

A ticket drifting into this list stops and is raised, not implemented.

---

## 17. Final Principle

QuickTrimr should feel simple to a client standing in their kitchen and to a barber between jobs. Behind that, it is a payments system with a stranger's home address in it.

Optimise for trust, payment correctness, access control, unambiguous booking state, admin visibility, and auditability. Then for clean code, shared components, and parallel delivery.

Do not solve future problems early. Do not create debt that blocks the next thousand bookings.
