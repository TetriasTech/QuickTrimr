# Premium mobile identity — verification

Andrew commissioned this visual pass separately from ticket delivery on
2026-11-21 and delegated creative direction. `RULE-BRAND-01` records the authority
upstream. No Jira ticket is claimed or transitioned by this change.

The identity is provisional: forest, ivory and citrus, an original editable Q,
Manrope utility type and Instrument Serif editorial type. The
[brand guide](../../brand/README.md) contains the assets, licences, provenance and
replacement steps. Palette/mark source, semantic themes, shared primitives and
native metadata hold the visual decisions; feature rules do not hold brand values.

## Running-flow evidence

Verified on iPhone 17, iOS 26.5, Expo Go SDK 57 against the existing local
QuickTrimr API at `127.0.0.1:55321`. Fonts and artwork load from bundled assets.

| Flow | Observed evidence |
| --- | --- |
| Welcome and real account entry | [Welcome](01-welcome-iphone.png), [sign in](02-sign-in-iphone.png). Both entry actions also have an interaction test. Signed into the existing disposable local client through the real auth flow. |
| Search form | Native service selector inherits forest/citrus. Mode buttons expose selection; existing saved-address selection is reused. Radius commits through the new iOS Done accessory, retaining validation. |
| Empty results and recovery | [Empty state](03-empty-results-iphone.png). Widen radius, change service and Scheduled remain functional. Discovery tests cover config/catalogue failures, retry, offline handling and retained drafts. |
| Appearance and larger text | [Dark palette](04-dark-results-iphone.png), [larger text](05-large-text-iphone.png). Increased preferred text size twice; content wraps and remains scrollable. Replaced the header text action with an accessible location icon after observing clipping. Restored the original text size and light appearance. |
| Populated discovery | [Results](06-results-iphone.png). Real API responses for two explicitly synthetic local barbers, current integer-cent prices, approximate locality/distance, no fabricated rating and honest Scheduled copy. |
| Selected public profile | [Profile](07-profile-iphone.png). Real API response, bio/experience, no-review state, selected service and current A$45.50 price. Existing tests also cover loading, errors/retry, revoked eligibility, stale prices and service pagination beyond page one. |
| Demo handoff | Signed out and observed the finished welcome screen. Expo's floating tools overlay is hidden. Local fixture accounts were soft-deleted after verification. |

The empty/dark captures precede the final header icon fix; the final header is
shown in captures 05–07. No screenshot contains customer credentials or a real home
address. The barber names and locality in populated captures are labelled Demo.

The approved temporary fixtures were local only. Their Stripe eligibility fields
were explicit synthetic facts, not evidence of Stripe verification. No Stripe,
Google Cloud or hosted backend setting was changed. The original Available Now
sessions expired during the pause; a refreshed search reflected that expiry.
Populated final captures use a future requested date in Scheduled mode. No booking
or payment was created.

[Cleanup evidence](cleanup.json): category archived through its audited RPC;
services archived; nine helper-created fixture Auth accounts soft-deleted; zero
active fixture sessions; temporary credential file removed. Andrew separately
approved removing the one synthetic locality polygon and one grey test image;
both were removed. Immutable history and audit attribution remain intact.

## Automated checks

All final commands exited 0. [Machine-readable results](quality.json).

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` — includes shared UI: 30 tests; mobile: 29 Node tests and 62 Jest
  tests; root tooling: 218 tests, plus the other workspace suites.
- `pnpm format:check`
- `pnpm check:client-env`
- `node scripts/jira/generate-indexes.mjs --check`
- `pnpm --filter @quicktrimr/mobile build` — Android and iOS export, with only
  the existing local URL and public anonymous credential supplied in memory.

New behavior checks cover normal-text contrast in both palettes, input boundary
contrast, reactive shared controls/wordmark, selected/disabled accessibility state,
and welcome actions. Existing discovery/profile/catalogue tests continue testing
authoritative data and failure behavior with the updated presentation.

The build check is a bundle export. Android emulator interaction and a standalone
native icon/splash launch were not exercised in this pass. Expo Go displays its
own native launch shell; the configured icon/splash takes effect in a new binary.

## Repository audit

Scope: the complete branding diff from `main`, new source/assets and surrounding
mobile auth, discovery, profile and UI code. Audited against
`QUICKTRIMR_AUDIT_PROMPT.md` A–F.

- A: No schema, RLS, identity, money, permission, booking transition or timer
  enforcement changes. Existing server-derived eligibility, cents and privacy
  projections remain authoritative. Copy retains requested-time confirmation,
  approximate areas and genuine review state.
- B: No new provider requests, polling or DB calls. Fonts use per-weight imports;
  assets are bundled. Existing virtualized lists, memoized result cards and cursor
  behavior remain intact.
- C: Renamed the former barber placeholder to reflect its functional home screen.
  No mock service or provider data enters the production app path.
- D: Existing shared primitives, money formatting, schemas and query contracts
  are reused. Theme and mark geometry have one source.
- E: The delegated visual decision is recorded upstream; no business decision or
  ticket scope was invented. Existing loading/error/empty/retry states remain.
- F: Types, hooks, appearance switching, input behavior, native selectors,
  accessibility states and contrast were checked. Native review caught and fixed
  muted contrast, header clipping, numeric dismissal and an emoji-rendered arrow.

**VERDICT — 0 unresolved findings.** The scope is presentation; provider/live-mode
readiness and future booking features are not asserted by this report.
