# P1-T12 audit

Scope: the TRIMR-42 vertical slice, its existing owner-photo integration and shared display formatter; reviewed against QUICKTRIMR_AUDIT_PROMPT.md §3.A–F.

## Ranked findings and disposition

1. **Major — F. Native money rendering crashes.** `packages/ui/src/presentation/money.ts` passed a BigInt to `Intl.NumberFormat.format`. Actual iPhone Hermes raised “Cannot convert BigInt to number” when the profile rendered its first service. Fixed in the shared formatter with exact integer arithmetic and string grouping. Eleven formatter cases cover cents, grouping, signs, safe-integer extremes and invalid input; the same native profile subsequently displayed A$45.50 and A$46.25.
2. **Minor — E/F. Profile deep links lacked a Back destination.** A direct profile deep link initially had no predecessor in the client stack. Added the client `index` anchor and the native minimal Back presentation. The native unavailable-state Back action returned to the client journey. No search flow was added.
3. **Minor — E/F. Later-page unavailability could leave the cached profile visible.** The screen initially read availability only from the first service page. A later page can observe lost Connect eligibility and return `profile: null`. Any null page now hides the cached profile. The regression `eligibility lost between service pages removes the previously loaded profile` passes.

All three are resolved. Also checked canonical UUID handling, physical cursor bounds, fresh bearer/cancellation/session guards, cached refresh-error copy, schema reuse, null photos and no fake ratings.

## Final review

- Public response assembled from an explicit SQL allowlist and checked with strict nested schemas. Private-field injection fails closed. Public tables/views retain prior read/write boundaries; the new RPC is service-only and independently checks the stored client role.
- Single target lookup and bounded service pages; no N+1 per service, unbounded mobile fetch, geospatial filtering on the client, Google request or Stripe call. SAL representative points come from the existing public-area projection.
- Existing owner and new public photos reuse the configured signer. No standalone storage path, photo identifier, private radius, contact data, provider identifier or verification internals enter the public DTO.
- Integer-cent prices are current catalogue data; no booking, payment, audit-history or status mutation is introduced by the read. No lock spans network I/O.
- Shared components, validation and query-key factories reused; fixtures remain test-only; no new production mock flag or fallback. Long service data is virtualised and paged. Loading/error/empty states have evidence.
- Backlog contract and decided location precision aligned; no new business value or unresolved TBC. Generated indexes left untouched.

The older address-search timeout is recorded in the ticket report as a separate pre-existing path, not hidden as a passing regression or included as a new-slice finding.

VERDICT: 3 findings — 0 Critical, 1 Major fixed, 2 Minor fixed. No open findings in the delivered slice.
