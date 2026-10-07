# Migrations

All schema changes are committed migrations, named `<14-digit UTC timestamp>_<lower_snake_case>.sql`.
Create with `pnpm db:new <name>`, apply with `pnpm db:migrate`, and replay with `pnpm db:reset`.
**Reset erases QuickTrimr local data.** These commands cannot select a hosted database.

A merged migration is immutable: a correction is a new migration. Review SQL and ordering and
prove both apply and replay before merge; hosted dashboard edits are never the source of truth.

P0-T09's first migration enables PostGIS in `extensions`, outside the exposed API schemas.
P0-T10 adds the core application schema, P0-T11 its RLS, and P0-T12 the committed seed data.
See the [local workflow](../../docs/architecture/local-supabase.md).
