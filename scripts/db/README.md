# Database scripts

Root scripts invoke `local.mjs` for start/stop, migration creation/apply/reset and function serving.
It rejects target overrides so a local reset cannot become a hosted reset. `verify.mjs` queries
PostGIS in the named QuickTrimr container. `verify-live.mjs` is an explicit, destructive local
replay/runtime check; it requires `--allow-local-reset` and is not included in `pnpm test`.

See the [workflow](../../docs/architecture/local-supabase.md) and
[ticket evidence](../../docs/qa/P0-T09.md). Run from the repository root.
