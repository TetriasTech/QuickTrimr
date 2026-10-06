# QuickTrimr admin shell — P0-T16 / TRIMR-25

Next.js App Router, TypeScript, Tailwind v4 and a manually installed, adapted shadcn/ui Button.
Real authentication belongs to P1-T02; the admin layout/component collection belongs to P0-T17;
operational data screens belong to Phase 5. This ticket does not connect to any backend.

## Local setup

From a clean checkout with the root README's Node/pnpm versions:

```bash
pnpm install --frozen-lockfile
pnpm --filter @quicktrimr/admin dev
```

Open <http://localhost:3000>. `/` redirects to `/login`. The public information page renders the
Tailwind theme and shadcn Button; its native form checks dashboard access and returns to `/login`.
**No `.env`, Supabase credentials, preview account or auth bypass is needed or supported.**

Future integrations use `adminEnv` in `src/lib/env.ts` and this app's public-only `.env.local`
template. Backend credentials do not belong in this app, including its server components.
See the [environment contract](../../docs/architecture/environment-variables.md).

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

## Server access contract (RULE-ADMIN-01)

- `src/lib/auth/session.ts` is server-only and currently always returns `null` in every environment.
- `requireAdmin()` awaits the session resolver, denies missing sessions with `/login`, denies
  non-admin roles with `/forbidden`, and only returns a server-resolved admin session.
- The `(admin)` layout **and** page await this guard before rendering. Do not fetch first and hide
  the result: nested pages can render independently of layouts. Every new protected loader, route
  handler and server action must independently await the guard **before** its first data operation.
- React `cache()` deduplicates checks within a render request; never use persistent caching for
  identity or access decisions. Protected routes are dynamic and must not be shared across users.
- P1-T02 must replace the session resolver with verified Supabase identity plus a database role
  lookup, and implement its full auth/expiry/audit requirements. Client-settable roles are not proof.
- Tests inject admin/non-admin sessions only via module mocks, never through a runtime flag/route.
  The protected empty shell is intentionally inaccessible in the running app until real auth lands.

Next may encode a redirect in a streamed HTML/RSC response after headers have been sent; denial
tests verify the redirect **and raw body**, not only the HTTP status or visible screen.

## Shared packages and UI boundaries (ADR-007)

The login Server Component executes `src/workspace-contract.ts`, importing all four workspace
packages through Next's bundler. `@quicktrimr/ui/metadata` is a platform-neutral subpath so Next does
not load the package's React Native components. Mobile imports/exports remain unchanged. Shared
roles and schemas are reused, not re-declared. Native primitives are not duplicated as web widgets;
P0-T17 will build the prescribed shared admin collection here.

`components.json`, CSS variables and `src/lib/utils.ts` configure shadcn additions. The shell's
Button uses the native-button/CVA pattern with only the needed variants and no client boundary.
Server Components are the default; `app/error.tsx` is a Client Component because retry calls `reset`.
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
