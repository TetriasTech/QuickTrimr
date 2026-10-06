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
read-only and exits nonzero for unformatted code. These script names are the P0-T04 CI contract;
the full quality pipeline and branch protection remain P0-T04. The standalone P0-T03
client-environment guard already runs on every PR and push to `main`, without secrets.

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

P0-T09 owns the local Supabase CLI and migration workflow. Once it lands, use the root database
scripts it documents to start, stop, and reset the local stack. Schema changes belong in
`supabase/migrations`; local seed data belongs in `supabase/seed`. Never make an untracked schema
change in the hosted dashboard.

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
