# Environment contract — P0-T03 / TRIMR-12

Owner: Tony. Implements `ADR-001`, `ADR-008`, `RULE-PAY-10`, `RULE-ETA-02`.
The templates define names and permitted readers, **not credentials**. Blank values are
intentional. Account provisioning, deployment and monitoring integrations are separate tickets.

## Where your `.env` goes

| File | Reader | Contents |
|---|---|---|
| `apps/mobile/.env.local` | Expo bundler | Only the public mobile template |
| `apps/admin/.env.local` | Next build/dev process | Only the public admin template |
| `supabase/.env.local` | Explicitly selected local Edge Function process | Custom backend values only |
| `scripts/jira/.env` | Jira operator script | Jira values only; your existing file stays here |
| Root `.env.example` | Humans/operator tooling reference | Jira inventory and runtime-owned inputs; not an app config |

Do not put an all-in-one `.env` at the root. Never source a backend/operator file into an app
build. All real env files are git-ignored; only `.env.example` is tracked. Do not force-add them.
Create files only if absent; do not overwrite an existing local configuration:

```sh
test -e apps/mobile/.env.local || cp apps/mobile/.env.example apps/mobile/.env.local
test -e apps/admin/.env.local || cp apps/admin/.env.example apps/admin/.env.local
test -e supabase/.env.local || cp supabase/.env.example supabase/.env.local
test -e scripts/jira/.env || cp scripts/jira/.env.example scripts/jira/.env
```

Current mobile/admin shells and quality checks still need **no credentials**. Future integrations
read a getter only when they actually need its configuration. An unset/blank required value throws
a name-only error, not a silent default or the supplied value. Do not spread or log the accessor.

## Public values: app-specific names, shared validation

Use `mobileEnv` from `apps/mobile/src/lib/env.ts` and `adminEnv` from
`apps/admin/src/lib/env.ts`. No arbitrary-name lookup or private properties are exported.
Validation is pure and reused from `@quicktrimr/validation`; each app explicitly reads its own
static names. App code must use these accessors; ESLint rejects direct reads elsewhere,
environment aliasing/destructuring/spreading and dynamic/computed access. The only current
non-accessor exception is the runner's `CI` flag in the Playwright configuration.

| Public purpose / getter | Mobile variable | Admin variable |
|---|---|---|
| Supabase endpoint / `supabaseUrl` | `EXPO_PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| Supabase anon credential / `supabaseAnonKey` | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Android map rendering / `googleMapsAndroidApiKey` | `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY` | — |
| iOS map rendering / `googleMapsIosApiKey` | `EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY` | — |
| Browser map rendering / `googleMapsApiKey` | — | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` |
| Stripe payment SDK / `stripePublishableKey` | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | — |
| Sentry ingestion / `sentryDsn` | `EXPO_PUBLIC_SENTRY_DSN` | `NEXT_PUBLIC_SENTRY_DSN` |
| PostHog project ingestion / `posthogKey` | `EXPO_PUBLIC_POSTHOG_KEY` | `NEXT_PUBLIC_POSTHOG_KEY` |
| PostHog ingestion endpoint / `posthogHost` | `EXPO_PUBLIC_POSTHOG_HOST` | `NEXT_PUBLIC_POSTHOG_HOST` |
| Deployment label / `appEnvironment` | `EXPO_PUBLIC_APP_ENV` | `NEXT_PUBLIC_APP_ENV` |

Supabase anon values are public **because RLS is the access boundary**, not because the key is
hidden. A Sentry ingestion DSN and a PostHog project ingestion key are public, not management
credentials. The last four getters reserve the interface for P6-T03/P6-T04; they do not initialize
SDKs or send telemetry. Stripe SDK wiring is likewise not implemented here.

Expo requires literal `process.env.EXPO_PUBLIC_NAME` access to inline values; destructuring or
bracket lookup will not work. Its public values are readable from the shipped bundle. Load
`.env.local` from the app directory, restart when changing configuration, and do not use
`NODE_ENV` to choose staging versus production. [Expo environment guide](https://docs.expo.dev/guides/environment-variables/)

Next's `NEXT_PUBLIC_` values are also build-time client configuration. Build separately for each
target environment; changing a runtime server variable does not retarget an already-built
browser bundle. Never use `next.config`'s `env` option to export a private value.
[Next environment guide](https://nextjs.org/docs/app/guides/environment-variables)

## Backend and operator values

| Name | Permitted reader and meaning |
|---|---|
| `SUPABASE_URL` | Edge Functions: runtime-provided project endpoint |
| `SUPABASE_ANON_KEY` | Edge Functions: runtime-provided anon credential for caller-scoped requests |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only: runtime-provided privileged credential; bypasses RLS |
| `STRIPE_SECRET_KEY` | Edge Functions only: Stripe API credential |
| `STRIPE_WEBHOOK_SECRET` | Edge Functions only: signing secret for the exact endpoint/listener |
| `GOOGLE_MAPS_SERVER_API_KEY` | Edge Functions only: Google Routes and Places credential |
| `STRIPE_CONNECT_RETURN_URL` | Edge Functions only: approved Connect return destination, not client input |
| `STRIPE_CONNECT_REFRESH_URL` | Edge Functions only: approved Connect refresh destination, not client input |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_PROJECT_KEY` | Operator script only: site, service account and fixed `TRIMR` project |
| `JIRA_API_TOKEN` | Operator script only: password-manager-held service-account token |
| `JIRA_AC_FIELD` | Operator script only: optional custom field; blank uses description |
| `JIRA_ACCOUNT_TONY`, `JIRA_ACCOUNT_ANDREW` | Operator script only: assignee IDs, not secrets |

The Supabase template leaves runtime-provided names commented out so blank assignments do not
override injected credentials. A local file must be passed explicitly:

```sh
# After P0-T09 establishes the local CLI workflow:
supabase functions serve --env-file supabase/.env.local
```

Supabase supplies its own `SUPABASE_*` variables in Edge Functions. Do not upload those names
as custom secrets, and do not assume a root `.env` automatically reaches functions. Hosted
custom values belong in the selected project's Edge Function secret store, not app settings.
[Supabase function environment reference](https://supabase.com/docs/guides/functions/secrets)

Runtime-owned `CI`, `PATH`, `EXPO_OS`, `NODE_ENV` and the historical spike's `INNGEST_DEV`
are explained in the root template; engineers do not copy values for them. `MODULE` in the
quality test is intentional synthetic source used to prove dynamic imports fail, not configuration.
New integrations must add their own variable to the appropriate template, this contract and
tests before use. Any new server-only credential name must also extend the client guard.

## Google key restrictions

There are **two trust tiers**, not one reusable key. Within the public tier use separate keys:
Android package plus signing SHA-1, iOS bundle ID, and browser referrers. Restrict each to its
map-rendering SDK/API. The backend key is API-restricted to Routes/Places, never to a mobile
bundle or website referrer. Add an IP restriction only with verified stable server egress;
do not assume serverless outbound IPs are fixed. Provisioning must verify restrictions, quotas
and alerts. Never fall back to an unrestricted key to make a client call work.
[Google key security guidance](https://developers.google.com/maps/api-security-best-practices)

`ADR-008` means **Places as well as Routes stays server-side**. The public maps keys do not
authorize client-side autocomplete or routing. P0-T18 must provision separate platform keys
within its client tier, plus the distinct server tier; no accounts or keys are created here.

## Local, staging and production

1. **Local:** each engineer generates their own files from templates and obtains values through
   approved provider access/password-manager entries. Use the local Supabase instance or an
   explicitly designated development project, Stripe test mode with a local listener secret,
   and individually restricted development Google keys. No production data or credentials.
   P0-T09 owns starting Supabase; P0-T18 owns obtaining provider values. Never reuse a different
   project's values just because variable names match.
2. **Staging:** P6-T09 creates isolated resources. Select the staging Supabase project, Stripe test
   configuration and staging-specific webhook secret, staging Google keys/quotas, and staging
   Sentry/PostHog projects. Supply only public values to the mobile/admin build environments;
   keep backend values in the staging function secret store. Rebuild for staging. The deployment
   ticket must prove staging credentials cannot reach production; this document is not that proof.
3. **Production:** authorized release operators select production-only resources and approved live
   Stripe credentials in the production function secret store. Build clients with production public
   values; use release signing/bundle/referrer restrictions and separate telemetry projects.
   Verify project selection, webhook destination and key mode before deployment. Live mode and
   launch remain P6-T11; this ticket neither provisions nor deploys anything.

Do not send `.env` files in chat, email or PRs. Engineers maintain separate ignored files; a
provider credential may be centrally managed without sharing the file. In particular the existing
Jira bot identity stays the same, but each engineer retrieves its token from the password manager.
Use protected, environment-scoped secret stores and least access for any future deployment
automation. CI quality checks require no secrets. If a secret enters Git or a bundle, revoke/rotate
it; removing a working-tree line does not remove history or an already-distributed credential.

## Enforcement and handoff

```sh
pnpm check:client-env
node --test scripts/environment/*.test.mjs
pnpm lint
pnpm typecheck
git check-ignore apps/mobile/.env.local apps/admin/.env.local supabase/.env.local scripts/jira/.env
```

The `client-env` job in `ci.yml` runs on every PR to `main` and push to `main`, without secrets
or dependency installation. It scans authored files under `apps/`, including hidden env files, templates,
docs, native source and tests, rejecting private names even with a public prefix. Diagnostics
contain only path, line and rule, never source values. Source symlinks fail closed. Dependencies
and generated output directories are excluded (listed explicitly in the script).

This is a **source-reference guard**, not a proof of a key's privileges or a general-purpose
secret scanner. In particular, putting a Google server key value under a permitted public name
cannot be recognized by its shape. Correct provisioning, value review and future integration
bundle checks remain necessary. It does not inspect old Git history or third-party packages.

| Consumer ticket | Contract handoff |
|---|---|
| P0-T04 | Run `check-client-env.mjs` alongside root lint/typecheck/tests; retain the standalone check or consolidate without losing coverage. Add branch protection separately. |
| P0-T09 | Use the backend template and explicit `--env-file`; never require production credentials locally. |
| P0-T18 | Populate provider stores, not committed examples; confirm platform-specific Google restrictions and Stripe endpoint/return/refresh values. |
| P1-T07 | Read Stripe API and approved Connect URLs in the Edge Function only. |
| P4-T05 | Read the backend Google key only in the Edge Function; add delivered-bundle evidence with the actual integration. |
| P6-T03 | Public Sentry DSNs/labels go through accessors; any future upload token stays build/CI-only and is already denied in apps. |
| P6-T04 | Public project-ingestion keys/hosts/labels go through accessors; no personal API key in clients. |
| P6-T09 | Supply the same names with separate staging values; prove environment isolation before release. |

No KB business rule, ticket metadata, or generated index changed. These names are now the
handoff contract; rename them only with coordinated consumer updates.
