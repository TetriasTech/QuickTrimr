# Mobile state ownership

QuickTrimr follows `ADR-003`: TanStack Query owns server state, Zustand owns temporary local
app state, and React Hook Form owns form state with shared Zod schemas at every boundary.

## The hard boundary

Server truth is never mirrored into Zustand. Booking, request, payment, payout, verification,
availability, and platform-configuration records belong in TanStack Query. A Zustand store must
not copy those records or their statuses for convenient rendering. Screens render the current
query result and invalidate or refetch it after mutations.

Zustand is for local state that has no authoritative server record. The example booking-draft
store contains only the user's selected barber, service category, address, and booking mode so
those selections survive navigation. Prices, statuses, server configuration, and derived money
do not belong in that store.

## TanStack Query defaults

The root mobile layout mounts one Query client. Its defaults are intentional:

- `staleTime: 0` makes cached server data immediately eligible for a freshness check. This is
  appropriate for booking state, which may have changed while the user was elsewhere.
- `refetchOnWindowFocus: true` is connected to React Native `AppState`, so returning to an active
  app refreshes observed stale queries.
- `refetchOnReconnect: true` retries stale reads after connectivity returns.
- Queries retry once only for transport failures, `429`, and `5xx` responses. Client errors are
  not retried. Mutations never retry automatically, avoiding accidental duplicate operations.

Features may set a longer stale time or explicit polling when their ticket requires it, but they
must document why. Business expiry and lifecycle transitions are never implemented with client
timers.

## Keys, mutations, and forms

`apps/mobile/src/lib/query/query-keys.ts` is the only module that constructs query keys. Features
consume its named factories for reads, invalidation, and cache updates.

`invokeEdgeFunction` is the contract-backed mutation boundary. It validates the outgoing body,
calls an injected Edge Function transport, parses successful responses with the matching shared
schema, and throws `EdgeFunctionError` with the shared error envelope for non-success responses.
The transport remains injectable until the authentication and API-client tickets provide the
verified session integration.

React Hook Form owns in-progress fields and uses `zodResolver` with schemas exported by
`packages/validation`. A validated submission may update an allowed local draft or call the
mutation boundary; it must not make Zustand a second server cache.
