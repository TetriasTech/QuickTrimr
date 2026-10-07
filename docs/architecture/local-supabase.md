# Local Supabase and migrations — P0-T09 / TRIMR-18

Owner: Tony. Implements `ADR-001`, `ADR-002` and `ADR-008`.

## Start from a clean clone

Install Node 24+, pnpm 11.9.0 and a running Docker-compatible runtime. The repository pins the
Supabase CLI 2.98.1 in its dev dependencies; a global CLI, hosted Supabase account and production
credentials are unnecessary for local work.

CLI 2.98.1 is the tested compatibility pin. The trial 2.120.0 CLI could inspect Docker but its
start command stalled on this machine. Update the pin in a reviewed change that repeats the
live checks. The package's binary installer verifies its release checksum; the repository's
release-age policy remains unchanged.

```bash
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:verify
```

The first start may download container images. QuickTrimr uses project ID `quicktrimr` and
separate ports from default-port stacks such as myClean:

| Service | Local endpoint |
| --- | --- |
| API / Auth / Functions | `http://127.0.0.1:55321` |
| Postgres | `127.0.0.1:55322` |
| Studio | `http://127.0.0.1:55323` |
| Development email inbox | `http://127.0.0.1:55324` |

Supabase's standard local stack publishes these ports on all interfaces. Use a trusted
development host and do not expose it to a public network. `db:verify` queries
`extensions.PostGIS_Full_Version()` and calculates a geography distance in Postgres. PostGIS
is enabled by the committed extension migration; there is no dashboard setup step.

`pnpm db:stop` stops only QuickTrimr and preserves its local data volumes. Restart with
`pnpm db:start`. Do not use `supabase stop --all` on a machine running other projects.
These wrappers reject hosted target flags, remove hosted operator credentials from their child
environment, and suppress CLI stdout that would print local private keys. They propagate errors.

## Create, apply and reset migrations

```bash
pnpm db:new add_booking_index
# Edit the new supabase/migrations/<UTC timestamp>_add_booking_index.sql.
pnpm db:migrate
pnpm db:verify
```

Migration names use `<14-digit UTC timestamp>_<lower_snake_case_name>.sql`. Use descriptive
names and review the SQL before applying it. `db:migrate` applies pending migrations with
`migration up --local`; an already applied migration is not applied again.

```bash
pnpm db:reset
```

**Reset erases QuickTrimr's local database data** and recreates it from the committed migrations.
It cannot target a linked/remote database through the wrapper. Keep irreplaceable data out of
this disposable stack. Seed loading is disabled until P0-T12 adds committed seed files and
updates config; P0-T09 includes only the PostGIS infrastructure migration. P0-T10 supplies the
application schema, and P0-T11 supplies its RLS.

Schema changes are files in a PR. A migration is immutable after merge: correct it with a new
migration, never edit, rename, delete or squash the merged file. Review the diff against `main`,
SQL ordering, reversibility/data-loss implications, and any required RLS/denial tests. Test both
applying the pending migration and replaying everything with a reset. A hosted dashboard edit
cannot replace a migration. PostGIS types/functions live in `extensions`; qualify them in SQL.

## Serve and invoke Edge Functions

```bash
pnpm functions:serve
```

The `workspace-contract` foundation probe uses a per-function `deno.json` to map
`@quicktrimr/shared` to the same shared source used by the apps. Its Deno entrypoint serves the
existing workspace identity; it returns no user, booking or financial data and makes no external
request. The default serve command selects the committed, credential-free `.env.example` so
the CLI does not auto-load an unrelated function `.env`. Gateway JWT verification stays enabled.
The local anon JWT is permitted for this
constant-only probe; it does not grant an authenticated user identity or marketplace permissions.

Invoke `GET http://127.0.0.1:55321/functions/v1/workspace-contract` with
`Authorization: Bearer <local-anon-jwt>`. Expected response:

```json
{"product":"QuickTrimr","surface":"function"}
```

Missing/forged JWTs return `401`; an authenticated non-GET request returns `405`, `Allow: GET`
and `{"error":"Use GET."}`. The live verifier below obtains the local JWT in memory, invokes
the real function, and prints only results, never private keys.

Future functions needing custom test-mode provider values may explicitly select the ignored
backend file:

```bash
pnpm functions:serve --env-file supabase/.env.local
```

Keep values in that file specific to local/test mode. Never pass production secrets or upload
the runtime-provided `SUPABASE_*` names as custom secrets. See the
[environment contract](environment-variables.md) for the permitted readers. Stop the foreground
server with Ctrl+C, and use `db:stop` when finished with the stack.

## Verification

`pnpm test` includes the credential-free command safety and probe behavior tests. Docker checks
are explicit and are not added to CI:

```bash
node --test scripts/db/local.test.mjs
pnpm db:verify
# Destructive: use only on a disposable QuickTrimr local database.
pnpm db:test:live --allow-local-reset
```

The live check resets twice, compares normalized `public`/`extensions` schema SHA-256 fingerprints
and migration history, checks PostGIS geography, and serves/invokes the real probe with success,
missing/forged JWT and method-rejection cases. It stops only the function-server process group
it created. See [ticket evidence](../qa/P0-T09.md) for actual runs and outstanding checks.

## Hosted project: main only

Hosted operations are a separate, deliberate operator step. This ticket does not link or push
any hosted database. After the PR is reviewed and merged, work from a clean, updated `main`:

```bash
git switch main
git pull --ff-only
```

Confirm `git branch --show-current` prints `main`, `git status --short` is empty, and the approved
QuickTrimr project reference matches the intended hosted environment. Then use the pinned CLI:

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <approved-quicktrimr-project-ref>
pnpm exec supabase migration list --linked
pnpm exec supabase db push --linked --dry-run
# Review the target and pending SQL before executing:
pnpm exec supabase db push --linked
```

Do not run these from a feature branch or use an existing myClean project link. Hosted login
and database credentials remain in the CLI credential store/operator environment, never tracked
files or app bundles. Never use a remote reset to apply a migration. The local wrappers do not
accept `--linked`, `--db-url`, `--all` or other target overrides.

References: [CLI installation](https://supabase.com/docs/guides/local-development/cli/getting-started),
[local migration workflow](https://supabase.com/docs/guides/local-development/cli-workflows),
[configuration](https://supabase.com/docs/guides/local-development/cli/config),
[PostGIS](https://supabase.com/docs/guides/database/extensions/postgis) and
[function dependencies](https://supabase.com/docs/guides/functions/dependencies).
