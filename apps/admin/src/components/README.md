# Admin components

Admin-specific compositions live here. Cross-surface primitives belong in `@quicktrimr/ui`.

## P0-T17 contracts

Import `AdminShell`, `DataTable`, `StatusBadge`, `PageHeader`, `DetailPanel`, `ConfirmDialog`,
`LoadingState`, `EmptyState`, `ErrorState`, `Money` and `TableQuery` from `@/components/admin`.
`ui/button.tsx` remains the shared web button. All except the interactive table/dialog can render
as Server Components. No component establishes identity, permission or a business rule.

`AdminShell` takes `adminUserId` and children. Its production layout awaits `requireAdmin()` first.
The sidebar links are future destinations, not implemented Phase 5 screens; native anchors avoid
private-route prefetch. Each future page, loader, handler and action must independently guard
**before** any data access, because a layout is not the only execution entry point.

### DataTable

Supply typed column definitions, `rows` containing **one** authorised server page, its filtered
`rowCount`, stable `getRowId`, `caption`, controlled `query` and `onQueryChange`:

```ts
const query: TableQuery = {
  pagination: { pageIndex: 0, pageSize: 5 },
  sorting: [{ id: 'status', desc: false }],
  columnFilters: [],
};
```

The sample page size is illustrative, not a product setting. The component never fetches, sorts,
filters or slices rows. TanStack's manual flags emit query intent; sorting/column filtering reset
page zero. Use `filters` for caller-controlled filter controls; those controls also reset page zero.
Set `enableSorting: false` for columns with interactive header controls. Provide `phase` as
`ready`, `loading` or `error`: loading/error hide stale rows and disable pagination. Empty pages
offer a reset, or `emptyAction`; errors accept `retryAction`. No table total is a financial total.

The future server owner must validate and allowlist fields/directions/filter values, bound page
sizes, use indexed filtering/sorting with a stable tie-breaker, compute a filtered count server-side,
and prove raw-body non-admin denial. Query cancellation/refresh and stale-response handling belong
to that owning screen. Associate results with their query so a new query cannot render old rows
before its loading effect starts; the isolated harness demonstrates this contract. Never fetch
a full database result to make this component work.

TanStack v8 exposes non-memoizable closures. `DataTable` alone opts out of React Compiler with
`use no memo`; one documented compatibility diagnostic is suppressed at `useReactTable`, not
globally. Revisit this exception on a compatible Table upgrade. See [React's directive guidance](https://react.dev/reference/react-compiler/directives/use-no-memo)
and [TanStack manual pagination](https://tanstack.com/table/v8/docs/guide/pagination).

### Confirmation and display

`ConfirmDialog` takes `open`, `title`, `consequence`, `financialImpact`, `requireReason` (default
true), optional `confirmLabel`, `onCancel` and async `onConfirm({ reason })`. It trims reasons,
rejects required whitespace, blocks repeated/pending confirmation and cancel/Escape, shows a safe
retry on rejection, and restores opener focus when closed. The caller closes it after successful
confirmation; reopening resets input. Native `<dialog>` provides modal inertness/initial focus,
with explicit Tab/Shift+Tab wrapping at enabled visible-control boundaries.
Only reason is emitted, never an amount/status/permission. A financial summary must come from the
authorised server snapshot; it is not authorisation to move money. Future actions must revalidate
reason and role, derive amounts/idempotency server-side, and append safe audit/history records.

`Money` accepts `IntegerCents` and delegates to the single `formatAudCents` formatter. `StatusBadge`
takes `kind` (`booking`, `payment`, `earning`, `payout`, `dispute`) and status; all shared enum values
have explicit metadata and unknown/prototype values render neutral `Unknown status`. Neither
presentation computes refunds or decides transitions. `PageHeader` accepts title/description/actions;
`DetailPanel` accepts title/children; states accept safe text and caller actions. Do not pass raw
provider diagnostics to UI states. Supply a meaningful empty-state next action in real screens.

## Integration boundary

P1-T02 supplies real server-resolved sessions and signed-in-app evidence. P5-T01/T02/T03/T04/T06/
T09/T11/T12 supply authenticated operational data and business integrations. Their independent
guards, audit writes, field privacy, query plans and mutations are **not** implemented here.
The loopback harness in `scripts/qa/` and `apps/admin/fixtures/` demonstrates component protocols
against synthetic seed projections, with no Next route, database or runtime auth bypass.
