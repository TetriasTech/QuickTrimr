# QuickTrimr

QuickTrimr is a two-sided mobile marketplace that connects clients with travelling barbers. This
monorepo will contain the Expo mobile app, Next.js admin dashboard, shared TypeScript packages,
Supabase backend, operational scripts, and engineering documentation.

## Requirements

- Node.js 24 or newer
- pnpm 11.9.0

## Install

```bash
pnpm --version
pnpm install
```

The reported pnpm version must match the `packageManager` field in `package.json`. Use Corepack to
install that version when your Node distribution includes it; otherwise use pnpm's official
installation method before running the commands above.

Run all commands from the repository root. The lockfile is committed; CI and clean checkouts use
`pnpm install --frozen-lockfile`.

## Workspace commands

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm format:check
pnpm test
pnpm check:client-env
pnpm build
```

`typecheck`, `lint`, `test` and `build` traverse the workspaces; lint also covers repository
scripts. `format` writes the shared Prettier style across the repository; `format:check` is
read-only and exits nonzero for unformatted code. These script names are the P0-T04 CI contract.

## Continuous integration and reviews

Every PR targeting `main` and every push to `main` runs GitHub Actions CI, with no path filters:

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test` run independently.
- The separate client-env job runs `node scripts/check-client-env.mjs`, its negative tests,
  and `node scripts/jira/generate-indexes.mjs --check` to gate the ticket graph too.
- `CI required` waits for all five checks and fails if any fails, is skipped, or is cancelled.

The shared setup action installs Node 24 and the `packageManager`-pinned pnpm version, caches
the pnpm store by lockfile, installs with `--frozen-lockfile`, and generates Next's route types.
No application secrets, `.env` files, provider accounts or running services are needed; fork
PRs use read-only permissions. The client-env guard is now part of CI, not a duplicate workflow.

`main` requires **CI required** and **one approving review**, including administrators; force
pushes and deletion stay disabled. A contributor cannot approve their own PR. Review and merge
remain human actions. P0-T05 owns the checklist, and P6-T08 adds Playwright later. Deployment,
native builds and end-to-end browser tests are not part of this quality pipeline.

### Generated backlog indexes

The Docs workflow validates the graph and decision examples. After a relevant merge to `main`,
it generates sections 8 and 9 from the latest validated `main` snapshot and opens or updates a
PR on the bot-managed `codex/generated-indexes` branch. Only the backlog file is committed;
unchanged output creates no new PR. Do not edit this branch or generate indexes on feature
branches. The automation never pushes to `main`, approves, or merges (`RULE-DEV-CI`).

Repository Settings → Actions → General must allow GitHub Actions to create pull requests.
GitHub labels this setting **Allow GitHub Actions to create and approve pull requests**; this
workflow only creates them. Bot-created PR workflows may wait for a maintainer to select
**Approve workflows to run** in the PR. Then wait for `CI required`, review and merge normally.
No PAT or protection bypass is needed. See [GitHub's workflow-trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
and the [create-pull-request action](https://github.com/peter-evans/create-pull-request).

## Environment files

The current shells need no credentials. When an integration needs values, copy that surface's
template to `apps/mobile/.env.local`, `apps/admin/.env.local` or `supabase/.env.local`.
Existing Jira credentials stay in `scripts/jira/.env`, never an app file. Do not share filled
`.env` files or use one combined root file. See the
[environment contract](docs/architecture/environment-variables.md) for public-only typed accessors,
per-variable readers, Google key restrictions, and local/staging/production setup.

### Quality configuration

- Every workspace extends `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride` and `exactOptionalPropertyTypes`. Mobile and UI retain Expo's base;
  admin retains Next's plugin and generated route types.
- `@quicktrimr/shared` resolves through its existing pnpm workspace link and package exports
  in mobile, admin and the Supabase function. There is no compiler-only alias hiding a missing
  runtime link. App-local `@/*` aliases stay local to their app.
- One ESLint flat config enforces TypeScript, React/Hooks, import ordering and typed promise
  checks. `any`, unhandled promises (including `void promise`) and missing hook dependencies
  are errors. Handle failures explicitly; do not silence a money call with `void`.
- Static `no-restricted-imports` rules plus resolved-path checks prevent cross-app imports and
  keep domain/shared production source free of I/O imports, including dynamic imports,
  CommonJS and relative-path escapes. Domain may import shared. Test runners can use Node I/O.
- Generated/native/build output, dependencies and intentional negative fixtures are excluded.
  Required generated Expo/Next declaration files still participate in TypeScript resolution.
  Prettier checks code/configuration, not Markdown specifications, historical evidence or
  lockfiles. In particular it never rewrites the generated backlog sections.

Run `node --test scripts/quality/quality.test.mjs` for the negative/positive fixtures, actual
ESLint/Prettier exit-code checks, compiler strictness tests, import resolution and ignore checks.
It is included in `pnpm test`. Fixtures end in `.fixture` and are linted as real workspace
files without overwriting source. These checks need no environment secrets or running services.

Tooling uses the existing pinned ESLint 9 / TypeScript 6 framework-compatible baseline; this is
not an Expo, Next or TypeScript-major upgrade. See [typed linting](https://typescript-eslint.io/getting-started/typed-linting/)
and [ESLint import restrictions](https://eslint.org/docs/latest/rules/no-restricted-imports).

## Run the mobile app

P0-T13 owns the Expo shell. Once it lands, start it from the root with:

```bash
pnpm --filter @quicktrimr/mobile start
```

## Run the admin dashboard

Start the Next.js shell from the root with:

```bash
pnpm --filter @quicktrimr/admin dev
```

Open [localhost:3000](http://localhost:3000). The server redirects to `/login`, a foundation
preview, because the placeholder denies all dashboard access until P1-T02 implements real auth.
No `.env` file or credentials are needed for this shell. See
[admin setup and verification](apps/admin/README.md) for build, tests and Vercel configuration.

## Run Supabase locally

With a running Docker-compatible runtime, start the isolated QuickTrimr stack:

```bash
pnpm db:start
pnpm db:verify
pnpm functions:serve
```

The API is at `http://127.0.0.1:55321` and Studio at `http://127.0.0.1:55323`; these ports keep
the stack separate from myClean/default Supabase projects. No hosted account or production
credentials are needed. `pnpm db:stop` preserves local data; `pnpm db:reset` erases only the
QuickTrimr local database and replays migrations. Use `pnpm db:new <lower_snake_case_name>` and
`pnpm db:migrate` for migration work. See the [local workflow](docs/architecture/local-supabase.md)
for naming/review conventions, function invocation, live verification and main-only hosted pushes.
Schema changes belong in committed migrations; never replace one with a hosted dashboard edit.
The [core schema contract](docs/architecture/core-schema.md) documents the 21-table deny-all
foundation, followed by [read-only RLS policies](docs/architecture/baseline-rls.md). On a disposable local stack, run `pnpm db:test:core --allow-local-reset` for its
catalog, concurrency, retention and API-denial evidence; this command erases local data.

## Repository map

- `apps/mobile` — Expo app for client and barber journeys
- `apps/admin` — web-only Next.js admin dashboard
- `packages/shared` — shared types, constants and enums; no I/O
- `packages/domain` — pure business rules; no I/O
- `packages/validation` — shared validation schemas
- `packages/ui` — shared UI primitives
- `supabase` — Edge Functions, migrations and seed data
- `scripts` — Jira, database and Stripe tooling
- `docs` — architecture, decisions, API and QA documentation

The knowledge base is the upstream source of truth. Start ticket work through the repository's
`pick-up-quicktrimr-ticket` skill so the readiness and traceability checks run before implementation.
