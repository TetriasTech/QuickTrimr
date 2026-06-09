# TRIMR Product Backlog & Ticket Structure

> This README is intended for GitHub Copilot or another implementation agent to generate Jira Epics and issues through the Jira REST API.
>
> Do **not** store Jira API keys, Supabase service-role keys, Stripe secrets, Google API keys, or any other credentials in this file or in source control. Use environment variables or secret storage only.

---

## 1. Project Summary

**Product name:** TRIMR  
**Product type:** Two-sided barber marketplace mobile platform  
**Team:** Tetrias Tech — two developers working in one monorepo  
**Quality expectation:** Premium, production-quality implementation. Do not let the undercharged commercial price lower the engineering standard.

TRIMR connects clients who need haircuts with nearby barbers who can accept either:

1. **Available Now** booking requests.
2. **Future scheduled** booking requests.

The platform includes:

- Client mobile app experience
- Barber mobile app experience
- Web-based admin dashboard
- Wix marketing website
- Supabase backend and database
- Stripe payments and Stripe Connect payouts
- Google Maps, location discovery, and ETA calculation
- Expo push notifications
- Reviews and ratings
- Admin management of bookings, users, disputes, payouts, service categories, and platform activity

---

## 2. Confirmed Tech Stack

| Area | Technology |
|---|---|
| Mobile app | React Native + Expo |
| Mobile language | TypeScript |
| Mobile routing | Expo Router |
| Mobile server state | TanStack Query |
| Mobile local state | Zustand |
| Forms and validation | React Hook Form + Zod |
| Admin dashboard | Next.js + TypeScript |
| Admin UI | Tailwind CSS + shadcn/ui |
| Tables | TanStack Table |
| Database | Supabase Postgres |
| Geo/location search | PostGIS |
| Backend/API layer | Supabase Edge Functions |
| Authentication | Supabase Auth |
| Access control | Supabase Row Level Security |
| File storage | Supabase Storage |
| Payments | Stripe Payments |
| Marketplace payouts | Stripe Connect |
| Barber onboarding | Stripe Connect hosted onboarding |
| Client identity verification | Not at launch; architecture should be Stripe Identity-ready |
| Push notifications | Expo Notifications |
| Maps | Google Maps SDK |
| Address search | Google Places API |
| ETA calculation | Google Routes API |
| Mobile builds/deployment | Expo EAS |
| Admin deployment | Vercel |
| Website | Wix |
| Product analytics | PostHog |
| Error monitoring | Sentry |
| CI/CD | GitHub Actions |
| Repo structure | Monorepo |

---

## 3. Monorepo Structure

Use this structure unless there is a strong reason to change it.

```txt
trimr/
  apps/
    mobile/
      app/
      src/
        features/
        components/
        hooks/
        lib/
        stores/
        theme/
    admin/
      app/
      src/
        features/
        components/
        lib/
        hooks/
  packages/
    shared/
      src/
        constants/
        types/
        utils/
    validation/
      src/
        schemas/
    ui/
      src/
        components/
  supabase/
    functions/
      _shared/
        auth/
        errors/
        logging/
        responses/
        validation/
        services/
    migrations/
    seed/
  scripts/
    jira/
    db/
  docs/
    architecture/
    decisions/
    qa/
```

### Monorepo Rules

- Shared TypeScript types live in `packages/shared`.
- Shared Zod schemas live in `packages/validation`.
- Shared UI primitives live in `packages/ui` where practical.
- Feature-specific UI lives inside the relevant feature folder.
- Do not duplicate constants across mobile, admin, and functions.
- Do not store secrets in code, markdown, seed files, fixtures, or tests.
- All database changes must be through Supabase migrations.
- Do not manually change production schema through the Supabase dashboard.
- Every Edge Function must use shared auth, validation, error, logging, and response helpers.
- Mobile screens must support mock data while backend contracts are being built.

---

## 4. Principal-Engineer Quality Standard

Every ticket must satisfy this standard before it is considered complete.

### 4.1 Dead or Redundant Code

Check for:

- Unused files, imports, components, functions, hooks, constants, and schemas
- Duplicate logic
- Code no longer needed after recent changes
- Temporary debugging code
- Console logs that expose private data
- Old mock data left connected to production flows

### 4.2 Security and Access Control

Check for:

- No hardcoded secrets
- Safe environment variable usage
- No public exposure of Supabase service-role key
- Supabase RLS policies reviewed for every table
- Admin-only routes and actions protected properly
- Client access does not leak barber/admin/private data
- Barber access does not leak unrelated client/admin/private data
- Public routes do not expose private data
- Edge Functions do not trust frontend-provided role, amount, status, user ID, commission, payout, or verification data
- Stripe webhook signatures verified
- Admin actions audit logged
- Sensitive PII not unnecessarily logged

### 4.3 Database and Supabase Usage

Check for:

- Efficient queries
- No repeated unnecessary queries
- No N+1 query patterns
- No over-fetching
- Proper filters on user, barber, booking, and admin scope
- Pagination where records can grow
- Search/filtering where lists can grow
- Query indexes considered for filtering and joins
- Location queries handled with PostGIS, not client-side filtering
- Sensitive marketplace actions handled server-side through Edge Functions
- RLS policies tested against client, barber, and admin roles
- No accidental cross-user data leakage

### 4.4 React / Next.js / Expo Patterns

Check for:

- Correct `useEffect` dependency arrays
- No render loops
- No unnecessary client components in Next.js
- No unnecessary re-renders
- Server/client component boundaries respected
- Correct TanStack Query usage for server state
- Correct Zustand usage for temporary app state
- No Redux unless explicitly approved later
- Loading, empty, and error states handled
- Mobile-specific permissions handled carefully
- Navigation handles unauthenticated and incomplete onboarding users

### 4.5 Type Safety and Maintainability

Check for:

- Avoid `any`
- Strong TypeScript types
- Shared types reused
- Zod schemas reused where practical
- Repeated constants avoided
- Consistent naming
- Files are not too large
- Functions have single responsibility
- Business rules are not scattered across UI components
- Code is easy to extend in later phases

### 4.6 Error Handling and Validation

Check for:

- Input validation with Zod
- Failed Supabase/API calls handled
- Forms reject invalid data
- User-friendly error messages
- Technical errors logged safely
- Payment, booking, dispute, and payout edge cases handled carefully
- Retry or recovery paths where appropriate

### 4.7 Performance and Scalability

Check for:

- No queries that become slow as records grow
- No large unbounded list queries
- No unnecessary frontend payloads
- No high-frequency location updates
- ETA updates throttled
- Pagination implemented where needed
- Avoid repeated Google Routes API calls when not required
- Avoid excessive Supabase Realtime usage
- Avoid expensive dashboard queries without filters/date ranges

### 4.8 Scope Control

Check for:

- No unapproved features
- No unnecessary complexity
- Anything out of current phase is deferred
- No speculative abstractions unless clearly justified
- No new third-party dependency without reason
- No backend rewrites unless required by the ticket

---

## 5. Definition of Done for Every Ticket

A ticket is not done unless:

- Acceptance criteria are met.
- Lint passes.
- Typecheck passes.
- Tests are added or updated where practical.
- No unused imports/files/functions/components remain.
- No secrets are hardcoded.
- RLS/access control implications are considered.
- Validation exists where inputs are accepted.
- Loading/error/empty states exist where user-facing.
- Database queries are filtered and efficient.
- No duplicate logic was introduced.
- Shared components/types/schemas are used where appropriate.
- Edge cases are documented or handled.
- Out-of-scope work was not added.
- Any new config value is documented.
- Any schema change includes a migration.
- Any sensitive action includes audit logging where appropriate.

---

## 6. Ticket Format for Jira Generation

Copilot should generate Jira issues using this structure.

```yaml
ticket:
  id: "P0-E01-T01"
  phase: "Phase 0"
  epic: "Monorepo, Foundations & Engineering Standards"
  issueType: "Task"
  title: "Set up TRIMR monorepo workspace"
  labels:
    - trimr
    - phase-0
    - foundation
  priority: "High"
  ownerStream: "Shared"
  dependencies: []
  canRunInParallelWith: []
  description: |
    Detailed implementation description.
  acceptanceCriteria:
    - "Criterion 1"
    - "Criterion 2"
  technicalNotes:
    - "Important technical note"
  outOfScope:
    - "What should not be done in this ticket"
  qualityGate:
    - "Apply global Definition of Done"
```

### Suggested Jira Hierarchy

Use:

- **Epic** for each major area
- **Task** for engineering/setup work
- **Story** for user-facing product capability
- **Bug** only after implementation/testing identifies defects
- **Sub-task** only if Jira project configuration supports it cleanly

If the Jira project does not support Epic child relationships through the selected API flow, create all issues with labels such as:

- `phase-0`, `phase-1`, etc.
- `epic-monorepo-foundations`, etc.
- `mobile`, `admin`, `backend`, `database`, `stripe`, `maps`, `notifications`

---

## 7. Product Rules Locked for Implementation

### 7.1 Booking Types

TRIMR supports:

- `available_now`
- `scheduled`

### 7.2 Request Rules

Available Now:

- Client can only have one active pending Available Now request at a time.
- Barber can receive multiple requests.
- Barber can only accept one Available Now request at a time.
- Request expires after 5 minutes.
- If accepted, payment capture is triggered and booking becomes confirmed.
- If declined/expired/cancelled before acceptance, payment authorisation is cancelled.

Scheduled:

- Client can only have one active pending request for the same booking intent.
- Barber can accept or decline within 2 hours.
- If no response within 2 hours, request expires.
- If accepted, payment capture is triggered and booking becomes confirmed.

### 7.3 Payment Rules

- Client submits request with a payment method.
- Payment is pre-authorised when request is submitted.
- Payment is captured when barber accepts.
- Payment is not transferred to the barber immediately.
- Barber earnings begin as `pending`.
- Barber earnings become `available` only after completion or auto-completion.
- Actual bank payout occurs later according to payout schedule.

### 7.4 Completion Rules

If barber marks job complete:

- Client has 1 hour to confirm or dispute.
- If client confirms, booking completes immediately.
- If client disputes, dispute opens.
- If client does nothing for 1 hour, booking auto-completes.

If client marks job complete first:

- Booking completes immediately.
- Barber earnings move from `pending` to `available`.

If neither party marks job complete:

- After 6 hours, TRIMR sends final completion warning/prompt.
- Client receives 1 additional hour to dispute.
- If no dispute is raised, booking auto-completes.
- Barber earnings move from `pending` to `available`.

### 7.5 Payout Rules

- Auto-release means barber TRIMR balance moves from `pending` to `available`.
- Auto-release does not mean instant bank payout.
- Actual payout can be batched, for example weekly.
- Payout schedule must be configurable.
- Commission is assumed to be 20% for now.
- Commission must be configurable.
- Commission percentage must be snapshotted per booking.

### 7.6 Cancellation Rules

Future bookings:

- More than 12 hours before booking: either party can cancel without punishment.
- Within 12 hours: cancellation is still allowed but consequences apply.
- Client cancellation within 12 hours: partial refund and barber inconvenience fee.
- Barber cancellation within 12 hours: client full refund and barber reliability consequence.

Available Now:

- Before barber accepts: client can cancel freely and payment authorisation is cancelled.
- After barber accepts: client cancellation gives partial refund and barber inconvenience fee.
- After barber accepts: barber cancellation gives client full refund and barber reliability consequence.

### 7.7 Barber Reliability Rules

Reliability consequences must be recoverable and based on a rolling window.

Example initial rules:

- 1st late/accepted-job cancellation in rolling window: warning logged.
- 2nd: temporary Available Now cooldown.
- 3rd: reduced search priority and admin review flag.
- Repeated pattern: suspension from Available Now or full platform review.
- Good behaviour for configured reset period improves or resets reliability level.

Reliability configuration must be adjustable:

- Rolling window days
- Reset period days
- Missed request threshold
- Cooldown duration
- Search priority penalty
- Admin review threshold

### 7.8 Available Now Rules

Barber can:

- Toggle Available Now on/off.
- Use GPS location.
- Manually adjust location where allowed.
- Set travel radius.
- Set available-until time.

Auto-disable Available Now if:

- Available-until time passes.
- Barber ignores/misses 2 consecutive requests.
- Barber accepts an Available Now booking.
- Barber manually toggles off.

Distance for Available Now:

- Calculated from barber current location.

Distance/service area for Scheduled:

- Based on barber service area and configured radius.

### 7.9 ETA Rules

- No Uber-style live tracking.
- ETA begins only when barber taps “I’m on my way”.
- App sends barber location at controlled intervals.
- Backend calculates ETA through Google Routes API.
- Client sees ETA and last updated time.
- ETA refresh interval should be configurable.
- Default interval: 2–3 minutes.
- Stop ETA updates when booking is completed, cancelled, disputed, or no longer active.

### 7.10 Pricing Rules

- Admin creates global service categories.
- Barber selects services they offer.
- Barber sets their own price for each service.
- Booking stores selected services and price snapshot.
- Existing bookings do not change when barber updates prices.
- Commission is calculated from booking snapshot.

---

## 8. Proposed Database Model

This schema is a starting point. It should be refined through migrations and implementation.

### Core Tables

```txt
profiles
client_profiles
barber_profiles
client_addresses
service_categories
barber_services
available_now_sessions
booking_requests
bookings
booking_services
booking_status_history
payments
barber_earnings
payout_batches
payout_batch_items
disputes
reviews
notifications
audit_logs
barber_reliability_events
barber_reliability_state
```

### Suggested Enums

```txt
user_role:
  client
  barber
  admin

verification_status:
  not_started
  pending
  verified
  failed
  requires_review

booking_type:
  available_now
  scheduled

booking_status:
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

request_status:
  pending
  accepted
  declined
  expired
  cancelled

payment_status:
  requires_authorisation
  authorised
  authorisation_cancelled
  capture_pending
  captured
  capture_failed
  refunded
  partially_refunded
  disputed

earning_status:
  pending
  available
  queued_for_payout
  paid_out
  reversed

payout_status:
  draft
  queued
  processing
  paid
  failed
  cancelled

available_now_status:
  active
  busy
  expired
  manually_disabled
  auto_disabled
  cancelled

dispute_status:
  open
  under_review
  resolved_client_refund
  resolved_barber_paid
  resolved_partial_refund
  cancelled

reliability_level:
  good_standing
  watch
  limited
  restricted
  suspended
```

### Database Requirements

- Every user belongs to exactly one profile.
- Client and barber profile data should be separated.
- Use RLS to ensure users only access their own private data.
- Admin queries must require admin role.
- Use PostGIS for barber location and radius queries.
- Use audit logs for sensitive actions.
- Use booking status history for every booking state transition.
- Use price snapshots for bookings.
- Use commission snapshots for bookings.
- Use payment and earning tables separately.
- Do not calculate financial truth from frontend state.

---

## 9. API / Edge Function Contract List

All sensitive marketplace operations must be handled server-side through Edge Functions.

### Authentication / Onboarding

```txt
create-or-sync-profile
complete-client-profile
complete-barber-profile
create-stripe-connect-onboarding-link
refresh-stripe-connect-status
```

### Services / Pricing

```txt
create-service-category
update-service-category
archive-service-category
upsert-barber-service
archive-barber-service
```

### Available Now

```txt
start-available-now-session
update-available-now-session
stop-available-now-session
search-available-now-barbers
auto-disable-unresponsive-barber
```

### Booking Requests

```txt
create-booking-request
accept-booking-request
decline-booking-request
expire-booking-request
cancel-booking-request
```

### Payments

```txt
create-payment-authorisation
capture-authorised-payment
cancel-payment-authorisation
stripe-webhook
create-refund
```

### Booking Lifecycle

```txt
mark-on-the-way
update-eta
mark-arrived
mark-job-complete-by-barber
confirm-job-complete-by-client
open-dispute
auto-complete-after-barber-complete-timeout
send-final-completion-prompt
auto-complete-after-final-prompt
cancel-booking
```

### Earnings / Payouts

```txt
create-barber-earning
release-barber-earning
queue-payout-batch
process-payout-batch
mark-payout-batch-paid
```

### Reviews

```txt
create-review
update-review-admin-visibility
```

### Admin

```txt
admin-list-bookings
admin-get-booking-detail
admin-resolve-dispute
admin-issue-refund
admin-update-barber-status
admin-update-reliability-state
admin-view-platform-analytics
```

---

## 10. Parallel Development Strategy

The team has two developers. Tickets must be organised so both can work without constant blocking.

### Preferred Streams

```txt
Developer Stream A: Mobile app and client/barber UX
Developer Stream B: Backend, database, Edge Functions, admin dashboard
Shared: contracts, types, schemas, migrations, design system
```

### Anti-Blocking Rules

- Define shared types/Zod schemas before dependent UI/backend work.
- Mobile screens should support mock data.
- Backend functions should be callable through mocked request payloads before UI is complete.
- Admin pages should use seeded data early.
- Avoid both developers editing the same large files.
- Keep feature folders isolated.
- Every API contract should include example request and response.

---

# 11. Backlog

## Phase 0 — Foundation, Architecture & Engineering Standards

### Epic P0-E01 — Monorepo, Tooling & Engineering Standards

#### P0-E01-T01 — Set up TRIMR monorepo workspace

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** Highest  
**Dependencies:** None  
**Can run in parallel with:** P0-E01-T02, P0-E01-T03

**Description:**  
Create the initial monorepo for TRIMR with the agreed structure for mobile, admin, shared packages, validation packages, UI package, Supabase functions, migrations, scripts, and docs.

**Acceptance criteria:**

- Monorepo structure matches this README.
- Mobile app folder exists under `apps/mobile`.
- Admin app folder exists under `apps/admin`.
- Shared packages exist under `packages/shared`, `packages/validation`, and `packages/ui`.
- Supabase folder exists with `functions`, `migrations`, and `seed`.
- Root README explains how to install, run, typecheck, lint, and test.
- No unused placeholder files beyond standard generated setup files.

**Technical notes:**

- Prefer pnpm workspaces unless the team decides otherwise.
- Keep scripts consistent at root level.

**Out of scope:**

- Feature implementation.
- Database schema implementation.

---

#### P0-E01-T02 — Configure TypeScript, linting, formatting and quality scripts

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** Highest  
**Dependencies:** P0-E01-T01  
**Can run in parallel with:** P0-E01-T03

**Description:**  
Set up TypeScript, ESLint, Prettier, and root scripts that enforce the quality bar across the monorepo.

**Acceptance criteria:**

- Root `typecheck` script runs for all packages/apps.
- Root `lint` script runs for all packages/apps.
- Root `format` script exists.
- TypeScript strict mode is enabled where practical.
- ESLint catches unused imports and common React issues.
- CI-friendly scripts are documented.
- No `any` is introduced without explicit justification.

**Technical notes:**

- Include lint rules for React hooks.
- Ensure generated files are excluded only where appropriate.

**Out of scope:**

- Full CI pipeline.

---

#### P0-E01-T03 — Create environment variable strategy and examples

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** Highest  
**Dependencies:** P0-E01-T01  
**Can run in parallel with:** P0-E01-T02

**Description:**  
Define safe environment variable handling for mobile, admin, Supabase functions, Stripe, Google Maps, PostHog, Sentry, and Jira scripting.

**Acceptance criteria:**

- `.env.example` files exist where needed.
- No real secrets are committed.
- README explains local, staging, and production environment setup.
- Public vs private environment variables are clearly documented.
- Supabase service role key is never exposed to mobile/admin frontend.
- Stripe secret keys and webhook secrets are server-only.
- Google API keys are scoped and documented.

**Out of scope:**

- Creating actual third-party accounts.

---

#### P0-E01-T04 — Set up GitHub Actions CI quality checks

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** High  
**Dependencies:** P0-E01-T02  
**Can run in parallel with:** P0-E02-T01

**Description:**  
Add GitHub Actions workflow to run lint, typecheck, and tests on pull requests.

**Acceptance criteria:**

- CI runs on PRs to main.
- CI runs lint.
- CI runs typecheck.
- CI runs available tests.
- CI fails on errors.
- Workflow does not require secrets for basic quality checks.
- README includes CI expectations.

**Out of scope:**

- Production deployment automation.
- App store deployment.

---

#### P0-E01-T05 — Add PR template and engineering review checklist

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** High  
**Dependencies:** P0-E01-T01  
**Can run in parallel with:** Any Phase 0 ticket

**Description:**  
Create a PR template enforcing principal-engineer review standards.

**Acceptance criteria:**

- PR template includes checklist for dead code, security, database usage, React/Expo/Next patterns, type safety, validation, performance, and scope control.
- PR template asks for testing evidence.
- PR template asks for screenshots/videos for UI changes.
- PR template asks for migration/RLS notes where relevant.
- PR template asks for out-of-scope confirmation.

**Out of scope:**

- Automated PR review bots.

---

### Epic P0-E02 — Shared Contracts, Types & Validation

#### P0-E02-T01 — Create shared domain constants and enums

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** Highest  
**Dependencies:** P0-E01-T01  
**Can run in parallel with:** P0-E03-T01

**Description:**  
Create shared constants and TypeScript enums/unions for booking statuses, payment statuses, request statuses, user roles, verification statuses, earning statuses, payout statuses, dispute statuses, reliability levels, and booking types.

**Acceptance criteria:**

- Constants live in `packages/shared`.
- Constants are used by mobile, admin, and functions.
- No duplicated string literals for core statuses.
- Status names match the product rules in this README.
- Types are exported cleanly.
- No circular dependencies between shared packages.

**Out of scope:**

- Database migrations.

---

#### P0-E02-T02 — Create Zod schemas for core API contracts

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** Highest  
**Dependencies:** P0-E02-T01  
**Can run in parallel with:** P0-E03-T01

**Description:**  
Create initial Zod schemas for core request/response contracts used by mobile, admin, and Edge Functions.

**Acceptance criteria:**

- Schemas exist for booking request creation, booking acceptance, cancellation, completion, dispute opening, available now session creation, barber service upsert, and ETA update.
- Schemas are exported from `packages/validation`.
- Schemas infer TypeScript types.
- Invalid examples fail validation.
- Valid examples pass validation.
- No schema contains frontend-trusted financial fields like commission amount or payout amount unless server-calculated.

**Out of scope:**

- Function implementation.

---

#### P0-E02-T03 — Create API contract documentation

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** High  
**Dependencies:** P0-E02-T02  
**Can run in parallel with:** P0-E03-T02

**Description:**  
Document each Edge Function contract with input, output, possible errors, auth requirements, and example payloads.

**Acceptance criteria:**

- Contract docs exist under `docs/architecture/api-contracts.md`.
- Each function specifies required role.
- Each function specifies validation schema.
- Each function specifies success response shape.
- Each function specifies failure response shape.
- Contracts can be used by mobile/admin developers with mock data.

**Out of scope:**

- Creating the functions.

---

### Epic P0-E03 — Supabase Local Setup, Schema & RLS Foundation

#### P0-E03-T01 — Set up Supabase project structure and local development

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P0-E01-T01  
**Can run in parallel with:** P0-E02-T01

**Description:**  
Configure Supabase local development, project linking process, migrations folder, seed folder, and local setup documentation.

**Acceptance criteria:**

- Supabase CLI setup documented.
- Local Supabase can run.
- Migration workflow documented.
- Seed workflow documented.
- Dev/staging/prod environment strategy documented.
- No production operations are required for local development.

**Out of scope:**

- Full schema implementation.

---

#### P0-E03-T02 — Create initial database schema migration

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P0-E02-T01, P0-E03-T01  
**Can run in parallel with:** P0-E04-T01, P0-E05-T01

**Description:**  
Create the initial Supabase migration for the core TRIMR schema.

**Acceptance criteria:**

- Migration creates required enum types.
- Migration creates core tables listed in section 8.
- Foreign keys are defined.
- Created/updated timestamps are included.
- Financial values use integer cents, not floating-point decimal.
- Price and commission snapshots are supported.
- PostGIS extension is enabled for location fields.
- Basic indexes are added for common filters.

**Technical notes:**

- Do not over-index prematurely, but add indexes for obvious access patterns.
- Financial fields should be auditable and immutable where appropriate.

**Out of scope:**

- RLS policies.
- Seed data.

---

#### P0-E03-T03 — Add initial RLS policies

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P0-E03-T02  
**Can run in parallel with:** P0-E04-T01

**Description:**  
Add Supabase Row Level Security policies for core tables.

**Acceptance criteria:**

- RLS enabled on all tables with private or operational data.
- Clients can only access their own private data.
- Barbers can only access their own private data.
- Users cannot see unrelated bookings.
- Admin access is restricted to admin users.
- Public barber profile data is exposed only through safe views or filtered policies.
- Payment, payout, audit, and dispute tables are not broadly readable.
- Policies do not rely on frontend-provided role values.

**Out of scope:**

- Full admin dashboard implementation.

---

#### P0-E03-T04 — Add seed data for local development

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Medium  
**Dependencies:** P0-E03-T02  
**Can run in parallel with:** P0-E04-T02, P0-E05-T02

**Description:**  
Create seed data to allow mobile and admin development without waiting on real users.

**Acceptance criteria:**

- Seed data includes clients.
- Seed data includes barbers.
- Seed data includes service categories.
- Seed data includes barber services/pricing.
- Seed data includes available-now sessions.
- Seed data includes bookings in multiple statuses.
- Seed data includes disputes/reviews.
- Seed data does not contain real PII.
- Seed data is documented.

**Out of scope:**

- Production data.

---

### Epic P0-E04 — Mobile App Shell & Design System Foundation

#### P0-E04-T01 — Set up Expo mobile app shell

**Issue type:** Task  
**Owner stream:** Mobile  
**Priority:** Highest  
**Dependencies:** P0-E01-T01  
**Can run in parallel with:** P0-E03-T02

**Description:**  
Create the base Expo app with TypeScript, Expo Router, app navigation groups, and basic project structure.

**Acceptance criteria:**

- Expo app runs locally.
- Expo Router is configured.
- Authenticated and unauthenticated navigation groups exist.
- Feature folder structure is established.
- App imports shared types and validation package successfully.
- No business feature implementation yet.

**Out of scope:**

- Auth flow implementation.
- Booking flow implementation.

---

#### P0-E04-T02 — Create mobile shared UI primitives

**Issue type:** Task  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P0-E04-T01  
**Can run in parallel with:** P0-E05-T02

**Description:**  
Create reusable mobile UI primitives to avoid duplicate components.

**Acceptance criteria:**

- Components exist for Button, TextInput, Screen, Card, LoadingState, EmptyState, ErrorState, Badge, Avatar, BottomSheet/Modal wrapper.
- Components are typed.
- Components are documented with examples.
- Feature screens use shared primitives.
- No duplicate button/input/card implementations.

**Out of scope:**

- Final visual branding.
- Complex animations.

---

#### P0-E04-T03 — Set up mobile state management foundations

**Issue type:** Task  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P0-E04-T01, P0-E02-T01  
**Can run in parallel with:** P0-E03-T03

**Description:**  
Set up TanStack Query for server state, Zustand for local app state, and React Hook Form/Zod integration.

**Acceptance criteria:**

- TanStack Query provider configured.
- Query client defaults defined.
- Zustand store pattern documented.
- React Hook Form with Zod resolver working in sample form.
- Example booking draft store created.
- No Redux added.
- Documentation explains when to use TanStack Query vs Zustand.

**Out of scope:**

- Full booking implementation.

---

### Epic P0-E05 — Admin App Shell & Design System Foundation

#### P0-E05-T01 — Set up Next.js admin dashboard shell

**Issue type:** Task  
**Owner stream:** Admin  
**Priority:** Highest  
**Dependencies:** P0-E01-T01  
**Can run in parallel with:** P0-E04-T01, P0-E03-T02

**Description:**  
Create the Next.js admin dashboard app with TypeScript, routing structure, Tailwind, shadcn/ui, and authenticated/admin route grouping.

**Acceptance criteria:**

- Next.js app runs locally.
- Tailwind configured.
- shadcn/ui configured.
- Admin route structure exists.
- Shared packages can be imported.
- No admin-only functionality is exposed without auth guard placeholder.

**Out of scope:**

- Real admin data screens.

---

#### P0-E05-T02 — Create admin layout and shared admin components

**Issue type:** Task  
**Owner stream:** Admin  
**Priority:** High  
**Dependencies:** P0-E05-T01  
**Can run in parallel with:** P0-E04-T02

**Description:**  
Create reusable admin dashboard components.

**Acceptance criteria:**

- Admin shell layout exists with sidebar/header/content area.
- Components exist for DataTable wrapper, StatusBadge, PageHeader, DetailPanel, ConfirmDialog, LoadingState, EmptyState, ErrorState.
- Components are typed.
- Components can use mock data.
- No duplicate table/status badge patterns.

**Out of scope:**

- Real API integration.

---

## Phase 1 — Auth, Profiles, Onboarding & Services

### Epic P1-E01 — Authentication & Role-Based Access

#### P1-E01-T01 — Implement Supabase Auth integration in mobile

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** Highest  
**Dependencies:** P0-E04-T01, P0-E03-T03  
**Can run in parallel with:** P1-E01-T02, P1-E02-T01

**Description:**  
Implement mobile login/signup/logout using Supabase Auth.

**Acceptance criteria:**

- Client/barber can sign up.
- User can log in.
- User can log out.
- Auth session persists.
- App routes based on auth state.
- Failed auth attempts show safe user-friendly errors.
- No auth secrets exposed.
- Loading states exist during auth checks.

**Out of scope:**

- Full profile completion flow.
- Stripe Connect onboarding.

---

#### P1-E01-T02 — Implement admin authentication and admin route guard

**Issue type:** Story  
**Owner stream:** Admin  
**Priority:** Highest  
**Dependencies:** P0-E05-T01, P0-E03-T03  
**Can run in parallel with:** P1-E01-T01

**Description:**  
Implement admin login and protect all admin routes from non-admin users.

**Acceptance criteria:**

- Admin login works.
- Non-admin users cannot access admin routes.
- Admin role is checked server-side or through trusted secure mechanism.
- Unauthorized users see safe error/redirect.
- No admin data is fetched before admin role is verified.
- Auth guard is reusable.

**Out of scope:**

- Admin dashboard feature pages.

---

#### P1-E01-T03 — Implement profile creation/sync Edge Function

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P0-E02-T02, P0-E03-T03  
**Can run in parallel with:** P1-E02-T01

**Description:**  
Create Edge Function to safely create or sync a user profile after authentication.

**Acceptance criteria:**

- Function validates authenticated user.
- Function creates profile if missing.
- Function does not trust frontend-provided user ID.
- Function assigns allowed role only from validated input.
- Function is idempotent.
- Audit log is created for profile creation.
- Errors are typed and safe.

**Out of scope:**

- Client/barber profile completion forms.

---

### Epic P1-E02 — Client Onboarding

#### P1-E02-T01 — Build client profile onboarding screen

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P1-E01-T01, P0-E04-T02  
**Can run in parallel with:** P1-E03-T01

**Description:**  
Build the client onboarding flow for basic profile details without Stripe Identity at launch.

**Acceptance criteria:**

- Client can enter required profile fields.
- Form uses React Hook Form and Zod.
- Invalid data is rejected.
- Loading/error states exist.
- Profile is saved securely.
- User cannot proceed until required fields are completed.
- Architecture includes fields/statuses that can support Stripe Identity later.

**Out of scope:**

- Stripe Identity verification.
- Payment method setup.

---

#### P1-E02-T02 — Build client address management

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P1-E02-T01, P0-E03-T02  
**Can run in parallel with:** P1-E03-T02

**Description:**  
Allow clients to add and manage service addresses.

**Acceptance criteria:**

- Client can add address.
- Client can select current location where permission is granted.
- Address form validates required fields.
- Address data is private to the client.
- Client can select address during booking draft.
- App handles location permission denial gracefully.
- No address data leaks to unrelated barbers.

**Out of scope:**

- Google Places autocomplete unless explicitly included in this ticket by the team.
- Booking submission.

---

### Epic P1-E03 — Barber Onboarding, Profile & Verification

#### P1-E03-T01 — Build barber profile onboarding flow

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P1-E01-T01, P0-E04-T02  
**Can run in parallel with:** P1-E02-T01, P1-E04-T01

**Description:**  
Build barber onboarding for profile details, profile photo, service area, and travel radius.

**Acceptance criteria:**

- Barber can complete profile.
- Barber can upload profile photo.
- Barber can set service area for scheduled bookings.
- Barber can set default radius.
- Form uses React Hook Form and Zod.
- Invalid data is rejected.
- Data is stored securely.
- Public/private barber profile fields are separated.

**Out of scope:**

- Stripe Connect onboarding.
- Service/pricing setup.

---

#### P1-E03-T02 — Implement Stripe Connect onboarding link function

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P1-E01-T03  
**Can run in parallel with:** P1-E03-T01

**Description:**  
Create Edge Function to create Stripe Connect onboarding links for barbers.

**Acceptance criteria:**

- Function requires authenticated barber.
- Function creates/uses Stripe connected account.
- Function returns onboarding URL.
- Function does not expose Stripe secret key.
- Function stores Stripe connected account ID securely.
- Function is idempotent where practical.
- Audit log is created.
- Errors are safe and typed.

**Out of scope:**

- Stripe webhook processing.
- Payout transfers.

---

#### P1-E03-T03 — Build barber Stripe Connect onboarding UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P1-E03-T02, P1-E03-T01  
**Can run in parallel with:** P1-E04-T01

**Description:**  
Allow barbers to start/resume Stripe Connect onboarding from the mobile app.

**Acceptance criteria:**

- Barber can tap to start onboarding.
- App opens hosted onboarding URL.
- Barber sees onboarding status.
- App handles incomplete onboarding.
- App handles errors gracefully.
- Barber cannot receive paid bookings until onboarding requirements are satisfied unless explicitly allowed by config.

**Out of scope:**

- Manual admin verification approval.

---

#### P1-E03-T04 — Implement Stripe Connect status refresh/webhook foundation

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P1-E03-T02  
**Can run in parallel with:** P1-E03-T03

**Description:**  
Create backend support to refresh and store barber Stripe Connect onboarding status.

**Acceptance criteria:**

- Function can refresh connected account status.
- Relevant verification fields are stored.
- Barber verification status is updated.
- Admin can later view this status.
- No Stripe secrets exposed.
- Audit log records important status changes.

**Out of scope:**

- Full payments webhook.

---

### Epic P1-E04 — Service Categories & Barber Pricing

#### P1-E04-T01 — Implement service category admin management backend

**Issue type:** Task  
**Owner stream:** Backend/Admin  
**Priority:** High  
**Dependencies:** P0-E03-T02, P0-E02-T02  
**Can run in parallel with:** P1-E03-T01

**Description:**  
Create backend/admin capability for global service categories.

**Acceptance criteria:**

- Admin can create service category.
- Admin can update service category.
- Admin can archive service category.
- Non-admins cannot manage global categories.
- Categories support display order and active/archived state.
- Audit logs are created for admin changes.

**Out of scope:**

- Barber pricing UI.

---

#### P1-E04-T02 — Build barber service and pricing setup screen

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P1-E03-T01, P1-E04-T01  
**Can run in parallel with:** P2-E01-T01

**Description:**  
Allow barbers to select offered service categories and set their own prices.

**Acceptance criteria:**

- Barber can view active service categories.
- Barber can enable/disable services they offer.
- Barber can set price per service.
- Prices are validated.
- Existing bookings are not affected by price changes.
- Form uses shared schemas.
- No duplicate pricing constants.

**Out of scope:**

- Booking price snapshot implementation.

---

#### P1-E04-T03 — Build client barber profile view with services/pricing

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** Medium  
**Dependencies:** P1-E04-T02  
**Can run in parallel with:** P2-E02-T01

**Description:**  
Allow clients to view barber profiles, services, prices, ratings placeholder, and service area basics.

**Acceptance criteria:**

- Client can open barber profile.
- Profile shows public barber details only.
- Services and prices are displayed.
- Private data is not exposed.
- Loading/error/empty states exist.
- Screen can run with mock data.

**Out of scope:**

- Reviews implementation.
- Booking request submission.

---

## Phase 2 — Available Now, Discovery & Booking Requests

### Epic P2-E01 — Available Now Barber Flow

#### P2-E01-T01 — Implement Available Now session schema helpers and queries

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P0-E03-T02, P1-E03-T01  
**Can run in parallel with:** P1-E04-T02

**Description:**  
Implement database helper queries and functions for Available Now sessions.

**Acceptance criteria:**

- Barber can have only one active Available Now session.
- Session stores location, radius, available-until, status, and source of location.
- Queries use PostGIS.
- Expired sessions are excluded from discovery.
- Busy/disabled sessions are excluded from discovery.
- Relevant indexes exist.
- No client-side filtering of all barbers.

**Out of scope:**

- Mobile toggle UI.

---

#### P2-E01-T02 — Build barber Available Now toggle UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** Highest  
**Dependencies:** P2-E01-T01, P1-E03-T01  
**Can run in parallel with:** P2-E02-T01

**Description:**  
Allow barber to go Available Now with GPS/manual location, radius, and available-until time.

**Acceptance criteria:**

- Barber can toggle Available Now on.
- Barber can toggle Available Now off.
- Barber can use GPS location.
- Barber can set radius.
- Barber can set available-until time.
- Permission denial is handled.
- Active session status is visible.
- UI uses shared components.

**Out of scope:**

- Booking request acceptance.
- ETA tracking.

---

#### P2-E01-T03 — Implement auto-disable rules for Available Now

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P2-E01-T01  
**Can run in parallel with:** P2-E02-T02

**Description:**  
Implement rules to auto-disable Available Now sessions.

**Acceptance criteria:**

- Session disables after available-until.
- Session disables after configured missed request threshold.
- Session disables when barber accepts an Available Now booking.
- Session can be manually disabled.
- Status transition is audit logged.
- Config values are not hardcoded deep in feature logic.

**Out of scope:**

- Cron scheduling infrastructure beyond what is required for this rule.

---

### Epic P2-E02 — Client Discovery, Filtering & Barber Browsing

#### P2-E02-T01 — Implement nearby barber search Edge Function

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P1-E04-T02, P2-E01-T01  
**Can run in parallel with:** P2-E01-T02

**Description:**  
Create Edge Function for clients to search barbers by location, service type, booking type, radius, rating placeholder, and availability.

**Acceptance criteria:**

- Function validates client request.
- Search supports Available Now.
- Search supports Scheduled/service area.
- Search filters by service category.
- Search returns only public barber data.
- Query uses PostGIS and appropriate filters.
- Results are paginated or limited.
- No private data leaks.
- No over-fetching.

**Out of scope:**

- Map UI.
- Review/rating implementation beyond placeholder.

---

#### P2-E02-T02 — Build client discovery filters UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P1-E04-T02, P0-E04-T03  
**Can run in parallel with:** P2-E02-T01

**Description:**  
Build UI for clients to choose service type, Available Now vs Schedule Later, location, and filters.

**Acceptance criteria:**

- Client can choose booking mode.
- Client can choose service type.
- Client can select address/current location.
- Filters are stored in local state through Zustand.
- Invalid filter states are prevented.
- UI uses shared components.
- Mock data mode exists.

**Out of scope:**

- Real map rendering.

---

#### P2-E02-T03 — Build client barber results list/swipe view

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P2-E02-T01, P2-E02-T02  
**Can run in parallel with:** P2-E03-T01

**Description:**  
Show matching barbers in list/swipe-style browsing view.

**Acceptance criteria:**

- Results load via TanStack Query.
- Loading/error/empty states exist.
- Barber card shows public profile, distance, selected service price, and status.
- User can open barber profile.
- Query invalidation/refetch works when filters change.
- No unnecessary re-renders.

**Out of scope:**

- Map view.
- Booking request submission.

---

#### P2-E02-T04 — Build client map view of nearby barbers

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** Medium  
**Dependencies:** P2-E02-T01, P2-E02-T02  
**Can run in parallel with:** P2-E03-T01

**Description:**  
Display nearby barbers on a map with selected filters.

**Acceptance criteria:**

- Map renders user/service location.
- Map renders returned barber locations appropriately.
- Barber markers do not expose private exact location where not appropriate.
- User can select a barber from the map.
- Handles missing location permissions.
- Avoids excessive refetching while moving the map.

**Out of scope:**

- Live tracking.
- On-the-way ETA.

---

### Epic P2-E03 — Booking Request Flow

#### P2-E03-T01 — Implement create booking request Edge Function

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P0-E02-T02, P1-E04-T02, P2-E02-T01  
**Can run in parallel with:** P2-E02-T03

**Description:**  
Create Edge Function for clients to submit Available Now or Scheduled booking requests.

**Acceptance criteria:**

- Function validates authenticated client.
- Function validates selected barber/service/address.
- Function checks client has no conflicting active request.
- Function creates booking request.
- Function creates initial booking/payment records as needed.
- Function creates price snapshot.
- Function snapshots commission percentage.
- Function triggers payment authorisation flow if payment method is ready.
- Function sends barber notification.
- Function is idempotent or protected against double-submit.
- Audit log is created.

**Out of scope:**

- Payment capture.
- Barber acceptance UI.

---

#### P2-E03-T02 — Build client booking request submission UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** Highest  
**Dependencies:** P2-E03-T01, P2-E02-T03  
**Can run in parallel with:** P2-E03-T03

**Description:**  
Allow client to submit a booking request from a selected barber/service.

**Acceptance criteria:**

- Client can review selected service, price, address, and barber.
- Client can submit request.
- Double taps do not create duplicate requests.
- Loading/error states exist.
- Pending request state is shown.
- Request expiry is shown.
- UI handles declined/expired states.

**Out of scope:**

- Stripe payment method UI if not ready.
- Completion flow.

---

#### P2-E03-T03 — Implement barber request inbox backend query

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P2-E03-T01  
**Can run in parallel with:** P2-E03-T02

**Description:**  
Create secure query/function for barbers to view pending requests.

**Acceptance criteria:**

- Barber sees only requests sent to them.
- Barber can see distance, service, price snapshot, booking type, and expiry.
- Barber cannot see unrelated client private data.
- Expired/cancelled requests are excluded or clearly marked.
- Query is efficient and filtered.

**Out of scope:**

- Acceptance/decline actions.

---

#### P2-E03-T04 — Build barber booking request inbox UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P2-E03-T03  
**Can run in parallel with:** P2-E04-T01

**Description:**  
Allow barber to view incoming booking requests.

**Acceptance criteria:**

- Barber sees pending Available Now and Scheduled requests.
- Request cards show relevant decision info.
- Expiry countdown is shown.
- Loading/error/empty states exist.
- UI supports multiple pending requests.
- UI makes clear barber can only accept one active Available Now request at a time.

**Out of scope:**

- Accept/decline action implementation.

---

### Epic P2-E04 — Accept, Decline & Expiry

#### P2-E04-T01 — Implement accept booking request Edge Function

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P2-E03-T01  
**Can run in parallel with:** P2-E03-T04

**Description:**  
Create Edge Function for barber to accept a booking request.

**Acceptance criteria:**

- Function validates authenticated barber.
- Function verifies request belongs to barber.
- Function verifies request is still pending and not expired.
- Function enforces only one accepted active Available Now job.
- Function captures authorised payment.
- Function updates booking status safely.
- Function marks other conflicting Available Now requests appropriately.
- Function updates Available Now session to busy/disabled where required.
- Function sends client notification.
- Function is concurrency-safe.
- Audit log is created.

**Out of scope:**

- Stripe webhook handling if separated into payment phase.

---

#### P2-E04-T02 — Implement decline booking request Edge Function

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P2-E03-T01  
**Can run in parallel with:** P2-E04-T01

**Description:**  
Create Edge Function for barber to decline a pending booking request.

**Acceptance criteria:**

- Function validates authenticated barber.
- Function verifies request belongs to barber.
- Function updates request status to declined.
- Function cancels payment authorisation where applicable.
- Function notifies client.
- Function records missed/declined metrics appropriately.
- Audit log is created.

**Out of scope:**

- Reliability penalties for accepted-job cancellation.

---

#### P2-E04-T03 — Build barber accept/decline UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P2-E04-T01, P2-E04-T02, P2-E03-T04  
**Can run in parallel with:** P3-E01-T01

**Description:**  
Allow barbers to accept or decline booking requests from the mobile app.

**Acceptance criteria:**

- Barber can accept request.
- Barber can decline request.
- Buttons are disabled while request is processing.
- Expired requests cannot be accepted.
- Success/error states are clear.
- Booking list refreshes after action.
- Double taps do not cause duplicate operations.

**Out of scope:**

- On-the-way flow.
- Completion flow.

---

#### P2-E04-T04 — Implement request expiry jobs/functions

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P2-E03-T01  
**Can run in parallel with:** P2-E04-T03

**Description:**  
Expire Available Now requests after 5 minutes and Scheduled requests after 2 hours.

**Acceptance criteria:**

- Available Now pending requests expire after 5 minutes.
- Scheduled pending requests expire after 2 hours.
- Payment authorisations are cancelled on expiry.
- Client and barber are notified where appropriate.
- Expiry action is idempotent.
- Audit log is created.
- Missed request counts are updated where appropriate.

**Out of scope:**

- Full notification preferences.

---

## Phase 3 — Payments, Earnings, Cancellations & Payouts

### Epic P3-E01 — Stripe Payment Authorisation and Capture

#### P3-E01-T01 — Implement payment authorisation service

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P2-E03-T01  
**Can run in parallel with:** P2-E04-T03

**Description:**  
Implement Stripe PaymentIntent manual capture flow for booking request payment authorisation.

**Acceptance criteria:**

- Server creates PaymentIntent.
- Manual capture is used.
- Amount is calculated server-side from booking price snapshot.
- Commission is calculated server-side.
- Frontend cannot override amount.
- Payment records are created/updated.
- Errors are handled safely.
- Idempotency keys are used where appropriate.

**Out of scope:**

- Payout transfers.

---

#### P3-E01-T02 — Implement Stripe payment capture on barber acceptance

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P3-E01-T01, P2-E04-T01  
**Can run in parallel with:** P3-E02-T01

**Description:**  
Capture authorised payment when barber accepts a request.

**Acceptance criteria:**

- Capture uses Stripe PaymentIntent capture.
- Capture is triggered only when request is valid and accepted.
- Payment cannot be captured twice.
- Failed capture returns booking/request to safe state.
- Booking status updates only through trusted backend logic.
- Client and barber are notified on success/failure.
- Audit log is created.

**Out of scope:**

- Refunds.

---

#### P3-E01-T03 — Implement Stripe webhook handler

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P3-E01-T01  
**Can run in parallel with:** P3-E02-T01

**Description:**  
Create Edge Function to handle Stripe webhooks.

**Acceptance criteria:**

- Webhook signature is verified.
- Relevant events update payment records.
- Duplicate webhook events are handled idempotently.
- No frontend confirmation is trusted as source of payment truth.
- Failures are logged safely.
- Webhook secret is server-only.
- Audit log is created for important state changes.

**Out of scope:**

- Full payout batch processing.

---

### Epic P3-E02 — Barber Earnings and Balance

#### P3-E02-T01 — Implement barber earnings creation

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P3-E01-T02  
**Can run in parallel with:** P3-E01-T03

**Description:**  
Create barber earning record after payment capture.

**Acceptance criteria:**

- Earning starts as `pending`.
- Earning uses booking price snapshot.
- Platform commission is snapshotted.
- Barber net amount is calculated server-side.
- Financial values use integer cents.
- Earning cannot be duplicated.
- Audit log is created.

**Out of scope:**

- Releasing earnings to available.
- Bank payout.

---

#### P3-E02-T02 — Build barber earnings/balance screen

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** Medium  
**Dependencies:** P3-E02-T01  
**Can run in parallel with:** P4-E01-T01

**Description:**  
Show barber earnings summary in the mobile app.

**Acceptance criteria:**

- Barber sees pending balance.
- Barber sees available balance.
- Barber sees paid out balance.
- Barber sees recent earnings list.
- Barber cannot see other barbers' earnings.
- Loading/error/empty states exist.
- Values are formatted consistently.

**Out of scope:**

- Manual withdrawal.
- Full payout management.

---

### Epic P3-E03 — Cancellation and Refund Rules

#### P3-E03-T01 — Implement booking cancellation backend rules

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P3-E01-T03, P2-E04-T01  
**Can run in parallel with:** P3-E02-T02

**Description:**  
Implement cancellation rules for Available Now and Scheduled bookings.

**Acceptance criteria:**

- Client can cancel before barber accepts without penalty.
- Payment authorisation is cancelled before acceptance.
- Future bookings more than 12 hours out can be cancelled without punishment.
- Within 12 hours, cancellation still allowed but consequences apply.
- Client cancellation after acceptance calculates partial refund and barber inconvenience fee.
- Barber cancellation after acceptance triggers full refund and reliability event.
- Rules are config-driven where appropriate.
- Admin override is possible later.
- Audit log is created.

**Out of scope:**

- Admin refund UI.

---

#### P3-E03-T02 — Build client cancellation UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P3-E03-T01  
**Can run in parallel with:** P3-E03-T03

**Description:**  
Allow clients to cancel bookings according to configured rules.

**Acceptance criteria:**

- Client can cancel eligible booking.
- UI explains refund/fee before confirmation.
- Client sees warning for partial refund.
- Client cannot bypass rules.
- Cancellation result is clear.
- Booking list refreshes.

**Out of scope:**

- Admin refunds.
- Barber cancellation UI.

---

#### P3-E03-T03 — Build barber cancellation UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P3-E03-T01  
**Can run in parallel with:** P3-E03-T02

**Description:**  
Allow barbers to cancel bookings according to configured rules.

**Acceptance criteria:**

- Barber can cancel eligible booking.
- UI explains consequence before confirmation.
- Late/accepted cancellation creates reliability event.
- Barber sees clear result.
- Booking list refreshes.

**Out of scope:**

- Reliability dashboard.

---

### Epic P3-E04 — Payout Batches

#### P3-E04-T01 — Implement payout batch data model and queueing

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Medium  
**Dependencies:** P3-E02-T01  
**Can run in parallel with:** P4-E01-T01

**Description:**  
Implement data model and backend functions for grouping available earnings into payout batches.

**Acceptance criteria:**

- Available earnings can be queued into payout batch.
- Earnings move to `queued_for_payout`.
- Payout batch has status.
- Batch creation is idempotent.
- Actual Stripe transfer/payout can be stubbed if needed.
- Audit log is created.

**Out of scope:**

- Full production payout automation unless approved.

---

#### P3-E04-T02 — Implement configurable payout schedule placeholder

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Low  
**Dependencies:** P3-E04-T01  
**Can run in parallel with:** P5 admin tickets

**Description:**  
Add configuration and placeholder job structure for scheduled payouts.

**Acceptance criteria:**

- Payout day is config-driven.
- Job can identify eligible earnings.
- Job does not double-process earnings.
- Job logs result.
- Manual admin trigger can be added later.

**Out of scope:**

- Complex accounting reports.
- Tax reports.

---

## Phase 4 — Booking Lifecycle, ETA, Completion, Disputes & Reviews

### Epic P4-E01 — Confirmed Booking Views

#### P4-E01-T01 — Build client booking list/detail screens

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P2-E04-T01, P3-E01-T02  
**Can run in parallel with:** P4-E01-T02

**Description:**  
Build client screens to view pending, confirmed, active, completed, cancelled, and disputed bookings.

**Acceptance criteria:**

- Client sees own bookings only.
- Booking detail shows current status.
- Payment/cancellation/completion states are clear.
- Loading/error/empty states exist.
- Screen uses shared components.
- Data fetched with TanStack Query.

**Out of scope:**

- Admin booking detail.

---

#### P4-E01-T02 — Build barber booking list/detail screens

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P2-E04-T01, P3-E01-T02  
**Can run in parallel with:** P4-E01-T01

**Description:**  
Build barber screens to view pending, confirmed, active, completed, cancelled, and disputed bookings.

**Acceptance criteria:**

- Barber sees own bookings only.
- Booking detail shows current status.
- Client private data is only shown when appropriate.
- Action buttons reflect current allowed actions.
- Loading/error/empty states exist.
- Data fetched with TanStack Query.

**Out of scope:**

- Admin booking detail.

---

### Epic P4-E02 — On My Way and ETA

#### P4-E02-T01 — Implement mark on the way Edge Function

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P4-E01-T02  
**Can run in parallel with:** P4-E02-T02

**Description:**  
Allow barber to mark a confirmed booking as on the way.

**Acceptance criteria:**

- Function validates barber owns booking.
- Booking must be in valid status.
- Status changes to `on_the_way`.
- Initial barber location is captured.
- ETA calculation is triggered.
- Client notification is sent.
- Audit log is created.

**Out of scope:**

- Continuous ETA refresh.

---

#### P4-E02-T02 — Build barber On My Way UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P4-E01-T02  
**Can run in parallel with:** P4-E02-T01

**Description:**  
Allow barber to tap “I’m on my way” from booking detail.

**Acceptance criteria:**

- Button visible only when action is allowed.
- Permission request is handled.
- Loading/error states exist.
- Success updates booking state.
- App does not start full live tracking.

**Out of scope:**

- Full background tracking.

---

#### P4-E02-T03 — Implement ETA update function

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P4-E02-T01  
**Can run in parallel with:** P4-E02-T04

**Description:**  
Calculate and update ETA using Google Routes API at controlled intervals.

**Acceptance criteria:**

- Function validates barber and booking.
- Function calls Google Routes from backend only.
- Google API key is not exposed to client.
- ETA and last-updated timestamp are stored.
- Updates are throttled.
- Function stops updating inactive bookings.
- Errors are logged safely.

**Out of scope:**

- Uber-style live map tracking.

---

#### P4-E02-T04 — Build client ETA display

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** Medium  
**Dependencies:** P4-E01-T01, P4-E02-T01  
**Can run in parallel with:** P4-E02-T03

**Description:**  
Show client the barber's on-the-way ETA and last updated time.

**Acceptance criteria:**

- Client sees ETA when booking is on the way.
- Client sees last updated timestamp.
- UI handles stale ETA.
- UI handles ETA unavailable.
- No exact live tracking is implied if not supported.

**Out of scope:**

- Live moving barber marker.

---

### Epic P4-E03 — Completion and Auto-Completion

#### P4-E03-T01 — Implement barber mark job complete function

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P4-E01-T02, P3-E02-T01  
**Can run in parallel with:** P4-E03-T02

**Description:**  
Allow barber to mark a job complete, starting the 1-hour client response window.

**Acceptance criteria:**

- Function validates barber owns booking.
- Booking status changes to `completed_by_barber`.
- Client response deadline is recorded.
- Client notification is sent.
- Earning remains pending until completion rule resolves.
- Audit log is created.

**Out of scope:**

- Auto-complete job runner.

---

#### P4-E03-T02 — Build barber mark job complete UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P4-E01-T02  
**Can run in parallel with:** P4-E03-T01

**Description:**  
Allow barber to mark booking as complete from booking detail.

**Acceptance criteria:**

- Button appears only when allowed.
- Confirmation dialog prevents accidental completion.
- Success state shown.
- Client response window messaging is clear.
- Booking refreshes.

**Out of scope:**

- Client confirmation UI.

---

#### P4-E03-T03 — Implement client confirm completion / dispute function

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Highest  
**Dependencies:** P4-E03-T01  
**Can run in parallel with:** P4-E03-T04

**Description:**  
Allow client to confirm job done or open dispute within the response window.

**Acceptance criteria:**

- Function validates client owns booking.
- Client can confirm completion.
- Client can open dispute.
- Confirm completion releases barber earning to available.
- Dispute keeps earning pending.
- Function handles client confirming before barber marks complete.
- Audit log is created.

**Out of scope:**

- Admin dispute resolution.

---

#### P4-E03-T04 — Build client completion confirmation UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P4-E01-T01  
**Can run in parallel with:** P4-E03-T03

**Description:**  
Allow client to confirm job done or raise an issue.

**Acceptance criteria:**

- Client sees completion prompt when relevant.
- Client can mark job done.
- Client can report issue.
- UI explains 1-hour response window.
- Loading/error states exist.
- Booking refreshes.

**Out of scope:**

- Admin dispute management.

---

#### P4-E03-T05 — Implement auto-completion jobs

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P4-E03-T01, P4-E03-T03  
**Can run in parallel with:** P4-E04-T01

**Description:**  
Implement auto-completion logic for two cases: barber-completed timeout and neither-party-completed final warning flow.

**Acceptance criteria:**

- If barber marks complete and client does nothing for 1 hour, booking auto-completes.
- If neither party marks complete after 6 hours, final prompt is sent.
- After final prompt, client has 1 additional hour to dispute.
- If no dispute, booking auto-completes.
- Earning moves from pending to available only on completion.
- Jobs are idempotent.
- Audit logs are created.

**Out of scope:**

- Actual bank payout.

---

### Epic P4-E04 — Disputes

#### P4-E04-T01 — Implement dispute creation backend

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P4-E03-T03  
**Can run in parallel with:** P4-E03-T05

**Description:**  
Create dispute record when client reports an issue.

**Acceptance criteria:**

- Dispute is linked to booking.
- Dispute can only be created by booking client or admin.
- Booking status changes to disputed.
- Barber earning remains pending.
- Admin notification/visibility is supported.
- Audit log is created.

**Out of scope:**

- Admin resolution UI.

---

#### P4-E04-T02 — Build dispute issue form

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** Medium  
**Dependencies:** P4-E04-T01  
**Can run in parallel with:** P5-E03-T01

**Description:**  
Allow client to submit issue details when disputing completion.

**Acceptance criteria:**

- Form validates required issue details.
- Client can submit dispute.
- User receives clear confirmation.
- Booking status updates.
- No duplicate disputes are created.

**Out of scope:**

- File/photo evidence unless explicitly approved.

---

### Epic P4-E05 — Reviews and Ratings

#### P4-E05-T01 — Implement review creation backend

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** Medium  
**Dependencies:** P4-E03-T03  
**Can run in parallel with:** P4-E05-T02

**Description:**  
Allow clients to review barbers after completed bookings.

**Acceptance criteria:**

- Review can only be created for completed booking.
- Client can only review their own booking.
- One review per booking.
- Rating is validated.
- Review contributes to barber rating aggregate safely.
- Admin can later moderate visibility.
- Audit log is created.

**Out of scope:**

- Advanced moderation.

---

#### P4-E05-T02 — Build client review UI

**Issue type:** Story  
**Owner stream:** Mobile  
**Priority:** Medium  
**Dependencies:** P4-E03-T04  
**Can run in parallel with:** P4-E05-T01

**Description:**  
Allow client to leave rating and review after booking completion.

**Acceptance criteria:**

- Client sees review prompt after completion.
- Client can submit rating.
- Optional review text is validated.
- Loading/error/success states exist.
- Duplicate review is prevented.

**Out of scope:**

- Barber response to review.

---

## Phase 5 — Admin Dashboard

### Epic P5-E01 — Admin Overview and Users

#### P5-E01-T01 — Build admin dashboard overview page

**Issue type:** Story  
**Owner stream:** Admin  
**Priority:** High  
**Dependencies:** P0-E05-T02, P0-E03-T04  
**Can run in parallel with:** P5-E01-T02

**Description:**  
Create admin overview page with key operational metrics.

**Acceptance criteria:**

- Shows total users, barbers, bookings, active disputes, payment statuses.
- Queries are filtered and efficient.
- Date range filter exists where relevant.
- Loading/error/empty states exist.
- Admin-only access enforced.

**Out of scope:**

- Advanced analytics.

---

#### P5-E01-T02 — Build admin clients list/detail

**Issue type:** Story  
**Owner stream:** Admin  
**Priority:** High  
**Dependencies:** P1-E01-T02  
**Can run in parallel with:** P5-E01-T03

**Description:**  
Allow admins to view client list and detail safely.

**Acceptance criteria:**

- Admin can search/filter clients.
- Admin can view client booking history.
- Sensitive data is shown only to admins.
- Pagination exists.
- No over-fetching.
- Admin route is protected.

**Out of scope:**

- Editing client data unless approved.

---

#### P5-E01-T03 — Build admin barbers list/detail

**Issue type:** Story  
**Owner stream:** Admin  
**Priority:** High  
**Dependencies:** P1-E01-T02, P1-E03-T04  
**Can run in parallel with:** P5-E01-T02

**Description:**  
Allow admins to view barber list, detail, services, verification, reliability, and bookings.

**Acceptance criteria:**

- Admin can search/filter barbers.
- Admin can view verification status.
- Admin can view Stripe Connect status.
- Admin can view reliability level/events.
- Admin can view services/pricing.
- Pagination exists.
- Admin route is protected.

**Out of scope:**

- Manual barber suspension unless separate ticket.

---

### Epic P5-E02 — Admin Booking Management

#### P5-E02-T01 — Build admin bookings list/detail

**Issue type:** Story  
**Owner stream:** Admin  
**Priority:** Highest  
**Dependencies:** P4-E01-T01, P4-E01-T02  
**Can run in parallel with:** P5-E01-T03

**Description:**  
Allow admins to view and inspect bookings.

**Acceptance criteria:**

- Admin can search/filter bookings by status, type, date, client, barber.
- Admin can view booking status history.
- Admin can view payment status.
- Admin can view earning status.
- Admin can view cancellation/dispute status.
- Pagination exists.
- Admin route is protected.

**Out of scope:**

- Admin status override actions.

---

#### P5-E02-T02 — Implement admin booking status override function

**Issue type:** Task  
**Owner stream:** Backend/Admin  
**Priority:** High  
**Dependencies:** P5-E02-T01  
**Can run in parallel with:** P5-E03-T01

**Description:**  
Create carefully protected admin-only function for booking status overrides where operationally required.

**Acceptance criteria:**

- Function requires admin.
- Function validates allowed transitions.
- Function records reason.
- Function creates audit log.
- Function does not bypass financial rules silently.
- Function returns safe typed errors.

**Out of scope:**

- Refund processing unless explicitly part of action.

---

### Epic P5-E03 — Admin Disputes and Refunds

#### P5-E03-T01 — Build admin disputes list/detail

**Issue type:** Story  
**Owner stream:** Admin  
**Priority:** Highest  
**Dependencies:** P4-E04-T01  
**Can run in parallel with:** P5-E02-T01

**Description:**  
Allow admins to view and investigate disputes.

**Acceptance criteria:**

- Admin can view open disputes.
- Admin can view linked booking.
- Admin can view client/barber details required for investigation.
- Admin can filter by status.
- Admin route is protected.
- No non-admin access.

**Out of scope:**

- Resolution actions.

---

#### P5-E03-T02 — Implement admin dispute resolution function

**Issue type:** Task  
**Owner stream:** Backend/Admin  
**Priority:** Highest  
**Dependencies:** P5-E03-T01, P3-E03-T01  
**Can run in parallel with:** P5-E04-T01

**Description:**  
Allow admin to resolve dispute with full refund, partial refund, barber paid, or custom operational outcome.

**Acceptance criteria:**

- Function requires admin.
- Admin must provide resolution reason.
- Refunds use server-side calculated values.
- Barber earning status updates appropriately.
- Booking status updates appropriately.
- Audit log is created.
- Stripe refund action is idempotent where possible.
- Errors are safe and visible to admin.

**Out of scope:**

- Automated dispute decisions.

---

#### P5-E03-T03 — Build admin dispute resolution UI

**Issue type:** Story  
**Owner stream:** Admin  
**Priority:** High  
**Dependencies:** P5-E03-T02  
**Can run in parallel with:** P5-E04-T01

**Description:**  
Allow admin to resolve disputes through the dashboard.

**Acceptance criteria:**

- Admin can choose resolution outcome.
- Admin must enter reason.
- UI shows financial impact before confirmation.
- Confirmation dialog exists.
- Result updates dispute/booking/payment state.
- Errors are displayed safely.

**Out of scope:**

- Complex support ticketing system.

---

### Epic P5-E04 — Admin Payments, Earnings and Payouts

#### P5-E04-T01 — Build admin payments and earnings views

**Issue type:** Story  
**Owner stream:** Admin  
**Priority:** High  
**Dependencies:** P3-E02-T01  
**Can run in parallel with:** P5-E03-T02

**Description:**  
Allow admins to inspect payments, earnings, refunds, and payout states.

**Acceptance criteria:**

- Admin can view payments.
- Admin can view barber earnings.
- Admin can view payout batches.
- Admin can filter by date/status.
- Values are formatted correctly.
- Data is paginated.
- Admin route is protected.

**Out of scope:**

- Manual payout execution unless separate ticket.

---

#### P5-E04-T02 — Build admin payout batch management

**Issue type:** Story  
**Owner stream:** Admin  
**Priority:** Medium  
**Dependencies:** P3-E04-T01, P5-E04-T01  
**Can run in parallel with:** P6 tickets

**Description:**  
Allow admins to view payout batches and queued earnings.

**Acceptance criteria:**

- Admin can view payout batches.
- Admin can view batch items.
- Admin can see failed/paid/queued statuses.
- Admin can see totals.
- Admin route is protected.
- No bank payout secrets are exposed.

**Out of scope:**

- Advanced accounting export.

---

### Epic P5-E05 — Admin Service Categories and Reviews

#### P5-E05-T01 — Build admin service category management UI

**Issue type:** Story  
**Owner stream:** Admin  
**Priority:** Medium  
**Dependencies:** P1-E04-T01  
**Can run in parallel with:** P5-E04-T01

**Description:**  
Build UI for admins to manage service categories.

**Acceptance criteria:**

- Admin can create category.
- Admin can update category.
- Admin can archive category.
- Validation exists.
- Audit logs are created through backend.
- Admin route is protected.

**Out of scope:**

- Barber-specific pricing.

---

#### P5-E05-T02 — Build admin reviews view/moderation placeholder

**Issue type:** Story  
**Owner stream:** Admin  
**Priority:** Low  
**Dependencies:** P4-E05-T01  
**Can run in parallel with:** P6 polish tickets

**Description:**  
Allow admins to view reviews and hide/unhide if needed.

**Acceptance criteria:**

- Admin can view reviews.
- Admin can filter by barber/client/rating.
- Admin can hide/unhide review if moderation is included.
- Audit log created for moderation actions.
- Admin route protected.

**Out of scope:**

- Advanced review moderation workflows.

---

## Phase 6 — Notifications, Analytics, Observability, QA & Deployment

### Epic P6-E01 — Push Notifications

#### P6-E01-T01 — Configure Expo push notification foundation

**Issue type:** Task  
**Owner stream:** Mobile/Backend  
**Priority:** High  
**Dependencies:** P1-E01-T01  
**Can run in parallel with:** P6-E02-T01

**Description:**  
Set up push notification token registration and storage.

**Acceptance criteria:**

- User can grant notification permission.
- Expo push token is stored securely.
- Token is associated with user/device.
- Permission denial handled gracefully.
- Tokens can be updated.
- No duplicate invalid tokens accumulate unnecessarily.

**Out of scope:**

- Every notification trigger.

---

#### P6-E01-T02 — Implement notification service for booking events

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P6-E01-T01, P2-E03-T01  
**Can run in parallel with:** P6-E02-T01

**Description:**  
Create backend notification helper for booking lifecycle events.

**Acceptance criteria:**

- Notifications can be sent for request received, accepted, declined, expired, cancelled, on the way, completion prompt, dispute, and review prompt.
- Failures are logged.
- Notification payloads do not expose sensitive data.
- Duplicate notifications avoided where practical.
- Notification records are stored.

**Out of scope:**

- SMS notifications.

---

### Epic P6-E02 — Analytics and Monitoring

#### P6-E02-T01 — Configure Sentry for mobile and admin

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** High  
**Dependencies:** P0-E01-T03  
**Can run in parallel with:** P6-E01-T01

**Description:**  
Set up Sentry error monitoring for mobile and admin.

**Acceptance criteria:**

- Sentry configured for mobile.
- Sentry configured for admin.
- Environment separation exists.
- PII is not unnecessarily sent.
- Error boundaries exist where appropriate.
- Documentation exists.

**Out of scope:**

- Backend log aggregation beyond function logs.

---

#### P6-E02-T02 — Configure PostHog analytics

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** Medium  
**Dependencies:** P0-E01-T03  
**Can run in parallel with:** P6-E02-T01

**Description:**  
Set up product analytics for important user and booking events.

**Acceptance criteria:**

- PostHog configured.
- Events defined for signup, onboarding, booking request, accept/decline, payment captured, on the way, complete, dispute, review.
- PII is avoided.
- Event names are consistent.
- Analytics calls are centralised.

**Out of scope:**

- Complex funnels/dashboard analysis.

---

#### P6-E02-T03 — Add Edge Function structured logging helpers

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P0-E03-T01  
**Can run in parallel with:** P6-E02-T01

**Description:**  
Create shared structured logging helpers for Edge Functions.

**Acceptance criteria:**

- Logs include correlation/request IDs where practical.
- Logs avoid sensitive PII.
- Errors include function name and safe metadata.
- Payment and booking state changes are traceable.
- Logging helper reused across functions.

**Out of scope:**

- External log provider integration unless approved.

---

### Epic P6-E03 — QA and Test Coverage

#### P6-E03-T01 — Create manual QA test plan

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** Highest  
**Dependencies:** P2, P3, P4 core flows  
**Can run in parallel with:** P6-E02 tickets

**Description:**  
Create a manual QA plan covering all core TRIMR flows.

**Acceptance criteria:**

- Test cases exist for client onboarding.
- Test cases exist for barber onboarding.
- Test cases exist for Available Now flow.
- Test cases exist for Scheduled flow.
- Test cases exist for payment authorisation/capture.
- Test cases exist for cancellation/refund rules.
- Test cases exist for completion/auto-completion.
- Test cases exist for dispute flow.
- Test cases exist for admin actions.
- Test cases exist for RLS/access control checks.

**Out of scope:**

- Full automated E2E suite.

---

#### P6-E03-T02 — Add backend function tests for critical business rules

**Issue type:** Task  
**Owner stream:** Backend  
**Priority:** High  
**Dependencies:** P2, P3, P4 core functions  
**Can run in parallel with:** P6-E03-T03

**Description:**  
Add tests for critical Edge Function business rules.

**Acceptance criteria:**

- Tests cover booking request creation.
- Tests cover accept/decline.
- Tests cover payment capture idempotency.
- Tests cover cancellation rules.
- Tests cover completion rules.
- Tests cover dispute creation.
- Tests cover permission failures.
- Tests cover invalid status transitions.

**Out of scope:**

- Exhaustive UI tests.

---

#### P6-E03-T03 — Add admin Playwright smoke tests

**Issue type:** Task  
**Owner stream:** Admin  
**Priority:** Medium  
**Dependencies:** P5 core admin screens  
**Can run in parallel with:** P6-E03-T02

**Description:**  
Add basic Playwright smoke tests for admin dashboard.

**Acceptance criteria:**

- Admin login path tested.
- Bookings list loads.
- Barber list loads.
- Disputes list loads.
- Unauthorized access is blocked.
- Tests run in CI where practical.

**Out of scope:**

- Full browser matrix.

---

### Epic P6-E04 — Deployment and Release Readiness

#### P6-E04-T01 — Set up staging environment

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** Highest  
**Dependencies:** Phase 0 foundations  
**Can run in parallel with:** Later implementation where possible

**Description:**  
Create staging environment for Supabase, mobile builds, admin dashboard, Stripe test mode, Google APIs, Sentry, and PostHog.

**Acceptance criteria:**

- Staging Supabase project exists.
- Staging admin deployment exists.
- Mobile app can point to staging.
- Stripe test mode configured.
- Webhooks configured for staging.
- Environment variables documented.
- No production data used.

**Out of scope:**

- Production launch.

---

#### P6-E04-T02 — Prepare mobile app build pipeline with Expo EAS

**Issue type:** Task  
**Owner stream:** Mobile  
**Priority:** High  
**Dependencies:** P0-E04-T01  
**Can run in parallel with:** P6-E04-T01

**Description:**  
Configure Expo EAS for development/staging builds.

**Acceptance criteria:**

- EAS config exists.
- Development build can be created.
- Staging build profile exists.
- Environment variables documented.
- Build process documented.

**Out of scope:**

- Final App Store/Google Play submission.

---

#### P6-E04-T03 — Prepare production release checklist

**Issue type:** Task  
**Owner stream:** Shared  
**Priority:** High  
**Dependencies:** Core QA completion  
**Can run in parallel with:** Final polish tickets

**Description:**  
Create final production readiness checklist.

**Acceptance criteria:**

- Checklist includes security review.
- Checklist includes RLS review.
- Checklist includes Stripe live mode review.
- Checklist includes Google API key restrictions.
- Checklist includes Sentry/PostHog environment checks.
- Checklist includes app store account readiness.
- Checklist includes rollback plan.
- Checklist includes known limitations/out-of-scope list.

**Out of scope:**

- Actual production launch.

---

## Phase 7 — Wix Marketing Website

### Epic P7-E01 — Wix Marketing Website

#### P7-E01-T01 — Create Wix website sitemap and content structure

**Issue type:** Task  
**Owner stream:** Shared/Wix  
**Priority:** Medium  
**Dependencies:** Branding/client content  
**Can run in parallel with:** Core app development

**Description:**  
Define Wix website pages and content structure.

**Acceptance criteria:**

- Pages include Homepage, How It Works, For Clients, For Barbers, FAQ, Contact.
- Website is marketing only.
- No booking/payment/admin functionality is implemented in Wix.
- Basic SEO structure is documented.
- Mobile optimisation considered.

**Out of scope:**

- App functionality.

---

#### P7-E01-T02 — Build Wix website

**Issue type:** Story  
**Owner stream:** Shared/Wix  
**Priority:** Medium  
**Dependencies:** P7-E01-T01  
**Can run in parallel with:** Core app development

**Description:**  
Build the Wix marketing website.

**Acceptance criteria:**

- Website pages are built.
- Website is responsive.
- Contact method works.
- Basic SEO fields configured.
- Links to app download/waitlist are ready if needed.
- No private platform data is stored in Wix.

**Out of scope:**

- Booking flow.
- User login.
- Payments.

---

# 12. Suggested Sequencing for Two Developers

## Foundation Start

Developer A:

- P0-E04-T01 mobile shell
- P0-E04-T02 mobile UI primitives
- P0-E04-T03 mobile state foundations

Developer B:

- P0-E03-T01 Supabase local setup
- P0-E03-T02 database schema
- P0-E03-T03 RLS policies

Shared:

- P0-E01-T01 monorepo
- P0-E02-T01 constants/enums
- P0-E02-T02 Zod schemas

## Early Feature Work

Developer A:

- Client onboarding
- Barber onboarding
- Service/pricing screens
- Client discovery UI with mocks

Developer B:

- Profile sync function
- Stripe Connect onboarding function
- Service category backend
- Available Now/backend discovery functions

## Mid Feature Work

Developer A:

- Booking request UI
- Barber request inbox
- Booking list/detail screens
- Completion/ETA UI

Developer B:

- Booking request/accept/decline functions
- Payment authorisation/capture
- Stripe webhooks
- Auto-completion/dispute logic

## Admin Work

Developer A or B depending on availability:

- Admin dashboard shell
- Bookings admin
- Barbers admin
- Disputes/refunds admin
- Payments/payouts admin

---

# 13. Copilot Instructions for Jira Script Generation

When generating the Jira script:

1. Read each ticket heading and metadata.
2. Create Jira Epics for each `Epic`.
3. Create Jira Tasks/Stories under corresponding Epic.
4. Preserve:
   - title
   - description
   - acceptance criteria
   - dependencies
   - labels
   - phase
   - owner stream
   - out of scope
   - quality gate
5. Do not include secrets.
6. Use environment variables:
   - `JIRA_BASE_URL`
   - `JIRA_EMAIL`
   - `JIRA_API_TOKEN`
   - `JIRA_PROJECT_KEY`
7. Support dry-run mode.
8. Support idempotency by checking existing ticket labels/titles before creating duplicates.
9. Output a summary of created/skipped issues.
10. Do not delete Jira issues.

Suggested labels:

```txt
trimr
phase-0
phase-1
phase-2
phase-3
phase-4
phase-5
phase-6
phase-7
mobile
admin
backend
database
supabase
stripe
maps
notifications
qa
wix
security
```

---

# 14. Global Out-of-Scope Unless Separately Approved

Do not add these unless explicitly approved:

- Full Uber-style live tracking
- In-app chat
- SMS notifications
- Promo codes
- Loyalty/referral system
- Barber subscriptions
- Advanced fraud detection
- Tax/accounting exports
- Customer support ticketing system
- Multi-city operations tooling
- Advanced AI matching
- Complex dynamic pricing
- Full legal policy drafting
- Complex insurance/compliance workflow
- Dedicated backend replacing Supabase Edge Functions
- AWS infrastructure migration
- Firebase backend
- GraphQL layer
- Mobile E2E with Detox unless separately approved

---

# 15. Final Implementation Principle

TRIMR should be built as a premium, production-quality marketplace platform.

The team should move quickly, but never by compromising:

- security
- data ownership
- payment correctness
- RLS correctness
- clean architecture
- shared components
- shared types
- validation
- efficient queries
- auditability
- maintainability
- scope control
