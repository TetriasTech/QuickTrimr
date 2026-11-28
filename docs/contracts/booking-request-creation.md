# Booking request creation — P2-T08 / TRIMR-51

`POST /functions/v1/create-booking-request` accepts the shared
`createBookingRequestRequestSchema`. A verified client JWT supplies identity;
current stored role, complete client profile and owned active resolved address
are required. The documented 409 conflicts still apply. Since P3-T06,
creation returns `paymentRequired: true` on the owner-only draft. The barber
sees the request after the server verifies its Stripe authorisation.

The transaction rechecks Connect eligibility, the shared reliability policy,
active service/category and inclusive category price bounds. Available Now uses
the current active unelapsed session and its radius; Scheduled uses the saved
service-area centre/radius. Both use the saved address point and PostGIS under
RULE-ADDRESS-02. No submitted coordinate, session or standing can override these.

`public.booking_requests` adds `service_category_id`, `barber_service_id`,
`scheduled_for`, `expires_at` and a private `intent_key`. The existing
`available_now_session_id` records the server-selected source session. Only the
four non-sensitive service/time columns gain authenticated SELECT grants;
existing RLS still restricts the rows. Unknown/legacy incomplete data is not
silently assigned fabricated historical snapshots.

`private.booking_request_snapshots` is immutable, has RLS with default denial,
and grants no direct API/table access to any application role, including the
service role. Its primary key is `request_id`. Only narrow authorized server
functions may read it. It contains:

- `service_price_cents`, `commission_pct_snapshot`, `gross_cents`,
  `commission_cents`, `barber_net_cents` (typed integer cents; percentage integer).
- `cancellation_refund_pct`, `cancellation_inconvenience_pct`,
  `late_cancel_window_hours`, selected from server config for the booking type.
- `client_address_id`, `address_snapshot` (the existing saved-address JSON shape),
  private `address_location`, `client_snapshot` (`displayName`, `mobile`),
  `notes`, `barber_snapshot` (`displayName`, `publicAreaId`) and
  `service_snapshot` (`displayName`, `slug`), plus `created_at`.
- Since P2-T10, nullable `distance_band` stores the coarse distance from the
  request-time coverage origin to the saved destination. The write-time trigger
  runs inside this transaction while the applicable sources are locked. Older
  snapshots keep null. PostGIS and the existing configured bands are reused.

Barber request inboxes must project only their allowed public fields; do not
return these private snapshots wholesale. Address/contact disclosure still needs
an accepted, active booking. Neither the success DTO nor its safe creation audit
contains addresses, phone numbers, notes, coordinates or provider identifiers.

All writers serialize on the client and barber profile parents in ID order.
Then they lock address/profile/service/category facts and the current source
session. Category precedes service, matching pricing/category writers. Reliability
and session writers retain their existing barber-parent-first contract. The
Connect gate is read without locking its account child: its existing refresh
writer locks that child before publishing profile verification, so taking a child
lock after the profile here would invert lock order. No transaction spans I/O.

A server-derived SHA-256 intent uses the verified client, type, target barber,
category and normalized Scheduled epoch. Current pending checks and inserts run
under the client lock. Available Now conflicts across all target barbers;
Scheduled conflicts on that intent regardless of address/notes/forged keys.
An active conflict returns the documented 409, rather than creating another row.
Elapsed deadlines do not block a fresh request. This does not mark old requests
expired or invoke miss outcomes; P2-T15 owns those terminal transitions.

`requestSnapshot` and `scheduledTimeIssue` in `packages/domain` are pure policies.
Transactional SQL mirrors are field-by-field parity-tested to avoid an unlocked
read/compute/write race. Durations use elapsed minutes/hours/24-hour days, including
DST boundaries; config values are read rather than embedded in the feature.

P2-T12 creates a booking on valid acceptance and carries these original terms
through `request_id`; it must not reconstruct history from today's config or
price. P2-T10/P2-T13/P2-T15 retain their own privacy/transition contracts.
P3-T01/P3-T06 add authorization/capture integration. P4-T01 displays the resulting
state. No Stripe call, payment row, booking row, submission UI, notification or
terminal-transition worker is implemented by P2-T08. A safe immutable audit row
records creation; `booking_status_history` requires a booking and starts with the
owning acceptance handler, not a fictional booking at request creation.
