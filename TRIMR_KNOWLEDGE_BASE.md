# TRIMR Knowledge Base

> **Companion file:** This knowledge base is designed to work hand in hand with `TRIMR_BACKLOG_README.md`.
>
> The backlog README defines the phased epics, Jira-ready ticket structure, sequencing, and implementation tasks.
>
> This knowledge base defines the agreed product rules, architecture decisions, business logic, engineering standards, and implementation assumptions that Copilot should refer to while creating tickets, writing code, reviewing pull requests, or generating scripts.

---

## 1. How Copilot Should Use This Knowledge Base

Copilot or any implementation agent must treat this file as the product and engineering source of truth for TRIMR.

When generating code, tickets, scripts, migrations, Edge Functions, tests, or documentation:

1. Read this knowledge base first.
2. Read `TRIMR_BACKLOG_README.md` second.
3. Do not invent new product behaviour unless explicitly requested.
4. Do not add functionality outside the current phase unless clearly marked as future scope.
5. Prefer shared types, shared validation, and shared components.
6. Prefer secure server-side business logic over trusting frontend state.
7. Preserve the two-developer parallel workflow.
8. Keep implementation premium, maintainable, and scalable.

If there is a conflict between files:

1. User-confirmed decisions in this knowledge base take priority.
2. Then `TRIMR_BACKLOG_README.md`.
3. Then the original proposal.
4. Then implementation assumptions.

If anything is unclear, Copilot should leave a clear TODO or ask for clarification rather than making a risky product decision.

---

## 2. Product Identity

**Product name:** TRIMR  
**Previous proposal name:** QuikTrim  
**Current name to use everywhere:** TRIMR

Do not use `QuikTrim` in new code, comments, documentation, tickets, UI text, branch names, folders, or Jira tickets unless referring to legacy proposal context.

TRIMR is a two-sided barber marketplace that connects clients with barbers for:

1. Immediate bookings through an **Available Now** flow.
2. Future bookings through a **Scheduled** flow.

The product should be treated as a premium production-quality platform.

The team intentionally undercharged commercially, but engineering quality, architecture, maintainability, security, and scalability must not be reduced because of that.

---

## 3. Main Product Components

TRIMR contains:

1. **Mobile app**
   - One cross-platform React Native / Expo app.
   - Supports both client and barber experiences.

2. **Admin dashboard**
   - Web-based Next.js dashboard.
   - Used by platform admins to manage users, barbers, bookings, payments, disputes, reviews, service categories, and operational visibility.

3. **Marketing website**
   - Wix website only.
   - Used for credibility, launch, investor presentation, and client/barber interest.
   - Must not power bookings, admin, authentication, payments, or app workflows.

---

## 4. Confirmed Technology Stack

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
| Admin tables | TanStack Table |
| Database | Supabase Postgres |
| Geo/location | PostGIS |
| Backend/API layer | Supabase Edge Functions |
| Authentication | Supabase Auth |
| Access control | Supabase Row Level Security |
| File/image storage | Supabase Storage |
| Payments | Stripe Payments |
| Marketplace payouts | Stripe Connect |
| Barber onboarding | Stripe Connect hosted onboarding |
| Client identity verification | Not at launch, but architecture should be Stripe Identity-ready |
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

## 5. Architecture Decision Records

### ADR-001 — Use Supabase as the core backend platform

**Decision:** Use Supabase Postgres, Auth, Storage, Edge Functions, RLS, and PostGIS as the core backend for TRIMR.

**Reasoning:**

- Supabase provides a strong managed Postgres foundation.
- It gives the team speed without sacrificing a proper relational database.
- PostGIS supports location-based barber discovery.
- Edge Functions are sufficient for current backend/business logic needs.
- A separate custom backend is not required at launch.

**Important constraint:** Supabase must not be used casually as a frontend-controlled CRUD backend. Sensitive marketplace logic must be handled server-side.

Sensitive actions include:

- Booking request creation
- Booking acceptance/decline
- Payment authorisation/capture
- Refunds
- Payout release
- Completion
- Disputes
- Admin overrides
- Reliability consequences
- ETA calculations
- Stripe webhooks

---

### ADR-002 — Use Supabase Edge Functions before a dedicated backend

**Decision:** Use Supabase Edge Functions as the backend layer for launch.

**Reasoning:**

- Edge Functions are enough for secure, stateless API operations.
- They reduce infrastructure overhead.
- They work well for Stripe webhooks, Google Routes calls, notification triggers, and booking state transitions.
- Business logic can be structured cleanly so future extraction into a dedicated backend is possible if scale requires it.

**Implementation requirement:** Edge Functions must be structured like a real backend, not random one-file scripts.

Recommended structure:

```txt
supabase/
  functions/
    create-booking-request/
      index.ts
    accept-booking-request/
      index.ts
    stripe-webhook/
      index.ts
    update-eta/
      index.ts
    _shared/
      auth/
      errors/
      logging/
      responses/
      validation/
      services/
```

---

### ADR-003 — Do not use Redux by default

**Decision:** Do not use Redux at launch.

**Reasoning:**

TRIMR state should be split cleanly:

| State type | Tool |
|---|---|
| Backend/server data | TanStack Query |
| Temporary local app/UI state | Zustand |
| Form state | React Hook Form |
| Validation | Zod |

Redux is not banned forever, but it should not be introduced unless there is a clear future need for complex app-wide state transitions.

Examples of server state:

- Nearby barbers
- Barber profiles
- Bookings
- Reviews
- Payment status
- Verification status

Examples of local state:

- Selected booking mode
- Selected service
- Selected filters
- Booking draft
- Current UI modal state
- Temporary onboarding step

---

### ADR-004 — No Uber-style live tracking

**Decision:** TRIMR will not implement full Uber-style live tracking.

**Reasoning:**

- It is unnecessary for this product.
- It increases cost.
- It adds privacy concerns.
- It increases battery and mobile permission complexity.
- It introduces operational complexity that is not needed.

**Replacement approach:** Use controlled ETA updates only after barber taps **“I’m on my way.”**

---

### ADR-005 — Client Stripe Identity is not required at launch

**Decision:** Client onboarding should launch without mandatory Stripe Identity.

**Reasoning:**

- Client Stripe Identity adds friction.
- Clients can create accounts, browse, request, and pay without identity document verification.
- The system should be designed to support Stripe Identity later if the business wants stronger trust/safety checks.

**Implementation requirement:** Database and profile model should include verification-ready fields, but the launch flow should not block clients on Stripe Identity.

For barbers, Stripe Connect onboarding is required for payouts and verification.

---

### ADR-006 — Use payment pre-authorisation before barber acceptance

**Decision:** When the client submits a booking request, payment should be pre-authorised. When the barber accepts, the payment should be captured automatically.

**Reasoning:**

The client should not need to manually return and pay after barber acceptance. The barber should not be able to accept a job only for payment to fail.

Flow:

```txt
Client submits request
→ payment is authorised / held

Barber accepts
→ payment is captured

Booking completes
→ barber TRIMR balance moves from pending to available

Scheduled payout
→ money is paid out according to payout schedule
```

---

## 6. Team and Workflow Constraints

TRIMR is being built by **two developers** in a monorepo.

Backlog and code must allow parallel work.

### Parallelisation Rules

- Avoid tickets that force one developer to wait for the other unnecessarily.
- Define shared contracts first.
- Mobile screens should support mock data while backend is being built.
- Backend functions should be testable with example payloads before UI is complete.
- Admin pages should use seeded data early.
- Avoid both developers editing the same large files.
- Prefer feature folders and shared packages.
- Every API contract must have example request and response shapes.

### Suggested Work Streams

Developer Stream A:

- Mobile app shell
- Shared mobile UI primitives
- Client onboarding
- Barber onboarding
- Discovery UI
- Booking UI
- Completion UI
- ETA UI

Developer Stream B:

- Supabase schema
- RLS policies
- Edge Functions
- Stripe integration
- Admin dashboard
- Payment/earnings/dispute logic
- Notification/ETA backend

Shared:

- Monorepo setup
- Shared constants
- Shared Zod schemas
- Shared types
- PR/CI standards
- Architecture decisions

---

## 7. Monorepo Rules

Recommended structure:

```txt
trimr/
  apps/
    mobile/
    admin/
  packages/
    shared/
    validation/
    ui/
  supabase/
    functions/
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

Rules:

- Shared TypeScript types must live in `packages/shared`.
- Shared Zod schemas must live in `packages/validation`.
- Shared UI primitives should live in `packages/ui` where practical.
- Feature-specific UI belongs in feature folders.
- Business rules must not be scattered across UI components.
- Edge Functions must reuse shared validation where possible.
- Database schema changes must use migrations.
- No manual production schema changes.
- No secrets in source control.
- No duplicate constants between mobile, admin, and functions.

---

## 8. User Roles

TRIMR has the following roles:

```txt
client
barber
admin
```

### Client

Can:

- Sign up/login
- Complete profile
- Add/select service addresses
- Browse barbers
- Filter by service/haircut type
- Use Available Now
- Request scheduled bookings
- Pay in app
- Cancel according to rules
- Confirm job completion
- Raise disputes
- Leave reviews

Cannot:

- Access admin dashboard
- View unrelated bookings
- View private barber data
- Change payment amount
- Override booking/payment status
- Release payouts

### Barber

Can:

- Sign up/login
- Complete profile
- Upload profile photo
- Set service area/radius
- Select offered service categories
- Set own prices
- Complete Stripe Connect onboarding
- Toggle Available Now
- Receive multiple booking requests
- Accept/decline booking requests
- View own bookings
- Mark on the way
- Mark job complete
- View own earnings/balance
- View own reviews

Cannot:

- Access admin dashboard
- See unrelated clients/bookings
- Override payment/refund/payout
- Change commission
- Accept expired requests
- Accept more than one active Available Now job at a time

### Admin

Can:

- View/manage clients
- View/manage barbers
- View bookings
- View payment/payout/refund status
- Manage service categories
- View verification/onboarding status
- View reliability state/events
- Resolve disputes
- Issue refunds
- Override booking status where operationally required
- View reviews
- View platform analytics

Admin actions must be protected and audit logged.

---

## 9. Onboarding Rules

### Client Onboarding

Launch client onboarding includes:

- Account creation/login
- Basic profile details
- Mobile/email fields as required
- Saved service addresses
- Optional future Stripe Identity readiness

Client Stripe Identity:

- Not required at launch
- Should be possible later
- Should not require rewriting core profile/onboarding architecture

### Barber Onboarding

Barber onboarding includes:

- Account creation/login
- Barber profile setup
- Profile photo
- Service area/radius
- Service/pricing setup
- Stripe Connect hosted onboarding
- Verification/onboarding status
- Bank payout setup through Stripe Connect

Barbers should not be allowed to receive paid bookings until Stripe Connect requirements are satisfied, unless explicitly configured otherwise.

---

## 10. Service and Pricing Rules

- Admin creates global service categories.
- Barber selects which global services they offer.
- Barber sets their own price per service.
- Barber can update prices later.
- Existing bookings must not change when barber updates prices.
- Each booking stores a price snapshot.
- Commission is calculated from booking snapshot.
- Commission percentage is configurable.
- Assume 20% commission for initial implementation.
- Commission must be snapshotted per booking.

Example service categories:

```txt
Haircut
Skin fade
Beard trim
Haircut + beard
Kids haircut
```

Service durations are not required for payment-release logic because completion is based on actual user actions and auto-completion windows.

---

## 11. Booking Types

TRIMR supports:

```txt
available_now
scheduled
```

### Available Now

Used when client wants a barber immediately.

### Scheduled

Used when client books a future appointment.

---

## 12. Booking Statuses

Initial statuses:

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

Statuses can be added/removed later, but implementation should start with these.

Status changes must be recorded in `booking_status_history`.

Sensitive transitions must happen server-side.

---

## 13. Available Now Rules

### Client Side

- Client can only have one active pending Available Now request at a time.
- Client cannot send multiple active requests to multiple barbers at once.
- Client can cancel freely before barber accepts.
- If cancelled before acceptance, payment authorisation is cancelled.
- Client sees available barbers based on current location, chosen service, radius, and barber status.

### Barber Side

- Barber can receive multiple incoming requests.
- Barber can prioritise requests based on distance, price, customer, or service.
- Barber can only accept one active Available Now request at a time.
- Once accepted, the barber becomes busy or Available Now session is disabled.
- Other conflicting pending requests should be expired/declined safely.

### Expiry

- Available Now request expires after 5 minutes.
- If barber does not accept/decline, request expires.
- Missed request count may affect Available Now auto-disable rules.

### Available Now Session

Barber can:

- Toggle Available Now on/off.
- Use GPS location.
- Manually adjust/set location where allowed.
- Set travel radius.
- Set available-until time.

Auto-disable Available Now if:

- Available-until time passes.
- Barber ignores/misses 2 consecutive requests.
- Barber accepts an Available Now booking.
- Barber manually toggles off.

Distance for Available Now:

- Calculated from barber’s current location.

---

## 14. Scheduled Booking Rules

- Client requests a future appointment.
- Barber can accept or decline.
- Request expires after 2 hours if not accepted/declined.
- Scheduled discovery is based on barber service area/radius, not necessarily current GPS location.
- Payment is pre-authorised when request is submitted.
- Payment is captured when barber accepts.
- Cancellation rules differ depending on whether the booking is more or less than 12 hours away.

---

## 15. Payment Rules

### Payment Authorisation

When client submits request:

- Payment method is selected/confirmed.
- PaymentIntent is created with manual capture.
- Amount is calculated server-side.
- Payment is authorised/held.
- Frontend cannot choose final charge amount.
- Booking/request stores payment reference.

If request is declined/expired/cancelled before acceptance:

- Authorisation is cancelled.

### Payment Capture

When barber accepts:

- Backend captures authorised payment.
- Booking becomes confirmed only after trusted payment success.
- Payment cannot be captured twice.
- Capture failures must leave booking/request in a safe state.

### Payment Source of Truth

Do not trust the mobile app for payment success.

Use:

- Stripe API response
- Stripe webhook
- Backend-controlled state transitions

### Financial Data Rules

- Store money as integer cents.
- Do not use floating-point values for money.
- Store original gross amount.
- Store platform commission.
- Store barber net amount.
- Store refund amount where applicable.
- Store Stripe IDs securely but do not expose unnecessarily.

---

## 16. Barber Earnings and Balance Rules

TRIMR separates visible app balance from actual bank payout.

### Earning Statuses

```txt
pending
available
queued_for_payout
paid_out
reversed
```

### Meaning

| Status | Meaning |
|---|---|
| pending | Client has paid, but job is not completed/auto-completed yet |
| available | Job is complete and earning is available in barber TRIMR balance |
| queued_for_payout | Earning is included in a payout batch |
| paid_out | Payout has been processed |
| reversed | Earning was reversed/refunded/disputed |

### Important Rule

Auto-release means:

```txt
barber earning moves from pending to available
```

Auto-release does **not** mean:

```txt
money instantly lands in barber bank account
```

Actual payout can be batched, for example weekly.

Payout schedule must be configurable.

---

## 17. Completion Rules

TRIMR does not require strict haircut duration for payment release.

Completion is based on actual user action and timeout windows.

### Case 1 — Barber marks job complete

Flow:

```txt
Barber taps “Job complete”
→ booking moves to completed_by_barber
→ client has 1 hour to respond
```

Outcomes:

- Client confirms within 1 hour:
  - Booking becomes completed.
  - Barber earning moves to available.

- Client disputes within 1 hour:
  - Booking becomes disputed.
  - Dispute opens.
  - Barber earning remains pending.

- Client does nothing for 1 hour:
  - Booking auto-completes.
  - Barber earning moves to available.

### Case 2 — Client marks job complete first

Flow:

```txt
Client taps “Job done”
→ booking becomes completed
→ barber earning moves to available
```

### Case 3 — Neither party marks job complete

Flow:

```txt
After 6 hours
→ TRIMR sends final completion warning/prompt
→ client has 1 additional hour to dispute
```

Outcomes:

- Client disputes:
  - Booking becomes disputed.
  - Barber earning remains pending.

- Client does nothing:
  - Booking auto-completes.
  - Barber earning moves to available.

This protects against bookings remaining open forever while still giving the client a final warning before auto-completion.

---

## 18. Cancellation Rules

### Future/Scheduled Bookings

More than 12 hours before booking:

- Client can cancel without punishment.
- Barber can cancel without punishment.
- Refund handling should be full refund unless otherwise configured.

Within 12 hours:

- Cancellation is still allowed.
- Client cancellation:
  - Client receives partial refund.
  - Barber receives inconvenience fee.
- Barber cancellation:
  - Client receives full refund.
  - Barber receives reliability consequence.

### Available Now Bookings

Before barber accepts:

- Client can cancel freely.
- Payment authorisation is cancelled.
- No penalty.

After barber accepts:

- Client cancellation:
  - Partial refund.
  - Barber receives inconvenience fee.

- Barber cancellation:
  - Client receives full refund.
  - Barber receives reliability consequence.

### Admin Refunds

Only admins can issue refunds through the admin portal.

Refund logic must be server-side and audit logged.

---

## 19. Barber Reliability Rules

Reliability consequences must not be permanent unless the barber has serious/repeated behaviour.

Reliability is based on a rolling window and can reset after good behaviour.

### Initial Reliability Levels

```txt
good_standing
watch
limited
restricted
suspended
```

### Example Behaviour

1st late/accepted-job cancellation in rolling window:

```txt
warning logged
```

2nd late/accepted-job cancellation in rolling window:

```txt
temporary Available Now cooldown
```

3rd late/accepted-job cancellation in rolling window:

```txt
reduced search priority + admin review flag
```

Repeated pattern:

```txt
suspension from Available Now or full platform review
```

### Reset Rule

After configured good behaviour period, reliability level improves or resets.

Configurable values:

- Rolling window days
- Reset period days
- Missed request threshold
- Cooldown duration
- Search priority penalty
- Admin review threshold

Do not hardcode these values deep inside feature logic.

---

## 20. ETA and Location Rules

### No Live Tracking

TRIMR does not provide full Uber-style live tracking.

### On My Way Flow

When barber taps **“I’m on my way”**:

1. App captures barber location.
2. Backend calculates ETA using Google Routes API.
3. Client receives push notification.
4. Client sees ETA and last updated time.
5. ETA refreshes at controlled intervals.

### ETA Update Rules

- Default interval: 2–3 minutes.
- Interval must be configurable.
- Google Routes API must be called from backend only.
- Mobile app must not expose Google Routes server API keys.
- Stop ETA updates when booking is completed, cancelled, disputed, or inactive.
- Avoid high-frequency updates.
- Do not imply full live tracking if not implemented.

---

## 21. Dispute Rules

Disputes open when:

- Client says the job is not done.
- Client says they are unhappy within completion response window.
- Admin opens/updates dispute where operationally required.

When dispute opens:

- Booking status becomes disputed.
- Barber earning remains pending.
- Admin can investigate through dashboard.
- Admin can resolve with:
  - Client full refund
  - Client partial refund
  - Barber paid
  - Custom operational outcome if implemented

Only admins can resolve disputes/refunds.

All dispute actions must be audit logged.

---

## 22. Review Rules

- Client can review barber after completed booking.
- One review per booking.
- Client can only review their own completed booking.
- Review includes rating.
- Review text may be optional.
- Admin may hide/unhide reviews if moderation is implemented.
- Review should contribute to barber rating aggregate safely.
- Reviews should not be allowed on disputed/cancelled bookings unless later approved.

---

## 23. Admin Dashboard Rules

The admin dashboard is operational and sensitive.

Admin must be able to view:

- Clients
- Barbers
- Bookings
- Payment status
- Payout status
- Refund status
- Cancellation status
- Barber onboarding/verification status
- Stripe Connect status
- Service categories
- Ratings/reviews
- Disputes
- Available Now status
- Basic platform analytics
- Barber reliability state/events

Admin may perform:

- Dispute resolution
- Refund issuance
- Booking status override where required
- Barber status/reliability management
- Service category management
- Review visibility management if included

All admin actions must be:

- Admin protected
- Server-side validated
- Audit logged
- Reasoned where operationally sensitive
- Designed to avoid silent financial inconsistencies

---

## 24. Notification Rules

Push notifications should be used for:

- Barber receives booking request
- Client booking accepted
- Client booking declined
- Request expired
- Booking cancelled
- Barber on the way
- ETA update where useful
- Barber marks job complete
- Client completion prompt
- Final completion warning after 6 hours
- Dispute opened/resolved
- Review prompt
- Payout/balance update where useful

Notification payloads must not expose unnecessary sensitive data.

Failed notifications should be logged.

No SMS notifications at launch unless separately approved.

---

## 25. Database Model Reference

Starting tables:

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

### Database Principles

- Use PostGIS for location.
- Use RLS on private/operational tables.
- Use integer cents for money.
- Use snapshots for price and commission.
- Use status history for bookings.
- Use audit logs for sensitive actions.
- Use config-driven rules where values may change.
- Do not rely on frontend state for financial truth.
- Do not over-fetch related data.
- Use pagination for growing lists.
- Add indexes for obvious filters:
  - booking status
  - barber ID
  - client ID
  - booking type
  - created date
  - available now status
  - location/geography
  - payment status
  - dispute status

---

## 26. RLS and Access Control Expectations

RLS must be considered for every table.

### Client Access

Clients can access:

- Own profile
- Own addresses
- Public barber profile data
- Own booking requests
- Own bookings
- Own payments in safe form
- Own disputes
- Own reviews

Clients cannot access:

- Other clients' data
- Barber private data
- Admin data
- Payout internals
- Other bookings
- Audit logs

### Barber Access

Barbers can access:

- Own profile
- Own service/pricing setup
- Own Available Now sessions
- Requests sent to them
- Own bookings
- Limited client details for accepted/active bookings
- Own earnings
- Own reviews

Barbers cannot access:

- Other barbers' private data
- Other clients' unrelated data
- Admin data
- Full platform payment data
- Audit logs

### Admin Access

Admins can access operational data only through protected admin paths/functions.

Do not rely only on frontend hiding admin pages.

---

## 27. Edge Function Rules

Every Edge Function must:

- Validate auth.
- Validate role.
- Validate input with Zod.
- Avoid trusting frontend-calculated amounts/statuses.
- Use shared error/response helpers.
- Avoid leaking internal error details to users.
- Use idempotency where repeated calls are possible.
- Handle double-submit/concurrency where relevant.
- Create audit logs for sensitive actions.
- Avoid unnecessary database queries.
- Return only the data the frontend needs.

Critical functions:

```txt
create-booking-request
accept-booking-request
decline-booking-request
expire-booking-request
cancel-booking
create-payment-authorisation
capture-authorised-payment
stripe-webhook
mark-on-the-way
update-eta
mark-job-complete-by-barber
confirm-job-complete-by-client
open-dispute
auto-complete-after-timeout
admin-resolve-dispute
admin-issue-refund
release-barber-earning
queue-payout-batch
```

---

## 28. Configuration Values

The following values must be configurable, not hardcoded deeply:

```txt
PLATFORM_COMMISSION_PERCENTAGE = 20
AVAILABLE_NOW_REQUEST_EXPIRY_MINUTES = 5
SCHEDULED_REQUEST_EXPIRY_HOURS = 2
CLIENT_COMPLETION_RESPONSE_MINUTES = 60
NEITHER_PARTY_COMPLETION_WARNING_HOURS = 6
FINAL_COMPLETION_DISPUTE_WINDOW_MINUTES = 60
AVAILABLE_NOW_MISSED_REQUEST_THRESHOLD = 2
ETA_REFRESH_INTERVAL_MINUTES = 2 or 3
LATE_CANCELLATION_WINDOW_HOURS = 12
PAYOUT_DAY = configurable
RELIABILITY_ROLLING_WINDOW_DAYS = configurable
RELIABILITY_RESET_PERIOD_DAYS = configurable
```

If stored in DB:

- Use platform config table.
- Protect updates behind admin access.
- Snapshot values on bookings where financial/business history matters.

---

## 29. Stripe Rules

Use Stripe for:

- Payment authorisation
- Payment capture
- Refunds
- Stripe Connect barber onboarding
- Connected account verification/status
- Later transfers/payout flows

Rules:

- Stripe secret key is server-only.
- Stripe webhook secret is server-only.
- Stripe webhook signatures must be verified.
- Payment amount calculated server-side.
- Commission calculated server-side.
- Idempotency required for repeated Stripe-sensitive operations.
- Store Stripe IDs carefully.
- Do not expose unnecessary Stripe IDs to clients/barbers.
- Do not use frontend payment success as source of truth.

---

## 30. Google Maps / Routes Rules

Use Google Maps for:

- Maps
- Barber discovery display
- Places/address search if required
- ETA calculation through Routes API

Rules:

- Google Routes API calls must happen server-side.
- Client/mobile must not expose server API keys.
- ETA calls must be throttled.
- No live tracking.
- Use PostGIS for actual database location filtering.
- Do not fetch all barbers and filter in the frontend.

---

## 31. State Management Rules

### TanStack Query

Use for:

- Fetching barbers
- Fetching bookings
- Fetching booking detail
- Fetching profile
- Fetching services
- Fetching earnings
- Mutations that call Edge Functions

Rules:

- Use stable query keys.
- Invalidate affected queries after mutations.
- Do not manually duplicate server data in Zustand.

### Zustand

Use for:

- Booking draft
- Selected service
- Selected booking mode
- Local filter state
- UI preferences
- Temporary form-adjacent app state

Rules:

- Do not store sensitive backend truth in Zustand.
- Do not store payment truth in Zustand.
- Keep stores small and feature-specific.

### React Hook Form + Zod

Use for:

- Onboarding forms
- Address forms
- Barber service/pricing forms
- Booking request forms
- Cancellation/dispute/review forms
- Admin forms

Rules:

- Every form needs validation.
- Shared schemas should be reused where practical.
- User-friendly validation messages required.

---

## 32. UI and Shared Component Rules

Use shared components for:

- Buttons
- Inputs
- Cards
- Badges
- Avatars
- Loading states
- Empty states
- Error states
- Modals/dialogs
- Data tables
- Status badges
- Page headers

Do not create duplicate button/input/card/status components in feature folders unless there is a justified variant.

Feature-specific components are allowed, but they should compose shared primitives.

---

## 33. Error Handling Rules

Every user-facing flow must handle:

- Loading state
- Empty state
- Error state
- Validation failure
- Permission denial
- Network failure
- Expired request
- Already accepted/declined/cancelled state
- Payment failure
- Retry where appropriate

Errors shown to users should be clear and safe.

Technical errors should be logged without leaking PII or secrets.

---

## 34. Performance and Scalability Rules

Avoid:

- N+1 queries
- Fetching all barbers
- Fetching all bookings
- Fetching full profiles when only summary is needed
- Repeated Google Routes calls
- High-frequency ETA updates
- Unbounded admin queries
- Heavy client-side filtering of database-sized data
- Excessive Realtime subscriptions
- Large frontend payloads

Use:

- Pagination
- Filters
- Indexes
- PostGIS
- Server-side calculations
- Query-specific views/RPCs where appropriate
- TanStack Query caching
- Background jobs only where needed

---

## 35. Audit Logging Rules

Audit logs required for:

- Booking status changes
- Payment status changes
- Refunds
- Dispute creation/resolution
- Admin actions
- Barber verification status changes
- Stripe Connect status changes
- Reliability consequences
- Payout status changes
- Manual overrides
- Service category admin changes

Audit log should include:

- Actor user ID
- Actor role
- Action
- Entity type
- Entity ID
- Previous value where practical
- New value where practical
- Reason where required
- Timestamp
- Safe metadata

Do not log sensitive card/payment details.

---

## 36. Testing and QA Expectations

Test important business rules:

- Client cannot create multiple active Available Now requests.
- Available Now expires after 5 minutes.
- Scheduled request expires after 2 hours.
- Barber cannot accept expired request.
- Barber cannot accept conflicting Available Now job.
- Payment capture is idempotent.
- Client cancellation rules.
- Barber cancellation rules.
- Barber reliability reset behaviour.
- Completion after barber marks done.
- Final 6-hour warning flow.
- Dispute prevents earning release.
- Admin-only actions are blocked for non-admins.
- RLS prevents cross-user data access.

Manual QA must cover:

- Client onboarding
- Barber onboarding
- Stripe Connect onboarding
- Available Now flow
- Scheduled flow
- Cancellation flows
- Payment flows
- Completion flows
- Dispute flow
- Admin dispute/refund flow
- ETA flow
- Reviews

---

## 37. Scope Boundaries

Out of scope unless explicitly approved:

- Full Uber-style live tracking
- In-app chat
- SMS notifications
- Promo codes
- Loyalty/referral system
- Barber subscriptions
- Advanced fraud detection
- Tax/accounting exports
- Customer support ticketing
- Multi-city operations tooling
- Advanced AI matching
- Complex dynamic pricing
- Full legal policy drafting
- Complex insurance/compliance workflow
- Dedicated backend replacing Supabase Edge Functions
- AWS infrastructure migration
- Firebase backend
- GraphQL layer
- Mobile E2E with Detox

If Copilot detects a task drifting into these areas, it should mark it as deferred/out-of-scope instead of implementing it.

---

## 38. Principal-Engineer Review Checklist

For every ticket and PR, check:

### Dead Code

- No unused files.
- No unused imports.
- No unused components.
- No unused functions.
- No duplicate logic.
- No stale mock code in production path.

### Security

- No hardcoded secrets.
- No unsafe env handling.
- No frontend-trusted role/status/amount.
- Admin routes/actions protected.
- RLS considered.
- Private data not leaked.
- Webhooks verified.

### Database

- Queries filtered.
- No over-fetching.
- No N+1 patterns.
- Pagination where needed.
- PostGIS used for location.
- No client-side filtering of large datasets.
- Sensitive operations server-side.

### React / Expo / Next

- Correct hooks dependencies.
- No render loops.
- No unnecessary re-renders.
- Correct client/server boundaries.
- TanStack Query for server state.
- Zustand for local state.
- Shared components used.

### Types and Maintainability

- No unnecessary `any`.
- Shared types used.
- Shared schemas used.
- Naming consistent.
- Files not too large.
- Business rules not buried in UI.

### Validation and Errors

- Inputs validated.
- Forms reject invalid data.
- API errors handled.
- User-friendly error messages.
- Edge cases handled.

### Performance

- Scales with growing records.
- Avoids unnecessary network calls.
- Avoids excessive ETA/map calls.
- Avoids unnecessary frontend payload.

### Scope

- No unapproved features.
- No unnecessary complexity.
- Deferred items documented.

---

## 39. Instructions for Future Copilot Work

When asked to implement a ticket:

1. Identify the phase and epic.
2. Check dependencies.
3. Read the relevant product rules in this knowledge base.
4. Check whether shared types/schemas/components already exist.
5. Avoid creating duplicate logic.
6. Implement the smallest correct slice.
7. Add validation.
8. Add error/loading states.
9. Consider RLS/auth/security.
10. Add or update tests where practical.
11. Update documentation if behaviour changes.
12. Do not expand scope without approval.

When asked to create Jira tickets:

1. Use `TRIMR_BACKLOG_README.md`.
2. Preserve phase/epic/task hierarchy.
3. Include acceptance criteria.
4. Include dependencies and parallelisation notes.
5. Include quality gates.
6. Do not create duplicate tickets.
7. Use dry-run mode first.

---

## 40. Final Product Principle

TRIMR should feel simple to users but be engineered seriously behind the scenes.

The implementation should optimise for:

- Trust
- Payment correctness
- Security
- Clear booking states
- Clear admin visibility
- Reliable barber/client experience
- Efficient queries
- Clean code
- Shared components
- Parallel development
- Future scalability

Do not solve future problems too early, but do not create technical debt that blocks future scale.
