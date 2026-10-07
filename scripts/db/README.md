# Database scripts

Root scripts invoke `local.mjs` for start/stop, migration creation/apply/reset and function serving.
It rejects target overrides so a local reset cannot become a hosted reset. `verify.mjs` queries
PostGIS in the named QuickTrimr container. `verify-live.mjs` is an explicit, destructive local
replay/runtime check; it requires `--allow-local-reset` and is not included in `pnpm test`.

`verify-core.mjs` (`pnpm db:test:core --allow-local-reset`) verifies P0-T10's live catalogs,
unique constraints under real contention, retention/append-only enforcement and the current
read-only RLS contract. It creates synthetic local Auth users/rows and resets again to remove them. Never run
either reset verifier against local data you need to retain. `core-fixtures.mjs` is test-only;
it is not seed data or a production write path. `core-schema.test.mjs` checks committed SQL enum
parity in credential-free CI. `local-api.mjs` shares the fixed local status lookup without logging
its in-memory private keys.

See the [workflow](../../docs/architecture/local-supabase.md) and
[ticket evidence](../../docs/qa/P0-T09.md). Run from the repository root.
See also the [core schema contract](../../docs/architecture/core-schema.md).
The [RLS contract](../../docs/architecture/baseline-rls.md) describes owned/admin reads, narrow
projections, future-column grants and denied writes. `api-test-helpers.mjs` supplies reusable
local Auth/HTTP/raw-response denial helpers to the core and RLS verifiers; its safety tests run
without Docker in `pnpm test`.

`seed-data.mjs` builds deterministic foundation cases from shared enums and SQL serialization;
`--write` regenerates the committed `supabase/seed/foundation.sql`, and `--check` detects drift.
`seed.mjs` (`pnpm db:seed`) applies that insert-only transaction to the fixed local container,
rejecting target overrides. Default `db:reset` loads seeds; the internal `reset-empty` command
passes `--local --no-seed` for the core/replay verifiers and their cleanup.

`verify-seed.mjs` (`pnpm db:test:seed --allow-local-reset`) tests complete reset/reseed/reset
fingerprints, enum/relationship/money coverage, preservation of edited/unrelated/append-only
data, atomic rollback, PostGIS index eligibility, and raw seeded-row RLS/API positives/denials.
It uses real local Auth links without committed passwords and restores pristine seeds on exit.
Do not run reset verifiers concurrently: they own the same disposable QuickTrimr database.
See [seed usage and deferred fields](../../supabase/seed/README.md) and
[P0-T12 evidence](../../docs/qa/P0-T12.md).
