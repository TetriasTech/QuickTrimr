# QuickTrimr admin

Next.js App Router, TypeScript, Tailwind v4 and a manually installed, adapted shadcn/ui Button.
P1-T02 adds Supabase Auth to the guarded shell. Operational data screens belong to Phase 5.

## Local setup

From a clean checkout with the root README's Node/pnpm versions:

```bash
pnpm install --frozen-lockfile
pnpm --filter @quicktrimr/admin dev
```

Open <http://localhost:3000>. `/` redirects visitors to `/login`. To sign in, configure
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in this app's ignored `.env.local`,
apply the database migrations, and use an existing confirmed Supabase Auth account with an admin
profile assigned through the authorised provisioning process. The admin app uses only the public
project URL and anon credential. See the [environment contract](../../docs/architecture/environment-variables.md).

```bash
pnpm --filter @quicktrimr/admin typecheck
pnpm --filter @quicktrimr/admin lint
pnpm --filter @quicktrimr/admin format
pnpm --filter @quicktrimr/admin test
pnpm --filter @quicktrimr/admin build
pnpm --filter @quicktrimr/admin start
```

For browser and raw-response checks, build first, install Playwright's Chromium once, then:

```bash
pnpm --filter @quicktrimr/admin exec playwright install chromium
pnpm --filter @quicktrimr/admin test:e2e
```

The tests start the production server on `127.0.0.1:3100`; leave that port free. HTML and RSC
requests try forged role parameters, cookies and headers, including a forged admin claim. Browser
tests inspect requests, console errors, computed Tailwind styles and navigation. Screenshots and
failure traces are written under ignored `test-results/`.

With local QuickTrimr Supabase running and Chromium installed, run
`node scripts/db/verify-admin-auth-live.mjs` from the repository root. It starts its own
server on `127.0.0.1:3102` after building against the local API, and uses disposable local Auth accounts.

For positive component interactions, run the separate synthetic-only harness after building:

```bash
pnpm --filter @quicktrimr/admin test:fixtures
# Or inspect it locally after building, from the repository root:
node scripts/qa/admin-fixture-server.mjs
```

The harness binds only `127.0.0.1:3101`; leave that port free. It bundles `fixtures/client.tsx`
outside Next's app routes and uses the real compiled CSS. It projects P0-T12's in-memory seed
bookings to `id`, `status`, `gross_cents`, serves one bounded page and a filtered count, and
simulates a rejected/retried reason submission without performing a business action. It accepts
no credentials, environment-file loading or target URL and does not connect to a database.
Fixture identity is explicitly **not signed in**. This is component-protocol evidence, not
authenticated Phase 5 query evidence. Nothing imports this harness from the production app.
Screenshots are under `test-results/fixtures/`; the tests stop only their own server.

The default build uses Turbopack. If a restricted host blocks its CSS worker's port binding,
`pnpm --filter @quicktrimr/admin exec next build --webpack` is a supported local verification
alternative; do not change the build policy or interpret that host error as a passing default build.

## Server access contract (RULE-ADMIN-01)

- `requireAdmin()` uses only database-verified identity and role. Navigation without a session
  redirects to `/login`. Expired sessions redirect to `/login?reason=expired`. A verified non-admin
  request receives the forbidden page with HTTP 403.
- The `(admin)` layout **and** page await this guard before rendering. Do not fetch first and hide
  the result: nested pages can render independently of layouts. Every new protected loader, route
  handler and server action must independently await the guard **before** its first data operation.
- React `cache()` deduplicates checks within a render request; never use persistent caching for
  identity or access decisions. Protected routes are dynamic and must not be shared across users.
- The eight-hour deadline (`CFG-ADMIN-SESSION-HOURS`) is measured from the provider's session
  creation time and checked in the database. Refreshes keep the same deadline. Opening and closing
  the dashboard session append audit entries. The admin cookie is HttpOnly, Secure and SameSite=Lax.
- New protected pages, loaders and actions must use `requireAdmin()` independently of the Next
  proxy. The proxy gives HTML and RSC denials an HTTP status before streaming starts.

## Shared packages and UI boundaries (ADR-007)

The login Server Component executes `src/workspace-contract.ts`, importing all four workspace
packages through Next's bundler. `@quicktrimr/ui/metadata` is a platform-neutral subpath so Next does
not load the package's React Native components. The additive `@quicktrimr/ui/presentation` subpath
contains pure money/status presentation; both surfaces reuse it without putting React Native into
the web bundle. Mobile component APIs remain unchanged. Shared roles and schemas are reused, not
re-declared; the [shared admin collection](src/components/README.md) provides web adapters.

`components.json`, CSS variables and `src/lib/utils.ts` configure shadcn additions. The shell's
Button uses the native-button/CVA pattern with only the needed variants and no client boundary.
Server Components are the default; the error boundary, controlled table and confirmation dialog
are Client Components for retry, table intent and native modal/async interaction respectively.
Loading and error content contain no operational details. No fonts or assets require network access.

## Vercel configuration only — do not deploy yet

`apps/admin/vercel.json` defines the framework, frozen workspace install and Next build. When
deployment is authorised, set the Vercel project's **Root Directory** to `apps/admin`, allow files
outside that directory (the shared packages), and select Node 24.x. Retain the pinned pnpm version
in the repository's `packageManager` field. No Vercel project was linked and nothing was deployed.

## Reference guidance

- [Next authentication and layout caveats](https://nextjs.org/docs/app/guides/authentication)
- [Next workspace transpilation](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages)
- [shadcn manual installation](https://ui.shadcn.com/docs/installation/manual)
- [Vercel monorepo configuration](https://vercel.com/docs/monorepos)
