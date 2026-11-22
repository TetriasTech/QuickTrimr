# P2-T07 / TRIMR-50 audit

Scope: the branch against `09c77af`, including the map policy migration and config
projection, strict shared contract, pure area grouping, mobile integration,
gesture scheduler, native configuration and local API fixtures. Checked
`QUICKTRIMR_AUDIT_PROMPT.md` A–F. Generated backlog sections were excluded.

## Initial finding

**Minor — E/F, contradictory failure feedback.** In
`apps/mobile/src/features/discovery/discovery-map-screen.tsx`, a rejected public-area
projection could remove the native map while leaving “Loading map…” visible; an
empty result plus a local refresh error could also show the empty-state guidance.
Suppress loading/empty feedback when the corresponding failure is active and test
the unsafe-area branch with no native map, no empty claim and no loading indicator.

Verdict: one finding, zero Critical, zero Major, one Minor. Android native provider
evidence remains a separate completion gate until recorded in the ticket QA report.

## Final disposition

A follow-up review found one additional **Minor — D, duplicate plugin entry**:
SecureStore was already registered in `app.json`; the dynamic config redundantly
registered it again. Expo's run-once plugin guard made the second entry harmless,
but removing it leaves one clear source. The static plugin and app-scoped keychain
entitlement remain in place. Resolved config is checked before publication.

Native QA exposed one further **Minor — F, fixture-process lifecycle**: the local
`--hold` proof archived its fixtures correctly but retained its terminal input
handle afterward. Pausing/unreferencing that input after the cleanup signal makes
the process exit normally. A real local run wrote `cleanup` while deliberately
keeping the parent input pipe open: API proof and cleanup passed, then exit 0
occurred without closing the pipe. No production behavior changed.

The Minor finding is fixed: unsafe projections suppress the orphaned map loader;
local refresh failures suppress the empty claim. Interaction regressions pass.
Re-audited the final correction and quiet-refresh change against A–F: no new code
findings. Config remains server-backed, identity/address denial is API-tested,
public projection remains exact, no per-barber request or new external money call
exists, cursor fetches are explicit in map/area mode, and shared cards/schema/theme
are reused. The scheduler is UI-only and cannot enforce a booking deadline.

Final A–F review includes the fixture lifecycle correction and the actual Android
provider screenshots. No further findings: Google tiles, denied-GPS fallback,
public area marker, gestures and card selection all passed natively. Exact request
cadence remains covered by deterministic interaction tests, not inferred from a
screenshot.

VERDICT: three Minor findings fixed; zero unresolved findings. Android provider
verification is recorded in the ticket QA report and PR.
