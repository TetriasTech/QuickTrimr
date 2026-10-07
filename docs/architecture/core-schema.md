# Core schema foundation — P0-T10

Migration: `supabase/migrations/20261007100000_core_schema.sql`, following the merged
PostGIS prerequisite. This is a **minimal schema foundation**, not a completed booking,
payment, payout or account-deletion feature.

## Relationships and fields

`profiles.id` is the Supabase Auth user ID. `client_profiles.id` and `barber_profiles.id`
reference that ID; no second identity is accepted from a mobile payload. The profile holds the
shared role and verification enum, without a default role or verification decision.

| Group | Core relationships / data |
|---|---|
| Marketplace | Addresses → client; services → barber and category; Available Now sessions → barber. Address/session locations and barber service-area origin use PostGIS geography. |
| Booking | Request and booking → client and barber; booking → request; booking services → booking and barber service. Booking stores original price, whole-percentage commission snapshot and gross/commission/net cents independently of current service pricing. |
| Financial | Payments → booking; earnings → booking and barber. One earning per booking. Batch items → batch and barber, representing per-barber obligations, not an invented one-earning-per-payout model. |
| Evidence | Status history → booking and optional human actor; audit → optional human actor and polymorphic entity; reliability events → barber and optional booking. Reliability state uses the barber ID. |
| Other | Disputes and reviews → booking; one review per booking. Notifications → recipient profile. |

All money is PostgreSQL `integer` cents, with `_cents` names and no financial defaults. Status,
role, verification and reliability values are required inputs from the eventual server handlers,
not schema defaults. All 11 PostgreSQL enum types exactly match the shared tuple labels/order.

Every table has UUID identity and `created_at` / `updated_at` timestamps. Mutable tables refresh
`updated_at` from the database statement time, ignoring the supplied replacement timestamp.
Evidence tables also carry both timestamps, but reject update/delete/truncate; a correction is a
new record. Trigger helpers are in the non-API `private` schema, use an empty search path, and
do not elevate a caller's privileges.

History/audit rows use a nullable **pair** of human actor ID and role: both present or both
absent. A server-originated event must not impersonate a human or invent a fourth user role;
the owning handler records its truthful action/reason. Audit `entity_id` is polymorphic, so it
cannot have a foreign key to one entity table. Other relationships have explicit foreign keys.

All foreign keys use `ON DELETE RESTRICT`. Removing an Auth account or profile cannot cascade
away bookings, payments or their evidence. This deliberately **blocks deletion**; it does not
promise account erasure or anonymisation. A future erasure feature must handle retention
deliberately, rather than changing these to cascading deletes.

## Access and indexes

RLS is enabled on all 21 tables **inside the migration transaction**, before commit. There are
no policies or public views yet. Anonymous and authenticated callers cannot even read their own
rows; `P0-T11` adds authorised access. DML grants exist so denial is genuinely RLS, not an absent
table privilege. `TRUNCATE` is revoked from application roles because RLS does not govern it.
Append-only triggers also reject privileged mutation of existing evidence.

Indexes cover every foreign key (without duplicating a leading full PK/unique index), created
dates, and the ticket's booking/request/session/payment/dispute access patterns. GiST indexes
cover session locations and barber service area. A partial unique index permits at most one
`active` session per barber, without prohibiting historical expired sessions. It is not the
later accepted-job concurrency guard.

Profile/contact/address text, catalogue names, session radius/source/deadline, request deadlines
and address/service selections, cancellation snapshots, Stripe references, rating/review fields,
notification delivery, reliability policy evidence, payout period/allocation/retry guards and
all feature APIs/UI are **not built here**. Their owners add migrations with their feature.
No payout is executable merely because these tables exist.

## Reproduce the evidence

Use only a disposable local QuickTrimr stack; these checks reset its database. No real `.env`,
customer account or hosted credentials are needed. They never link/push to hosted Supabase.

```sh
pnpm db:start
pnpm db:test:live --allow-local-reset
pnpm db:test:core --allow-local-reset
pnpm db:stop
```

The replay test compares two normalized schema hashes and migration history, then exercises the
real Edge runtime. The core test inspects live catalogs, proves uniqueness with repeated parallel
processes and observed lock contention, tests FK retention/append-only/timestamps, and creates
disposable Auth users to call the real PostgREST API. Every table/every verb is checked against
raw responses, with privileged positive controls and unchanged stored-row evidence. All POST
fixtures first pass a privileged insert rolled back in PostgreSQL, excluding invalid-payload
false positives. The verifier resets again on completion/failure to remove its users and rows.

The 12 committed-SQL enum tests run in normal credential-free `pnpm test` / CI. Docker checks
remain explicit. `db:test:core` is this foundation's deny-all contract; it must be updated when
`P0-T11` intentionally introduces policies, preserving negative coverage and adding own-user
positive checks rather than treating every future authorised response as a regression.

References: [PostgreSQL 17 RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html),
[foreign-key deletion behavior](https://www.postgresql.org/docs/17/ddl-constraints.html),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
