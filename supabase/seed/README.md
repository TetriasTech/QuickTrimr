# Seed data

`foundation.sql` is the committed P0-T12 / TRIMR-21 local fixture transaction. Supabase loads it
after migrations during `pnpm db:reset` (and an initial start without saved database volumes).
It is **not production/staging data**, a migration, or a provider/state-machine implementation.
Use only the isolated QuickTrimr local stack on a trusted development host.

```sh
pnpm db:start
pnpm db:reset                      # destructive: restores pristine fixtures
pnpm db:seed                       # insert missing fixture IDs, preserve existing data
pnpm db:test:seed --allow-local-reset # destructive live suite; restores pristine fixtures
pnpm db:stop                       # preserve QuickTrimr volumes; do not stop myClean
```

The wrappers accept no hosted target overrides or external SQL files. Never run a linked/remote
reset or deploy these seed files to a customer project. No real `.env` or hosted credentials are
needed. RLS remains read-only for application users, including admins; seeding uses privileged
SQL in the fixed `supabase_db_quicktrimr` container, not relaxed policies or a client API.

## Cases and identities

Source: `scripts/db/seed-data.mjs`. UUIDv5 IDs derive from a fixed namespace and stable case
names, not array positions or random values. All seed timestamps are `2026-10-08T00:00:00.000Z`.
Do not rename a case to reorder it; that creates a new identity rather than updating the old one.

| Fixture group | Coverage |
| --- | --- |
| Auth/profiles | 1 admin, 2 clients, 5 barbers; all verification and reliability levels |
| Categories/services | 5 category IDs mapped to approved launch slugs; 25 barber services at the documented 4500-cent example price |
| Requests/bookings | 24 cases; all request/booking statuses and both booking types |
| Payments/earnings | All 9 payment and 5 earning statuses; capture failure, full and illustrative partial service refund |
| Payouts/disputes | All 6 payout and 7 dispute statuses; per-barber batch items |
| Evidence/other | Initial history and audit snapshot per booking; reviews, notifications, reliability events; every starting table populated |

Examples use `RULE-PAY-11`'s 4500/900/3600-cent booking snapshot, shared with the core verifier.
Full/half service-refund cases retain 0/0 and 450/1800 cents respectively in the earning;
the original booking snapshot stays unchanged. These are worked-example fixtures, not config
defaults, a cancellation entitlement or a second financial calculation engine.
Payout items are unallocated foundation examples; provider attempts/allocation/settlement
reconciliation do not exist yet. No payment, refund or bank transfer is made by seeding.

History starts at `from_status = null` with an explicitly synthetic snapshot reason. It does not
pretend a real actor performed transitions. Audit snapshots have no human actor and safe
synthetic metadata. Corrections append new IDs; evidence is never updated/deleted.

Auth emails are `quicktrimr-seed-…@example.com`. These rows establish relationships only:
there are **no passwords, linked identities or login-ready seed accounts**. The live verifier
temporarily prepares GoTrue's local instance ID/text placeholders, generates local one-time links through the
privileged Auth API, and verifies them for genuine user JWTs. It never sends email or logs those
links/tokens, and its final reset removes sessions, temporary Auth changes and extra test users.
Do not treat the seeded admin as customer access provisioning.

## Geography and privacy

Locations are synthetic offsets around Sydney's city origin, not copied residential coordinates.
Five barber origins fall within 25 km; the bounded PostGIS test probe finds 2 of 5 within 5000 m.
Those distances and `LIMIT 10` are **test data**, not discovery radius/config/precision rules.
The tiny dataset naturally permits sequential scans; the verifier disables them transactionally
only to demonstrate the existing GiST index is eligible, not to claim a production query plan.

No real names, phones, street/unit addresses, provider IDs, passwords or tokens are stored in
the committed fixture. Geography fields remain behind existing RLS; the public barber view
returns only IDs. Seeded pending/completed/cancelled bookings do not expose client-profile
embeddings to barbers. Contact disclosure for accepted-active bookings is still feature-owned.

## Adding or restoring a case

1. Update the fixture source, reusing shared enums and `core-fixtures.mjs` SQL serialization.
   Choose a permanent case name; keep ownership/relationships and money examples coherent.
   A new enum requires an explicit scenario, not a guessed financial meaning.
2. Run `node scripts/db/seed-data.mjs --write` to mechanically regenerate `foundation.sql`.
   `node scripts/db/seed-data.mjs --check` and `pnpm test` fail on stale SQL or missing coverage.
3. Run `pnpm db:seed` to insert new cases without changing existing rows. An edited fixture
   deliberately stays edited; use `pnpm db:reset` on disposable data to restore it. There is no
   destructive "repair" or evidence upsert command. Unrelated rows are preserved on reruns.
4. Run `pnpm db:test:seed --allow-local-reset` and the core/replay checks before review.
   A seed failure rolls back the complete transaction. The seed verifier finishes with pristine
   seeds, while core/replay verifiers reset **without seeds** and leave an empty local database.
   Run `pnpm db:reset` afterwards if you want seed data back for development.

## Deferred feature coverage

These cases are intentionally **not built or proven** by P0-T12. Their owning feature PR must
extend both this source/SQL and tests when its migration lands, preserving existing identities:

| Missing fields/behaviour | Owning tickets |
| --- | --- |
| Catalogue slug/name/order/bounds/archiving columns | P1-T10 |
| Client/barber name, profile and contact fields | P1-T04 / P1-T06 |
| Street/unit/address labels and contacts | P1-T05 |
| Connect IDs, capabilities and restrictions / discovery exclusion | P1-T07 / P1-T09; discovery feature tests |
| Review rating/content/visibility; hidden review aggregation | P4-T14 |
| Provider references, deadlines, earning allocation and payout attempts | Their booking/payment/payout feature tickets |

The category-to-slug mapping lives in the fixture source and SQL comments because category
attributes do not yet exist as columns. Verification/reliability levels are not Stripe account
capabilities, and an `admin_resolved` fixture is not proof of refund/release/review eligibility.
Do not build an admin/mobile feature by assuming these absent fields are already seeded.

Evidence: [P0-T12 report](../../docs/qa/P0-T12.md). Upstream patterns:
[Supabase seed configuration](https://supabase.com/docs/guides/local-development/seeding-your-database),
[local workflow/Auth fixture distinction](https://supabase.com/docs/guides/local-development/cli-workflows),
[Auth link API](https://github.com/supabase/auth/blob/master/README.md#post-admingenerate_link).
