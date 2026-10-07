# Baseline RLS — P0-T11

Migration: `supabase/migrations/20261008000000_baseline_rls.sql`. This adds authorised reads to
P0-T10's protected schema. It does not implement profile signup, admin UI, discovery, booking
transitions, payment movement or feature-specific writes.

## Read contract

The user's application role is read from `profiles` using the verified JWT's `auth.uid()`.
`private.current_user_role()` is a stable, no-argument security-definer function owned by
`postgres`, with an empty search path and fully qualified references. It bypasses profile RLS
only to look up **the caller's** role, avoiding recursion. It cannot accept another user ID.
User/app JWT metadata never grants access. A missing profile returns no role and fails closed.
The helper is outside the exposed API schemas; there is no public role-lookup RPC.

| Resource | Client | Barber | Admin |
|---|---|---|---|
| `profiles` | Own | Own | All |
| `client_profiles`, `client_addresses` | Own | None | All |
| `barber_profiles`, `barber_services`, `available_now_sessions` | None | Own | All |
| `booking_requests`, `bookings` | Own client rows | Addressed/assigned rows | All |
| `disputes` | Own booking | None | All |
| `reviews` | Own booking | Own booking | All |
| `barber_earnings` | None | Own | All |
| `payments` base table | None | None | All |
| `client_payments` view | Own booking's safe payment fields | None | None; uses base table |
| `public_barber_profiles` view | Barber IDs | Barber IDs | Barber IDs |
| Categories, booking services, notifications, reliability, history/audit, payout internals | None | None | All |

All 21 tables retain RLS. The 32 policies are SELECT-only and restricted to authenticated callers;
every policy gates on the database role helper. No INSERT/UPDATE/DELETE policy exists, even for
an admin. Direct application writes are denied by RLS, not merely prevented by the UI. Existing
privileged append-only triggers and application TRUNCATE revocation remain intact.

Anonymous reads are denied at the privilege boundary. Authenticated users have column-level
SELECT grants for the fields delivered by P0-T10, not a blanket table grant. Adding a column does
not make it readable automatically, including to an admin application JWT. Its owning migration
must deliberately update grants/projections and the raw-response tests. A wildcard select that
includes an ungranted new field fails closed rather than exposing it.

The two views deliberately use **owner rights** (`security_invoker=false`), with
`security_barrier=true`, explicit column lists, role/ownership predicates, and SELECT-only grants.
They bypass base-table RLS only for that tightly defined projection. Switching to invoker rights
would hide the public/own-client rows; widening a predicate would leak data. Review those choices
and raw responses together, not just the presence of RLS on their source tables.

`public_barber_profiles` publishes only `id`. No public name/photo exists in the core schema,
and exact service-area geography is private. This is not a discovery search or Connect-eligibility
assertion. Future profile fields are explicitly published by the owning feature.

`client_payments` returns exactly `id`, `booking_id`, `status`, `gross_cents`, `refunded_cents`,
`created_at`, `updated_at` for the caller's own booking. Clients cannot query the base payment
table. Future provider references/private fields cannot leak through this projection or a base
table/embedded-relation bypass.

Barbers have **no** address/contact access in this foundation, including through embedded
relations on a pending request. The accepted-active booking projection is feature-owned once
the needed fields and relationships exist. Other non-admin reads stay closed until their owning
feature introduces them. Do not interpret a missing Phase 0 policy as a permanent product denial.

## Extend and test

Use this pattern rather than reading roles from metadata or widening a policy to make a screen
work. A feature that adds writes must narrow column grants for server-owned identity/role/status/
money fields **before** enabling a write policy. Admin writes still require server authorisation
and safe audit records. An admin read policy is not an admin write capability.

`scripts/db/api-test-helpers.mjs` provides `apiRequest`/`apiJson`, real local Auth fixture users,
`assertRawBody` and `assertDenied`. Target/origin guards prevent sending local keys to a hosted or
cross-origin URL. Failures suppress protected row/error values. This helper is shared by the
core verifier and `rls-verification.mjs`, and is available to later tickets. Redirects fail
rather than forwarding headers to another endpoint.

On a **disposable** local QuickTrimr stack:

```sh
pnpm db:start
pnpm db:test:live --allow-local-reset
pnpm db:test:core --allow-local-reset
pnpm db:stop
```

The core command now tests the current read-only RLS baseline, not historical P0-T10 deny-all
reads. It retains all schema/uniqueness/retention tests, then proves own/admin positives,
cross-user negatives, all denied write verbs, actual signed metadata forgery, database role
grant/revocation with the same JWT, HEAD count privacy and denied PUT/merge-upsert paths,
no-profile/anonymous/forged callers, view/embedding privacy
and actual newly added private-column probes. It resets again to remove disposable users/rows
and temporary probes. No hosted account, real `.env` or customer credentials are required.

Live Docker checks remain explicit; credential-free CI checks the reusable assertion/target
guards plus the existing enum/quality suite. See [evidence](../qa/P0-T11.md).

References: [PostgreSQL 17 RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html),
[view security and privileges](https://www.postgresql.org/docs/17/sql-createview.html),
[Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).
