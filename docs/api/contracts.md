# QuickTrimr API contracts

P0-T08 / TRIMR-17: executable contract foundation, not implemented endpoints.
Source: KB function inventory, shared Zod schemas and contract-details metadata.
This file is a deterministic projection; edit schemas/examples/metadata together,
then use scripts/api/contracts.mjs to render and --check to detect drift.

## Boundaries and usage

- User calls: verified JWT identity, server-resolved role AND entity ownership; never trust body identity/status/amounts. An inventory entry is not a permission grant.
- Server calls: internal authenticated services/workers only, not public mobile/admin controls. The response/status codes below describe the logical transport contract, not a deployed HTTP endpoint.
- Stripe: authenticate the original raw bytes before SDK decoding or Zod parsing. The unsigned event example is a minimal decoded envelope, not a signature test or complete provider object schema.
- Success is 200. All ordinary failures use strict `{ "error": "stable_code", "fields"?: { "field": "message" } }`; no raw errors, provider payloads, secrets, decline objects or ad hoc status properties. Field errors require safe messages. Read authoritative state separately when needed.
- Schema validity is NOT authorization, idempotency, deadline, eligibility or financial correctness. Owning tickets must test those against actual APIs/database/provider sandboxes. No handlers, migrations, RLS changes, mock routes or payment flows are implemented here.
- Money is integer AUD cents. Snapshots, current eligibility, configured bounds and cumulative refunds are server-owned. The admin partial-refund intent exception does not allow an admin to choose charged/net/commission amounts. Do not use illustrative fixture numbers as operational config.
- Worker clocks, keys and deadlines are server-derived; early/stale/duplicate delivery rechecks persisted state. Payout paid means verified bank payout, not transfer success. An open dispute blocks release. Never hold a database lock across a provider call.
- SAL mapPoint is an area representative point, never the barber position. Public responses reject address/contact, exact origin/distance and routing payload additions.
- Existing Phase 2 acceptance returns accepted_pending_payment. Later capture wiring must coordinate schema/example/docs changes rather than silently reporting paid confirmation.
- mark-on-the-way accepts both coordinates or neither to support denied permission; it does not start location reads before consent. Errors are normalized to the P0-T07 envelope (see affected backlog examples).

## Development fixtures

Opt in through `docs/api/fixtures/index.mjs`, or the typed `@quicktrimr/validation/fixtures` package subpath. Neither entry is imported by production routes. Do not use fixture data as a network-failure fallback or authentication bypass.

```ts
import { API_FIXTURES } from '@quicktrimr/validation/fixtures';
const fixture = API_FIXTURES['search-available-now-barbers'];
// fixture.request / fixture.response are inferred from the shared schemas.
// fixture.errors contains { status, body } for each documented failure.
```

All names, phone values, IDs, URLs, dates and profile descriptions are synthetic examples. Connect links are nonfunctional; the phone fixture must never be called. No credentials, real address, bank details, card data or customer profile data are included. Empty search/list results use `{ "results": [], "nextCursor": null }`; a payout empty tick has no batch and zero totals.

The fixture import smoke tests bundle and execute from each app directory in an isolated browser-like context without process/env/network. They prove importability, not a running product feature or native/provider integration.

## Function contracts

### accept-booking-request

Owner ticket: P2-T12. Caller: **user**. Roles: barber.

Rules: `RULE-REQUEST-05`, `RULE-AVAIL-05`, `RULE-PAY-05`, `RULE-RELY-06`.

Target barber only. First valid acceptance wins under real concurrency. Existing Phase 2 contract reports accepted_pending_payment, NOT paid confirmation; P3-T06 owns capture integration and any coordinated contract change.

Shared request schema: `acceptBookingRequestRequestSchema`.
Shared response schema: `acceptBookingRequestResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "requestId": "22222222-2222-4222-8222-222222222222"
}
```

200 response:

```json
{
  "requestId": "22222222-2222-4222-8222-222222222222",
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "requestStatus": "accepted",
  "bookingStatus": "accepted_pending_payment"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"request_not_pending"}` | Request was already accepted, declined, cancelled or expired. |
| 409 | `{"error":"active_job_exists"}` | Barber already has an active Available Now job. |
| 409 | `{"error":"barber_unavailable"}` | Current onboarding, reliability, cooldown or availability state prevents this action. |

### admin-get-booking-detail

Owner ticket: P5-T04. Caller: **user**. Roles: admin.

Rules: `RULE-ADMIN-01`, `ADR-010`.

Admin verified before data fetch; audited operational detail, minimal safe payment reference, no raw Stripe payload or identity document. This projection deliberately adds no contact/address fields.

Shared request schema: `adminGetBookingDetailRequestSchema`.
Shared response schema: `adminGetBookingDetailResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333"
}
```

200 response:

```json
{
  "booking": {
    "bookingId": "33333333-3333-4333-8333-333333333333",
    "status": "paid_confirmed",
    "bookingType": "available_now",
    "clientId": "11111111-1111-4111-8111-111111111111",
    "barberId": "44444444-4444-4444-8444-444444444444",
    "scheduledFor": null,
    "createdAt": "2026-11-02T00:00:00Z",
    "grossCents": 4500
  },
  "request": {
    "requestId": "11111111-1111-4111-8111-111111111111",
    "servicePriceCents": 4500,
    "commissionPctSnapshot": 20,
    "commissionCents": 900,
    "barberNetCents": 3600
  },
  "statusHistory": [
    {
      "fromStatus": "accepted_pending_payment",
      "toStatus": "paid_confirmed",
      "actorId": "44444444-4444-4444-8444-444444444444",
      "actorRole": "barber",
      "reason": "Capture confirmed by server.",
      "createdAt": "2026-11-02T00:00:00Z"
    }
  ],
  "payment": {
    "paymentId": "11111111-1111-4111-8111-111111111111",
    "status": "captured",
    "capturedCents": 4500,
    "refundedCents": 0,
    "stripePaymentIntentId": "pi_synthetic_example"
  },
  "earning": null,
  "dispute": null,
  "refunds": [],
  "cancellation": null
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |

### admin-issue-refund

Owner ticket: P5-T07. Caller: **user**. Roles: admin.

Rules: `RULE-ADMIN-03`, `RULE-PAY-11`, `RULE-CANCEL-07`.

Mandatory reason and bounded refund INTENT. Server validates remaining capture/cumulative refunds and selects correct allocation from original snapshots. No new client refund endpoint, client-selected charged amount or key.

Shared request schema: `adminIssueRefundRequestSchema`.
Shared response schema: `adminIssueRefundResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "refundCents": 2000,
  "reason": "Agreed service refund."
}
```

200 response:

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "refundId": "re_synthetic_example",
  "refundCents": 2000,
  "capturedCents": 4500,
  "remainingRefundableCents": 2500,
  "auditLogId": "11111111-1111-4111-8111-111111111111"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 409 | `{"error":"refund_not_eligible"}` | Persisted booking/payment state does not permit this refund. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### admin-list-bookings

Owner ticket: P5-T04. Caller: **user**. Roles: admin.

Rules: `RULE-ADMIN-01`, `RULE-ADMIN-04`.

Admin verified BEFORE query. clientId/barberId are filters, not caller identity. Validate/allowlist/configure pagination bounds server-side; example limit is not a production default or maximum. List contains no address/contact fields.

Shared request schema: `adminListBookingsRequestSchema`.
Shared response schema: `adminListBookingsResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "statusFilter": "paid_confirmed",
  "cursor": null,
  "limit": 20
}
```

200 response:

```json
{
  "results": [
    {
      "bookingId": "33333333-3333-4333-8333-333333333333",
      "status": "paid_confirmed",
      "bookingType": "available_now",
      "clientId": "11111111-1111-4111-8111-111111111111",
      "barberId": "44444444-4444-4444-8444-444444444444",
      "scheduledFor": null,
      "createdAt": "2026-11-02T00:00:00Z",
      "grossCents": 4500
    }
  ],
  "nextCursor": null
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |

### admin-resolve-dispute

Owner ticket: P5-T07. Caller: **user**. Roles: admin.

Rules: `RULE-DISPUTE-04`, `RULE-DISPUTE-05`, `RULE-PAY-11`, `RULE-CANCEL-07`.

refundCents is allowed ONLY as bounded admin partial-refund intent, never trusted financial truth. Server validates remaining capture/cumulative refunds/snapshots, calculates allocation, applies state consistently and audits. Full refund reverses earning; failed refund leaves dispute open. Operational outcome still requires the documented eligible resolution; no hidden money defaults.

Shared request schema: `adminResolveDisputeRequestSchema`.
Shared response schema: `adminResolveDisputeResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "disputeId": "11111111-1111-4111-8111-111111111111",
  "outcome": "resolved_partial_refund",
  "refundCents": 2000,
  "reason": "Service partially delivered; agreed by both parties."
}
```

200 response:

```json
{
  "disputeId": "11111111-1111-4111-8111-111111111111",
  "status": "resolved_partial_refund",
  "refundCents": 2000,
  "barberNetCents": 2000,
  "platformRetainedCents": 500,
  "capturedCents": 4500,
  "earningStatus": "available",
  "auditLogId": "11111111-1111-4111-8111-111111111111"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"dispute_already_resolved"}` | Dispute is already resolved; read authoritative state. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### admin-update-barber-status

Owner ticket: P5-T13. Caller: **user**. Roles: admin.

Rules: `RULE-ADMIN-BARBER-STATUS-ALIAS`, `RULE-RELY-05`, `RULE-RELY-06`, `ADR-013`.

Admin only. Same operation under both inventory names (RULE-ADMIN-BARBER-STATUS-ALIAS). Mandatory reason; append-only correction/event/audit. Enforce current review threshold plus explicit reasoned approval for cancellation-policy suspension, and human reinstatement; no manual Connect verification override, booking cancellation or earnings confiscation.

Shared request schema: `adminUpdateBarberStatusRequestSchema`, `adminUpdateReliabilityStateRequestSchema`.
Shared response schema: `adminUpdateBarberStatusResponseSchema`, `adminUpdateReliabilityStateResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "barberId": "44444444-4444-4444-8444-444444444444",
  "toLevel": "good_standing",
  "reason": "Corrected documented emergency.",
  "correctedEventId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "barberId": "44444444-4444-4444-8444-444444444444",
  "level": "good_standing",
  "previousLevel": "limited",
  "eventId": "11111111-1111-4111-8111-111111111111",
  "overriddenByAdmin": true,
  "auditLogId": "11111111-1111-4111-8111-111111111111"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 409 | `{"error":"suspension_not_eligible"}` | Cancellation-policy suspension has not met the configured current review threshold; a review flag alone is not approval. |

### admin-update-reliability-state

Owner ticket: P5-T13. Caller: **user**. Roles: admin.

Rules: `RULE-ADMIN-BARBER-STATUS-ALIAS`, `RULE-RELY-05`, `RULE-RELY-06`, `ADR-013`.

Admin only. Same operation under both inventory names (RULE-ADMIN-BARBER-STATUS-ALIAS). Mandatory reason; append-only correction/event/audit. Enforce current review threshold plus explicit reasoned approval for cancellation-policy suspension, and human reinstatement; no manual Connect verification override, booking cancellation or earnings confiscation.

Shared request schema: `adminUpdateBarberStatusRequestSchema`, `adminUpdateReliabilityStateRequestSchema`.
Shared response schema: `adminUpdateBarberStatusResponseSchema`, `adminUpdateReliabilityStateResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "barberId": "44444444-4444-4444-8444-444444444444",
  "toLevel": "good_standing",
  "reason": "Corrected documented emergency.",
  "correctedEventId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "barberId": "44444444-4444-4444-8444-444444444444",
  "level": "good_standing",
  "previousLevel": "limited",
  "eventId": "11111111-1111-4111-8111-111111111111",
  "overriddenByAdmin": true,
  "auditLogId": "11111111-1111-4111-8111-111111111111"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 409 | `{"error":"suspension_not_eligible"}` | Cancellation-policy suspension has not met the configured current review threshold; a review flag alone is not approval. |

### admin-view-platform-analytics

Owner ticket: P5-T01. Caller: **user**. Roles: admin.

Rules: `RULE-ADMIN-01`, `RULE-ADMIN-04`.

Server-authorized aggregate counts for the validated date interval, indexed queries not browser counts or full-table downloads. No PII in the aggregate response.

Shared request schema: `adminViewPlatformAnalyticsRequestSchema`.
Shared response schema: `adminViewPlatformAnalyticsResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "from": "2026-11-02T00:00:00Z",
  "to": "2026-11-02T01:00:00Z"
}
```

200 response:

```json
{
  "clientCount": 12,
  "barberCount": 4,
  "activeBookingCount": 1,
  "openDisputeCount": 0,
  "paymentCounts": [
    {
      "status": "captured",
      "count": 1
    }
  ],
  "earningCounts": [
    {
      "status": "pending",
      "count": 1
    }
  ],
  "captureFailedCount": 0,
  "acceptedPendingPaymentCount": 0,
  "failedPayoutItemCount": 0
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |

### archive-barber-service

Owner ticket: P1-T11. Caller: **user**. Roles: barber.

Rules: `RULE-SERVICE-04`.

Own service only; idempotent archive, preserve history and booking snapshots.

Shared request schema: `archiveBarberServiceRequestSchema`.
Shared response schema: `archiveBarberServiceResponseSchema`, `archiveServiceCategoryResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "serviceId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "archivedAt": "2026-11-02T00:00:00Z"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |

### archive-service-category

Owner ticket: P1-T10. Caller: **user**. Roles: admin.

Rules: `RULE-SERVICE-03`, `RULE-SERVICE-04`.

Archive, never hard-delete. Repeated archive returns the existing archive timestamp; historical bookings retain snapshots.

Shared request schema: `archiveServiceCategoryRequestSchema`.
Shared response schema: `archiveBarberServiceResponseSchema`, `archiveServiceCategoryResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "id": "55555555-5555-4555-8555-555555555555"
}
```

200 response:

```json
{
  "id": "55555555-5555-4555-8555-555555555555",
  "archivedAt": "2026-11-02T00:00:00Z"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |

### auto-complete-after-barber-complete-timeout

Owner ticket: P4-T11. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `ADR-011`, `RULE-COMPLETE-02`, `RULE-EARN-03`.

Internal authenticated worker/service only, never a mobile/admin mutation endpoint. Recheck authoritative state and server-derived deadlines at execution; early/stale/duplicate work must not overwrite newer state. Applied=false reports a no-op, not a failed effect. Persist history/audit and recover dropped work; fixtures prove none of that enforcement.

Shared request schema: `autoCompleteAfterBarberCompleteTimeoutRequestSchema`.
Shared response schema: `autoCompleteAfterBarberCompleteTimeoutResponseSchema`, `autoCompleteAfterFinalPromptResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333"
}
```

200 response:

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "applied": true,
  "status": "completed",
  "earningStatus": "available"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |

### auto-complete-after-final-prompt

Owner ticket: P4-T11. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `ADR-011`, `RULE-COMPLETE-04`, `RULE-EARN-03`.

Internal authenticated worker/service only, never a mobile/admin mutation endpoint. Recheck authoritative state and server-derived deadlines at execution; early/stale/duplicate work must not overwrite newer state. Applied=false reports a no-op, not a failed effect. Persist history/audit and recover dropped work; fixtures prove none of that enforcement.

Shared request schema: `autoCompleteAfterFinalPromptRequestSchema`.
Shared response schema: `autoCompleteAfterBarberCompleteTimeoutResponseSchema`, `autoCompleteAfterFinalPromptResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333"
}
```

200 response:

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "applied": true,
  "status": "completed",
  "earningStatus": "available"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |

### auto-disable-unresponsive-barber

Owner ticket: P2-T03. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `ADR-011`, `RULE-AVAIL-03`, `RULE-RELY-06`.

Internal authenticated worker/service only, never a mobile/admin mutation endpoint. Recheck authoritative state and server-derived deadlines at execution; early/stale/duplicate work must not overwrite newer state. Applied=false reports a no-op, not a failed effect. Persist history/audit and recover dropped work; fixtures prove none of that enforcement. Consecutive misses disable a session, not a reliability offence.

Shared request schema: `autoDisableUnresponsiveBarberRequestSchema`.
Shared response schema: `autoDisableUnresponsiveBarberResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "sessionId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "applied": true,
  "status": "auto_disabled"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |

### cancel-booking

Owner ticket: P3-T07. Caller: **user**. Roles: client, barber.

Rules: `RULE-CANCEL-01`, `RULE-CANCEL-07`, `RULE-PAY-11`.

Participating client/barber only. Server selects rule and request-time cancellation snapshot. Commission is pre-processing-fee; QuickTrimr bears retained provider fees. Pending/failed refunds cannot release inconvenience earnings or falsely complete a cancelled booking.

Shared request schema: `cancelBookingRequestSchema`.
Shared response schema: `cancelBookingResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "reason": "client_unavailable"
}
```

200 response:

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "status": "cancelled",
  "refundCents": 2250,
  "barberInconvenienceCents": 2250,
  "platformRetainedCents": 0,
  "capturedCents": 4500,
  "ruleApplied": "RULE-CANCEL-03"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"booking_not_cancellable"}` | Server-owned booking is terminal or otherwise ineligible. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### cancel-booking-request

Owner ticket: P3-T07. Caller: **user**. Roles: client.

Rules: `RULE-CANCEL-01`, `RULE-REQUEST-06`.

Request owner only before acceptance. Cancel the uncaptured hold, not a refund of captured money; persisted state decides eligibility.

Shared request schema: `cancelBookingRequestRequestSchema`.
Shared response schema: `cancelBookingRequestResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "requestId": "22222222-2222-4222-8222-222222222222",
  "reason": "plans_changed"
}
```

200 response:

```json
{
  "requestId": "22222222-2222-4222-8222-222222222222",
  "status": "cancelled"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"request_not_pending"}` | Request was already accepted, declined, cancelled or expired. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### cancel-payment-authorisation

Owner ticket: P3-T06. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `RULE-REQUEST-06`, `RULE-PAY-04`.

Internal service only after the owning workflow has authorized the action. Derive amount, operation identity and deterministic idempotency key from persisted snapshots/work; never trust body amounts. No lock across Stripe. Unknown provider outcomes require reconciliation, not a fresh operation. Cancels an uncaptured hold, never refunds a captured charge. An already-cancelled hold returns the same result idempotently.

Shared request schema: `cancelPaymentAuthorisationRequestSchema`.
Shared response schema: `cancelPaymentAuthorisationResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "paymentId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "paymentId": "11111111-1111-4111-8111-111111111111",
  "status": "authorisation_cancelled"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### capture-authorised-payment

Owner ticket: P3-T02. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `RULE-PAY-03`, `RULE-PAY-04`, `RULE-PAY-05`, `RULE-PAY-09`.

Internal service only after the owning workflow has authorized the action. Derive amount, operation identity and deterministic idempotency key from persisted snapshots/work; never trust body amounts. No lock across Stripe. Unknown provider outcomes require reconciliation, not a fresh operation. Capture only after valid acceptance; failure keeps accepted_pending_payment. A successful duplicate returns the same captured record with idempotent=true.

Shared request schema: `captureAuthorisedPaymentRequestSchema`.
Shared response schema: `captureAuthorisedPaymentResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "paymentId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "paymentId": "11111111-1111-4111-8111-111111111111",
  "status": "captured",
  "capturedCents": 4500,
  "bookingStatus": "paid_confirmed"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |
| 402 | `{"error":"capture_failed"}` | Capture failed; no paid confirmation. Read authoritative booking/payment state. |
| 409 | `{"error":"authorisation_expired"}` | The authorization is expired; client must re-authorize. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### complete-barber-profile

Owner ticket: P1-T06. Caller: **user**. Roles: barber.

Rules: `RULE-ONBOARD-03`, `RULE-ONBOARD-05`, `RULE-DISCOVERY-05`.

Own profile only. Private input coordinates resolve server-side to a SAL public area; never echo them in the response. Storage ownership, phone/photo validation and operational radius bounds belong to the owning feature; this contract invents no defaults.

Shared request schema: `completeBarberProfileRequestSchema`.
Shared response schema: `completeBarberProfileResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "displayName": "Marcus Example",
  "bio": "Mobile barber serving the local area.",
  "yearsExperience": 10,
  "serviceAreaLat": -37.8136,
  "serviceAreaLng": 144.9631,
  "serviceRadiusKm": 12
}
```

200 response:

```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "displayName": "Marcus Example",
  "bio": "Mobile barber serving the local area.",
  "yearsExperience": 10,
  "photoUrl": null,
  "serviceRadiusKm": 12,
  "approximateArea": {
    "id": "sal:2021:example",
    "label": "Richmond",
    "mapPoint": {
      "lat": -37.82,
      "lng": 145
    }
  },
  "onboardingComplete": false,
  "publishable": false
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |

### complete-client-profile

Owner ticket: P1-T04. Caller: **user**. Roles: client.

Rules: `RULE-ONBOARD-02`, `RULE-ONBOARD-05`.

Own profile only. Normalize/validate mobile server-side. Onboarding is complete only when required profile information AND an active address exist; the success fixture assumes the address already exists.

Shared request schema: `completeClientProfileRequestSchema`.
Shared response schema: `completeClientProfileResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "displayName": "Sam Example",
  "mobile": "+61400000000"
}
```

200 response:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "displayName": "Sam Example",
  "mobile": "+61400000000",
  "onboardingComplete": true,
  "verificationStatus": "not_started"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |

### confirm-job-complete-by-client

Owner ticket: P4-T09. Caller: **user**. Roles: client.

Rules: `RULE-COMPLETE-02`, `RULE-EARN-02`, `RULE-EARN-03`.

Booking client only, current state/window verified server-side. Open disputes prevent release.

Shared request schema: `confirmJobCompleteByClientRequestSchema`.
Shared response schema: `confirmJobCompleteByClientResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333"
}
```

200 response:

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "status": "completed",
  "earningStatus": "available",
  "completedBy": "client"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"already_completed"}` | Completion already applied. |
| 409 | `{"error":"response_window_closed"}` | Persisted response deadline has passed. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |

### create-barber-earning

Owner ticket: P3-T04. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `RULE-EARN-01`, `RULE-PAY-11`, `RULE-CANCEL-07`.

Internal service only after the owning workflow has authorized the action. Derive amount, operation identity and deterministic idempotency key from persisted snapshots/work; never trust body amounts. No lock across Stripe. Unknown provider outcomes require reconciliation, not a fresh operation. One earning per booking, initially pending after capture. Replay returns the full current record; never create a second entitlement or reapply current pricing.

Shared request schema: `createBarberEarningRequestSchema`.
Shared response schema: `createBarberEarningResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333"
}
```

200 response:

```json
{
  "earningId": "11111111-1111-4111-8111-111111111111",
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "status": "pending",
  "grossCents": 4500,
  "commissionCents": 900,
  "barberNetCents": 3600,
  "commissionPctSnapshot": 20
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |

### create-booking-request

Owner ticket: P2-T08. Caller: **user**. Roles: client.

Rules: `RULE-REQUEST-01`, `RULE-REQUEST-02`, `RULE-REQUEST-03`, `RULE-SCHED-04`, `RULE-RELY-06`.

Own address and an eligible barber/service. Snapshot prices/commission/config server-side; no client id, amount, status, deadline or idempotency key. P3-T06 later wires authorization before leaving a request pending.

Shared request schema: `createBookingRequestRequestSchema`.
Shared response schema: `createBookingRequestResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingType": "available_now",
  "barberId": "44444444-4444-4444-8444-444444444444",
  "serviceCategoryId": "55555555-5555-4555-8555-555555555555",
  "clientAddressId": "66666666-6666-4666-8666-666666666666",
  "notes": "Buzzer 4B"
}
```

200 response:

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "status": "pending",
  "bookingType": "available_now",
  "servicePriceCents": 4500,
  "commissionPct": 20,
  "grossCents": 4500,
  "commissionCents": 900,
  "barberNetCents": 3600,
  "expiresAt": "2026-08-05T04:16:22Z",
  "createdAt": "2026-08-05T04:11:22Z"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"active_request_exists"}` | Client already has an active pending Available Now request. |
| 409 | `{"error":"duplicate_request_intent"}` | Duplicate submission must reuse the original request, not create another. |
| 409 | `{"error":"barber_unavailable"}` | Current onboarding, reliability, cooldown or availability state prevents this action. |

### create-or-sync-profile

Owner ticket: P1-T03. Caller: **user**. Roles: client, barber.

Rules: `RULE-ONBOARD-01`, `ADR-001`.

Verified JWT supplies identity. Role is only a permitted signup-journey choice, never an admin grant or a way to change an existing role; repeated sync returns the existing profile.

Shared request schema: `createOrSyncProfileRequestSchema`.
Shared response schema: `createOrSyncProfileResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "role": "barber"
}
```

200 response:

```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "role": "barber",
  "verificationStatus": "not_started",
  "onboardingComplete": false,
  "createdAt": "2026-11-02T00:00:00Z"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |

### create-payment-authorisation

Owner ticket: P3-T01. Caller: **user**. Roles: client.

Rules: `ADR-006`, `RULE-PAY-01`, `RULE-PAY-02`, `RULE-PAY-04`.

Own request and payment method only. SDK collects card data; server authorizes the request snapshot with manual capture, no surcharge. Authorisation expiry in the example is synthetic, not a guaranteed provider lifetime. SCA/SDK recovery is implemented and evidenced by P3-T01, not these error fixtures.

Shared request schema: `createPaymentAuthorisationRequestSchema`.
Shared response schema: `createPaymentAuthorisationResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingRequestId": "11111111-1111-4111-8111-111111111111",
  "paymentMethodId": "pm_synthetic_example"
}
```

200 response:

```json
{
  "paymentId": "11111111-1111-4111-8111-111111111111",
  "status": "authorised",
  "amountCents": 4500,
  "authorisationExpiresAt": "2026-11-09T00:00:00Z"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 402 | `{"error":"card_declined"}` | Provider declines the authorization. |
| 402 | `{"error":"insufficient_funds"}` | Insufficient funds; distinct safe error, not an arbitrary raw decline payload. |
| 402 | `{"error":"authentication_required"}` | Customer authentication is required through the owning SDK flow; never log a client secret. |
| 409 | `{"error":"already_authorised"}` | Existing authorization must be reused/reconciled. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### create-refund

Owner ticket: P3-T07. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `RULE-CANCEL-07`, `RULE-PAY-11`, `RULE-PAY-04`, `RULE-ADMIN-03`.

Internal service only after the owning workflow has authorized the action. Derive amount, operation identity and deterministic idempotency key from persisted snapshots/work; never trust body amounts. No lock across Stripe. Unknown provider outcomes require reconciliation, not a fresh operation. operationId references an already authorized persisted cancellation/admin refund operation, not a client-selected amount or a mandated new table. Apply the appropriate cancellation or service-refund allocation, never both.

Shared request schema: `createRefundRequestSchema`.
Shared response schema: `createRefundResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "paymentId": "11111111-1111-4111-8111-111111111111",
  "operationId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "paymentId": "11111111-1111-4111-8111-111111111111",
  "refundId": "re_synthetic_example",
  "refundCents": 2000,
  "status": "partially_refunded"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |
| 409 | `{"error":"refund_not_eligible"}` | Persisted operation is not authorized or the remaining captured amount does not permit it. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### create-review

Owner ticket: P4-T14. Caller: **user**. Roles: client.

Rules: `RULE-REVIEW-01`, `RULE-REVIEW-06`.

Booking client only, one review, server-owned eligible outcome and configured review window. Resolution time is server-owned; no review during an open dispute.

Shared request schema: `createReviewRequestSchema`.
Shared response schema: `createReviewResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "rating": 5,
  "text": "On time, great fade."
}
```

200 response:

```json
{
  "reviewId": "88888888-8888-4888-8888-888888888888",
  "rating": 5,
  "barberRating": 4.83,
  "barberRatingCount": 38
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"review_already_exists"}` | A review already exists for this booking. |
| 409 | `{"error":"booking_not_reviewable"}` | Server-owned outcome is not eligible for review. |
| 409 | `{"error":"review_window_closed"}` | Configured review window has closed. |

### create-service-category

Owner ticket: P1-T10. Caller: **user**. Roles: admin.

Rules: `RULE-SERVICE-01`, `RULE-SERVICE-03`.

Audited admin mutation. Slug is stable; max price must exceed min. Values are integer cents, not a new launch catalogue or default pricing decision.

Shared request schema: `createServiceCategoryRequestSchema`.
Shared response schema: `createServiceCategoryResponseSchema`, `updateServiceCategoryResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "slug": "skin_fade",
  "displayName": "Skin Fade",
  "displayOrder": 2,
  "minPriceCents": 3500,
  "maxPriceCents": 17500
}
```

200 response:

```json
{
  "id": "55555555-5555-4555-8555-555555555555",
  "slug": "skin_fade",
  "displayName": "Skin Fade",
  "displayOrder": 2,
  "minPriceCents": 3500,
  "maxPriceCents": 17500,
  "archivedAt": null
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |

### create-stripe-connect-onboarding-link

Owner ticket: P1-T07. Caller: **user**. Roles: barber.

Rules: `RULE-ONBOARD-04`, `RULE-PAY-10`.

Own account only. Return/refresh destinations are server-configured, never arbitrary body URLs. The URL is short-lived; do not log it or expose a Stripe account id.

Shared request schema: `createStripeConnectOnboardingLinkRequestSchema`.
Shared response schema: `createStripeConnectOnboardingLinkResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{}
```

200 response:

```json
{
  "onboardingUrl": "https://connect.stripe.com/setup/s/synthetic-example",
  "expiresAt": "2026-11-02T01:00:00Z",
  "accountStatus": "pending"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"onboarding_complete"}` | Onboarding is already verified; refresh status rather than retrying a new link. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### decline-booking-request

Owner ticket: P2-T13. Caller: **user**. Roles: barber.

Rules: `RULE-REQUEST-05`, `RULE-REQUEST-06`.

Target barber only; reason optional, request must still be pending. P3-T06 later cancels its hold.

Shared request schema: `declineBookingRequestRequestSchema`.
Shared response schema: `declineBookingRequestResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "requestId": "22222222-2222-4222-8222-222222222222",
  "reason": "too_far"
}
```

200 response:

```json
{
  "requestId": "22222222-2222-4222-8222-222222222222",
  "status": "declined"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"request_not_pending"}` | Request was already accepted, declined, cancelled or expired. |

### expire-booking-request

Owner ticket: P2-T15. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `ADR-011`, `RULE-AVAIL-06`, `RULE-SCHED-02`, `RULE-REQUEST-06`.

Internal authenticated worker/service only, never a mobile/admin mutation endpoint. Recheck authoritative state and server-derived deadlines at execution; early/stale/duplicate work must not overwrite newer state. Applied=false reports a no-op, not a failed effect. Persist history/audit and recover dropped work; fixtures prove none of that enforcement. Acceptance that already committed must not be overwritten. P3-T06 wires hold cancellation.

Shared request schema: `expireBookingRequestRequestSchema`.
Shared response schema: `expireBookingRequestResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "applied": true,
  "status": "expired"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |

### mark-arrived

Owner ticket: P4-T03. Caller: **user**. Roles: barber.

Rules: `ADR-010`, `RULE-ETA-01`.

Assigned barber and valid active transition only; history/audit server-side. No client-selected status.

Shared request schema: `markArrivedRequestSchema`.
Shared response schema: `markArrivedResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333"
}
```

200 response:

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "status": "arrived"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |

### mark-job-complete-by-barber

Owner ticket: P4-T07. Caller: **user**. Roles: barber.

Rules: `RULE-COMPLETE-01`, `RULE-COMPLETE-02`, `RULE-EARN-03`.

Assigned barber only. Start the configured server-derived client response window; earning stays pending, not released by this action.

Shared request schema: `markJobCompleteByBarberRequestSchema`.
Shared response schema: `markJobCompleteByBarberResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333"
}
```

200 response:

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "status": "completed_by_barber",
  "clientRespondBy": "2026-08-05T05:11:22Z",
  "earningStatus": "pending"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |

### mark-on-the-way

Owner ticket: P4-T03. Caller: **user**. Roles: barber.

Rules: `RULE-ETA-01`, `RULE-ETA-05`, `ADR-010`.

Assigned barber only. Both coordinates or neither: permission denied still allows transition with ETA unavailable. No location reads before consent; response exposes ETA only, not the origin.

Shared request schema: `markOnTheWayRequestSchema`.
Shared response schema: `markOnTheWayResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "lat": -37.8136,
  "lng": 144.9631
}
```

200 response:

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "status": "on_the_way",
  "etaMinutes": 14,
  "etaUpdatedAt": "2026-08-05T04:11:22Z"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |
| 409 | `{"error":"already_on_the_way"}` | Already transitioned; do not start another routing loop. |

### mark-payout-batch-paid

Owner ticket: P3-T11. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `RULE-EARN-06`, `RULE-EARN-07`, `RULE-PAY-06`.

Internal service only after the owning workflow has authorized the action. Derive amount, operation identity and deterministic idempotency key from persisted snapshots/work; never trust body amounts. No lock across Stripe. Unknown provider outcomes require reconciliation, not a fresh operation. Reconciliation only: require verified provider confirmation that ALL mapped bank payout items are paid, not just transfers created. Later bank failures append a correction; never erase history.

Shared request schema: `markPayoutBatchPaidRequestSchema`.
Shared response schema: `markPayoutBatchPaidResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "batchId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "batchId": "11111111-1111-4111-8111-111111111111",
  "status": "paid",
  "paidItemCount": 1
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |
| 409 | `{"error":"payout_not_settled"}` | At least one mapped bank payout has not been confirmed paid. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### open-dispute

Owner ticket: P4-T12. Caller: **user**. Roles: client, admin.

Rules: `RULE-DISPUTE-01`, `RULE-DISPUTE-02`, `RULE-EARN-03`.

Booking client within eligible server window, or an authorized admin operational case. One open dispute; earning held. Reason category is nonempty text because no category enum is decided here.

Shared request schema: `openDisputeRequestSchema`.
Shared response schema: `openDisputeResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "reasonCategory": "service_not_provided",
  "description": "Barber did not arrive."
}
```

200 response:

```json
{
  "disputeId": "77777777-7777-4777-8777-777777777777",
  "status": "open",
  "bookingStatus": "disputed",
  "earningStatus": "pending"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"dispute_already_open"}` | An open dispute already exists for this booking. |
| 409 | `{"error":"dispute_window_closed"}` | Client’s configured dispute window has closed. |

### process-payout-batch

Owner ticket: P3-T11. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `RULE-EARN-05`, `RULE-EARN-06`, `RULE-EARN-07`, `RULE-PAY-09`.

Internal service only after the owning workflow has authorized the action. Derive amount, operation identity and deterministic idempotency key from persisted snapshots/work; never trust body amounts. No lock across Stripe. Unknown provider outcomes require reconciliation, not a fresh operation. Process per-barber items independently. Transfer success is NOT bank-payout paid; mixed failures remain visible, bank/account-action failures are held, ambiguous outcomes reconcile before retry.

Shared request schema: `processPayoutBatchRequestSchema`.
Shared response schema: `processPayoutBatchResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "batchId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "batchId": "11111111-1111-4111-8111-111111111111",
  "status": "processing",
  "paidItemCount": 0,
  "failedItemCount": 0,
  "queuedItemCount": 1
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### queue-payout-batch

Owner ticket: P3-T10. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `RULE-EARN-07`, `ADR-011`.

Internal service only after the owning workflow has authorized the action. Derive amount, operation identity and deterministic idempotency key from persisted snapshots/work; never trust body amounts. No lock across Stripe. Unknown provider outcomes require reconciliation, not a fresh operation. Server chooses the original scheduled Australia/Sydney cut-off and persisted config, including DST. Only eligible available earnings strictly before it. Empty tick returns batchId=null/zero totals without a provider call; this is not a payout schedule input.

Shared request schema: `queuePayoutBatchRequestSchema`.
Shared response schema: `queuePayoutBatchResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{}
```

200 response:

```json
{
  "batchId": "11111111-1111-4111-8111-111111111111",
  "status": "queued",
  "scheduledCutoff": "2026-11-02T00:00:00Z",
  "itemCount": 1,
  "totalCents": 3600
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |
| 409 | `{"error":"payout_not_due"}` | No eligible scheduled payout run is currently due. |

### refresh-stripe-connect-status

Owner ticket: P1-T09. Caller: **user**. Roles: barber.

Rules: `RULE-ONBOARD-04`, `RULE-PAY-07`.

Own account only. Map verified provider state to shared verification status; never accept a client-selected status or identity documents.

Shared request schema: `refreshStripeConnectStatusRequestSchema`.
Shared response schema: `refreshStripeConnectStatusResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{}
```

200 response:

```json
{
  "accountStatus": "pending",
  "chargesEnabled": false,
  "payoutsEnabled": false,
  "detailsSubmitted": false
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 502 | `{"error":"stripe_unavailable"}` | Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying. |

### release-barber-earning

Owner ticket: P3-T04. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `RULE-EARN-02`, `RULE-EARN-03`.

Internal authenticated worker/service only, never a mobile/admin mutation endpoint. Recheck authoritative state and server-derived deadlines at execution; early/stale/duplicate work must not overwrite newer state. Applied=false reports a no-op, not a failed effect. Persist history/audit and recover dropped work; fixtures prove none of that enforcement. Require eligible completion, successful cancellation/refund exception, or eligible admin resolution. Never release during an open dispute; cancelled is not completed.

Shared request schema: `releaseBarberEarningRequestSchema`.
Shared response schema: `releaseBarberEarningResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "earningId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "earningId": "11111111-1111-4111-8111-111111111111",
  "applied": true,
  "status": "available",
  "barberNetCents": 3600
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |
| 409 | `{"error":"dispute_open"}` | An open dispute prevents earning release. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |

### search-available-now-barbers

Owner ticket: P2-T04. Caller: **user**. Roles: client.

Rules: `RULE-DISCOVERY-01`, `RULE-DISCOVERY-05`, `RULE-RELY-06`, `RULE-SCHED-04`.

Supports Available Now and Scheduled branches. Input is the client’s service-address search point, not barber location. PostGIS filtering, configured radius/pagination bounds and SAL projection are server-side. Results expose only SAL mapPoint and distanceBand, never precise barber location, contact, address or Stripe identifiers. Empty result is 200, not an error.

Shared request schema: `searchAvailableNowBarbersRequestSchema`.
Shared response schema: `searchAvailableNowBarbersResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingType": "available_now",
  "serviceCategoryId": "55555555-5555-4555-8555-555555555555",
  "lat": -37.8226,
  "lng": 144.998,
  "radiusKm": 10,
  "cursor": null,
  "limit": 20
}
```

200 response:

```json
{
  "results": [
    {
      "barberId": "44444444-4444-4444-8444-444444444444",
      "displayName": "Marcus Example",
      "photoUrl": null,
      "priceCents": 4500,
      "approximateArea": {
        "id": "sal:2021:example",
        "label": "Richmond",
        "mapPoint": {
          "lat": -37.82,
          "lng": 145
        }
      },
      "distanceBand": "2-5km",
      "rating": 4.8,
      "ratingCount": 37,
      "availableUntil": "2026-11-02T01:00:00Z"
    }
  ],
  "nextCursor": null
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |

### send-final-completion-prompt

Owner ticket: P4-T11. Caller: **server**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `ADR-011`, `RULE-COMPLETE-04`.

Internal authenticated worker/service only, never a mobile/admin mutation endpoint. Recheck authoritative state and server-derived deadlines at execution; early/stale/duplicate work must not overwrite newer state. Applied=false reports a no-op, not a failed effect. Persist history/audit and recover dropped work; fixtures prove none of that enforcement. Preserve a full configured response window even when the warning worker is late; durable notification send failure must not roll back the state.

Shared request schema: `sendFinalCompletionPromptRequestSchema`.
Shared response schema: `sendFinalCompletionPromptResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333"
}
```

200 response:

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "applied": true,
  "status": "completion_prompt_sent",
  "clientRespondBy": "2026-11-02T01:00:00Z"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 500 | `{"error":"internal_error"}` | Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects. |

### start-available-now-session

Owner ticket: P2-T01. Caller: **user**. Roles: barber.

Rules: `RULE-AVAIL-01`, `RULE-AVAIL-02`, `RULE-AVAIL-05`, `RULE-RELY-06`.

Own session only. Recheck onboarding, current reliability and one-active-job/session invariants server-side under concurrency.

Shared request schema: `startAvailableNowSessionRequestSchema`.
Shared response schema: `startAvailableNowSessionResponseSchema`, `updateAvailableNowSessionResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "lat": -37.8136,
  "lng": 144.9631,
  "locationSource": "gps",
  "radiusKm": 8,
  "availableUntil": "2026-08-05T09:00:00Z"
}
```

200 response:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "status": "active",
  "radiusKm": 8,
  "availableUntil": "2026-08-05T09:00:00Z",
  "locationSource": "gps",
  "approximateArea": {
    "id": "sal:2021:example",
    "label": "Melbourne"
  }
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 409 | `{"error":"session_already_active"}` | Barber already has an active session. |
| 403 | `{"error":"onboarding_incomplete"}` | Barber is not yet eligible to publish availability. |
| 409 | `{"error":"barber_unavailable"}` | Current onboarding, reliability, cooldown or availability state prevents this action. |

### stop-available-now-session

Owner ticket: P2-T01. Caller: **user**. Roles: barber.

Rules: `RULE-AVAIL-03`.

Own session only. Does not cancel an accepted booking; response is the manually-disabled session projection.

Shared request schema: `stopAvailableNowSessionRequestSchema`.
Shared response schema: `stopAvailableNowSessionResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "sessionId": "11111111-1111-4111-8111-111111111111"
}
```

200 response:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "status": "manually_disabled"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |

### stripe-webhook

Owner ticket: P1-T09 / P3-T03. Caller: **stripe**. Roles: no user role; authenticated internal service or verified provider only.

Rules: `RULE-PAY-07`, `RULE-PAY-06`, `RULE-PAY-10`.

Provider ingress, not a user JWT endpoint. Verify Stripe-Signature against the ORIGINAL RAW BODY before SDK decoding/Zod parsing or any write. requestSchema describes only a minimal decoded event envelope AFTER verification; object remains opaque and must be decoded using the pinned SDK before projection. Fixtures are unsigned and cannot authenticate anything. Extra provider envelope keys are stripped; never log, return or retain a full payload. Duplicate and irrelevant events acknowledge 200; persistence/reconciliation belong to owning tickets.

Shared request schema: `stripeWebhookRequestSchema`.
Shared response schema: `stripeWebhookResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "id": "evt_synthetic_example",
  "type": "account.updated",
  "data": {
    "object": {
      "id": "acct_synthetic_example",
      "object": "account"
    }
  }
}
```

200 response:

```json
{
  "received": true
}
```

| Status | Error response | When |
| --- | --- | --- |
| 400 | `{"error":"invalid_signature"}` | Missing or invalid provider signature; no event parsing or data write. |
| 400 | `{"error":"invalid_event"}` | Verified event cannot be decoded safely. |
| 500 | `{"error":"processing_failed"}` | Verified event processing failed; no false acknowledgement of a required durable effect. |

### update-available-now-session

Owner ticket: P2-T01. Caller: **user**. Roles: barber.

Rules: `RULE-AVAIL-02`, `RULE-AVAIL-05`.

Own active session only; validate future available-until and current eligibility server-side, never infer eligibility from body state.

Shared request schema: `updateAvailableNowSessionRequestSchema`.
Shared response schema: `startAvailableNowSessionResponseSchema`, `updateAvailableNowSessionResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "lat": -37.8136,
  "lng": 144.9631,
  "locationSource": "manual",
  "radiusKm": 10,
  "availableUntil": "2026-08-05T09:00:00Z"
}
```

200 response:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "status": "active",
  "radiusKm": 10,
  "availableUntil": "2026-08-05T09:00:00Z",
  "locationSource": "manual",
  "approximateArea": {
    "id": "sal:2021:example",
    "label": "Melbourne"
  }
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |
| 409 | `{"error":"barber_unavailable"}` | Current onboarding, reliability, cooldown or availability state prevents this action. |

### update-eta

Owner ticket: P4-T05. Caller: **user**. Roles: barber.

Rules: `RULE-ETA-02`, `RULE-ETA-03`, `RULE-ETA-04`, `RULE-ETA-05`.

Assigned barber on an active booking only. Server may invoke the same service from due-work scans. Coordinate pair is input-only; response has paired ETA/timestamp or both null. Refresh is throttled by server config, Google calls/keys server-side, stop when inactive.

Shared request schema: `updateEtaRequestSchema`.
Shared response schema: `updateEtaResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "lat": -37.8136,
  "lng": 144.9631
}
```

200 response:

```json
{
  "bookingId": "33333333-3333-4333-8333-333333333333",
  "cached": false,
  "etaMinutes": 12,
  "etaUpdatedAt": "2026-08-05T04:11:22Z"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 409 | `{"error":"invalid_status_transition"}` | Current server-owned state does not permit the requested action. |

### update-review-admin-visibility

Owner ticket: P5-T12. Caller: **user**. Roles: admin.

Rules: `RULE-REVIEW-04`, `RULE-REVIEW-05`, `ADR-013`.

Reasoned audited hide/unhide; recompute public aggregate server-side. No automatic moderation policy.

Shared request schema: `updateReviewAdminVisibilityRequestSchema`.
Shared response schema: `updateReviewAdminVisibilityResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "reviewId": "11111111-1111-4111-8111-111111111111",
  "visible": false,
  "reason": "Review contains personal contact information."
}
```

200 response:

```json
{
  "reviewId": "11111111-1111-4111-8111-111111111111",
  "visible": false,
  "auditLogId": "11111111-1111-4111-8111-111111111111"
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |

### update-service-category

Owner ticket: P1-T10. Caller: **user**. Roles: admin.

Rules: `RULE-SERVICE-03`, `RULE-SERVICE-04`.

Update a category without changing booking snapshots. Slug is not an update input; the server must reject attempted slug mutation.

Shared request schema: `updateServiceCategoryRequestSchema`.
Shared response schema: `createServiceCategoryResponseSchema`, `updateServiceCategoryResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "id": "55555555-5555-4555-8555-555555555555",
  "displayName": "Skin Fade",
  "displayOrder": 2,
  "minPriceCents": 3500,
  "maxPriceCents": 17500
}
```

200 response:

```json
{
  "id": "55555555-5555-4555-8555-555555555555",
  "slug": "skin_fade",
  "displayName": "Skin Fade",
  "displayOrder": 2,
  "minPriceCents": 3500,
  "maxPriceCents": 17500,
  "archivedAt": null
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"not_found"}` | Requested entity is missing or not accessible; never expose another user’s record. |
| 409 | `{"error":"slug_immutable"}` | An attempt was made to change the category’s stable slug. |

### upsert-barber-service

Owner ticket: P1-T11. Caller: **user**. Roles: barber.

Rules: `RULE-SERVICE-02`, `RULE-SERVICE-03`, `RULE-SERVICE-04`.

Own service only. Server checks price against the category’s current configured bounds; old booking snapshots do not change.

Shared request schema: `upsertBarberServiceRequestSchema`.
Shared response schema: `upsertBarberServiceResponseSchema`.
Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.

Request (decoded envelope only for Stripe):

```json
{
  "serviceCategoryId": "55555555-5555-4555-8555-555555555555",
  "priceCents": 4500,
  "enabled": true
}
```

200 response:

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "serviceCategoryId": "55555555-5555-4555-8555-555555555555",
  "priceCents": 4500,
  "enabled": true,
  "archivedAt": null
}
```

| Status | Error response | When |
| --- | --- | --- |
| 401 | `{"error":"unauthenticated"}` | Missing or invalid verified user JWT. |
| 403 | `{"error":"forbidden"}` | Caller lacks the required role, ownership or internal-service permission. |
| 422 | `{"error":"validation_failed","fields":{"_request":"Invalid request or server-side business validation"}}` | Malformed input or server-side business validation failed; fields identifies invalid inputs. |
| 500 | `{"error":"internal_error"}` | Unexpected failure; safe error only, no internals or provider payload. |
| 404 | `{"error":"category_unavailable"}` | Category missing or archived. |
