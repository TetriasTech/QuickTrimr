# Nearby discovery — P2-T04 / TRIMR-47

Owner: Andrew. Implements `RULE-DISCOVERY-01`–`RULE-DISCOVERY-06`,
`RULE-ONBOARD-04`/`05`, `RULE-RELY-06` and `ADR-008`.

## API and privacy

`POST /functions/v1/search-available-now-barbers` accepts a verified client JWT and
the shared `searchAvailableNowBarbersRequestSchema`. Use `bookingType` to select
Available Now or Scheduled. Scheduled requires `scheduledFor`, searches configured
geographical coverage and returns `availableUntil: null`; this endpoint does not
promise a calendar slot. Available Now uses the current active session, server
time and the session's own coverage radius. Both also apply the client's radius.

The stored Connect projection and the shared reliability eligibility helper are
separate gates. Restricted reliability means last-group ranking; a failed Connect
gate excludes the barber. Active cooldown excludes Available Now only. Suspended
barbers are excluded from both types.

The response has strict public fields, a category price in integer cents, one of
four distance bands and a shared public SAL representative point. It contains no
exact barber point, exact distance, private contact information or reliability
history. Profile photos use one deduplicated private Storage signing request per
page and the existing signed-link lifetime. Ratings remain `null`/`0` until the
Phase 4 review implementation supplies the existing public rating projection.

## Ordering and pages

Read bounds from `discovery_radius_km` and `discovery_page_size`: initially 1–50 km
inclusive (fractions allowed), integer pages 1–50 and omitted-limit default 20.
Distance-band configuration mirrors the approved half-open 2/5/10 km boundaries.
Rank non-restricted first, then distance ascending, category price ascending,
rating descending with unrated last, rating count descending and barber UUID
ascending. The database applies the complete order before a bounded keyset page.
The query probes at most one extra eligible row for continuation.

Return `nextCursor` unchanged on the next request. It encrypts and authenticates
the private sort key using AES-256-GCM with a fresh 96-bit nonce. Authenticated
binding includes the verified client, normalized query, page size and config.
Changing these requires restarting with no cursor; invalid cursors return a
field-level 422. Never decode cursors in a client or log them. Pages recheck live
eligibility; stable traversal assumes unchanged data. Refresh after availability,
price or ranking changes. There is no frozen search snapshot.

## Local setup and verification

Start the existing local stack and apply migrations without resetting it. The
proof uses synthetic fixtures; it does not need Google or Stripe credentials.

```sh
pnpm db:start
pnpm db:migrate
node scripts/discovery/prepare-local.mjs
node scripts/db/local.mjs serve --env-file supabase/.env.discovery.local
```

The preparation command creates a separate ignored file with mode 0600 and a
random cursor key, preserving any existing file. It does not copy customer
credentials. Keep the serve process running, then in a second terminal run:

```sh
node scripts/db/verify-discovery-migration.mjs
node scripts/db/verify-discovery.mjs
```

Run database proofs sequentially. Migration verification replays in an isolated
database and proves populated upgrade preservation. API verification exercises
real local Auth → Edge → PostGIS → private Storage and writes sanitized evidence
to `docs/qa/evidence/P2-T04/`. It never resets the application database. Fixture
cleanup archives service-backed records rather than bypassing append-only rules;
synthetic immutable history remains. Spatial filler profiles without services
are removed. Avoid running this fixture-mutating proof against customer data or
a hosted target; its local wrapper rejects target overrides.

## Deployment handoff

This ticket was verified locally; it did not deploy to the customer's hosted
project. A release operator must apply the migration and configure only
`DISCOVERY_CURSOR_KEY` in the selected environment's function secret store before
deploying the new function. Generate an independent random 32-byte key, encode it
as base64 and keep its value out of shell output, source control and clients.
Keep the value stable across instances in that environment. Missing or malformed
configuration fails closed. Rotation deliberately invalidates old cursors;
clients should refresh on cursor validation errors. Do not upload a whole backend
env file or runtime-provided `SUPABASE_*` values.

The filter, results list, results map and booking draft tickets consume this
contract (`P2-T05`, `P2-T06`, `P2-T07`, `P2-T09`). UI and ETA remain outside this
backend ticket. See [acceptance evidence](../qa/P2-T04.md).
