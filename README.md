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
pnpm test
pnpm build
```

These root commands traverse every workspace. P0-T02 adds the shared TypeScript, ESLint and
formatting configuration; individual app and package tickets add their concrete tasks without
changing the root command contract.

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
