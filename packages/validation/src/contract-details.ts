import { USER_ROLE_VALUE } from '@quicktrimr/shared';

import type { ContractName } from './contracts/index.ts';
import type { UserRole } from '@quicktrimr/shared';

export type ContractErrorCase = {
  readonly status: number;
  readonly code: string;
  readonly condition: string;
};
const error = (
  status: number,
  code: string,
  condition: string,
): ContractErrorCase => ({ status, code, condition });
const validation = error(
  422,
  'validation_failed',
  'Malformed input or server-side business validation failed; fields identifies invalid inputs.',
);
const forbidden = error(
  403,
  'forbidden',
  'Caller lacks the required role, ownership or internal-service permission.',
);
const unavailable = error(
  502,
  'stripe_unavailable',
  'Provider unavailable; do not report a money effect as successful. Reconcile unknown outcomes before retrying.',
);
const notFound = error(
  404,
  'not_found',
  'Requested entity is missing or not accessible; never expose another user’s record.',
);
const transition = error(
  409,
  'invalid_status_transition',
  'Current server-owned state does not permit the requested action.',
);
const pending = error(
  409,
  'request_not_pending',
  'Request was already accepted, declined, cancelled or expired.',
);
const barberUnavailable = error(
  409,
  'barber_unavailable',
  'Current onboarding, reliability, cooldown or availability state prevents this action.',
);
const stripeErrors = [unavailable];
const c = USER_ROLE_VALUE.CLIENT;
const b = USER_ROLE_VALUE.BARBER;
const a = USER_ROLE_VALUE.ADMIN;
function user(
  owner: string,
  roles: readonly UserRole[],
  rules: readonly string[],
  notes: string,
  errors: readonly ContractErrorCase[] = [],
) {
  return {
    caller: 'user' as const,
    owner,
    roles,
    rules,
    notes,
    errors: [
      error(401, 'unauthenticated', 'Missing or invalid verified user JWT.'),
      forbidden,
      validation,
      error(
        500,
        'internal_error',
        'Unexpected failure; safe error only, no internals or provider payload.',
      ),
      ...errors,
    ],
  };
}
function server(
  owner: string,
  rules: readonly string[],
  notes: string,
  errors: readonly ContractErrorCase[] = [],
) {
  return {
    caller: 'server' as const,
    owner,
    roles: [] as readonly UserRole[],
    rules,
    notes,
    errors: [
      forbidden,
      validation,
      notFound,
      error(
        500,
        'internal_error',
        'Unexpected internal failure; persist/reconcile recoverable work, never blind retry unknown money effects.',
      ),
      ...errors,
    ],
  };
}
const workerNotes =
  'Internal authenticated worker/service only, never a mobile/admin mutation endpoint. Recheck authoritative state and server-derived deadlines at execution; early/stale/duplicate work must not overwrite newer state. Applied=false reports a no-op, not a failed effect. Persist history/audit and recover dropped work; fixtures prove none of that enforcement.';
const moneyNotes =
  'Internal service only after the owning workflow has authorized the action. Derive amount, operation identity and deterministic idempotency key from persisted snapshots/work; never trust body amounts. No lock across Stripe. Unknown provider outcomes require reconciliation, not a fresh operation.';
const reliabilityNotes =
  'Admin only. Same operation under both inventory names (RULE-ADMIN-BARBER-STATUS-ALIAS). Mandatory reason; append-only correction/event/audit. Enforce current review threshold plus explicit reasoned approval for cancellation-policy suspension, and human reinstatement; no manual Connect verification override, booking cancellation or earnings confiscation.';
const reliability = user(
  'P5-T13',
  [a],
  ['RULE-ADMIN-BARBER-STATUS-ALIAS', 'RULE-RELY-05', 'RULE-RELY-06', 'ADR-013'],
  reliabilityNotes,
  [
    notFound,
    error(
      409,
      'suspension_not_eligible',
      'Cancellation-policy suspension has not met the configured current review threshold; a review flag alone is not approval.',
    ),
  ],
);

export const CONTRACT_DETAILS = {
  'create-or-sync-profile': user(
    'P1-T03',
    [c, b],
    ['RULE-ONBOARD-01', 'ADR-001'],
    'Verified JWT supplies identity. Role is only a permitted signup-journey choice, never an admin grant or a way to change an existing role; repeated sync returns the existing profile.',
  ),
  'complete-client-profile': user(
    'P1-T04',
    [c],
    ['RULE-ONBOARD-02', 'RULE-ONBOARD-05'],
    'Own profile only. Normalize/validate mobile server-side. Onboarding is complete only when required profile information AND an active address exist; the success fixture assumes the address already exists.',
  ),
  'complete-barber-profile': user(
    'P1-T06',
    [b],
    ['RULE-ONBOARD-03', 'RULE-ONBOARD-05', 'RULE-DISCOVERY-05'],
    'Own profile only. Private input coordinates resolve server-side to a SAL public area; never echo them in the response. Storage ownership, phone/photo validation and operational radius bounds belong to the owning feature; this contract invents no defaults.',
  ),
  'create-stripe-connect-onboarding-link': user(
    'P1-T07',
    [b],
    ['RULE-ONBOARD-04', 'RULE-PAY-10'],
    'Own account only. Return/refresh destinations are server-configured, never arbitrary body URLs. The URL is short-lived; do not log it or expose a Stripe account id.',
    [
      error(
        409,
        'onboarding_complete',
        'Onboarding is already verified; refresh status rather than retrying a new link.',
      ),
      ...stripeErrors,
    ],
  ),
  'refresh-stripe-connect-status': user(
    'P1-T09',
    [b],
    ['RULE-ONBOARD-04', 'RULE-PAY-07'],
    'Own account only. Map verified provider state to shared verification status; never accept a client-selected status or identity documents.',
    stripeErrors,
  ),
  'create-service-category': user(
    'P1-T10',
    [a],
    ['RULE-SERVICE-01', 'RULE-SERVICE-03'],
    'Audited admin mutation. Slug is stable; max price must exceed min. Values are integer cents, not a new launch catalogue or default pricing decision.',
  ),
  'update-service-category': user(
    'P1-T10',
    [a],
    ['RULE-SERVICE-03', 'RULE-SERVICE-04'],
    'Update a category without changing booking snapshots. Slug is not an update input; the server must reject attempted slug mutation.',
    [
      notFound,
      error(
        409,
        'slug_immutable',
        'An attempt was made to change the category’s stable slug.',
      ),
    ],
  ),
  'archive-service-category': user(
    'P1-T10',
    [a],
    ['RULE-SERVICE-03', 'RULE-SERVICE-04'],
    'Archive, never hard-delete. Repeated archive returns the existing archive timestamp; historical bookings retain snapshots.',
    [notFound],
  ),
  'upsert-barber-service': user(
    'P1-T11',
    [b],
    ['RULE-SERVICE-02', 'RULE-SERVICE-03', 'RULE-SERVICE-04'],
    'Own service only. Server checks price against the category’s current configured bounds; old booking snapshots do not change.',
    [error(404, 'category_unavailable', 'Category missing or archived.')],
  ),
  'archive-barber-service': user(
    'P1-T11',
    [b],
    ['RULE-SERVICE-04'],
    'Own service only; idempotent archive, preserve history and booking snapshots.',
    [notFound],
  ),
  'start-available-now-session': user(
    'P2-T01',
    [b],
    ['RULE-AVAIL-01', 'RULE-AVAIL-02', 'RULE-AVAIL-05', 'RULE-RELY-06'],
    'Own session only. Recheck onboarding, current reliability and one-active-job/session invariants server-side under concurrency.',
    [
      error(
        409,
        'session_already_active',
        'Barber already has an active session.',
      ),
      error(
        403,
        'onboarding_incomplete',
        'Barber is not yet eligible to publish availability.',
      ),
      barberUnavailable,
    ],
  ),
  'update-available-now-session': user(
    'P2-T01',
    [b],
    ['RULE-AVAIL-02', 'RULE-AVAIL-05'],
    'Own active session only; validate future available-until and current eligibility server-side, never infer eligibility from body state.',
    [notFound, transition, barberUnavailable],
  ),
  'stop-available-now-session': user(
    'P2-T01',
    [b],
    ['RULE-AVAIL-03'],
    'Own session only. Does not cancel an accepted booking; response is the manually-disabled session projection.',
    [notFound, transition],
  ),
  'search-available-now-barbers': user(
    'P2-T04',
    [c],
    ['RULE-DISCOVERY-01', 'RULE-DISCOVERY-05', 'RULE-RELY-06', 'RULE-SCHED-04'],
    'Supports Available Now and Scheduled branches. Input is the client’s service-address search point, not barber location. PostGIS filtering, configured radius/pagination bounds and SAL projection are server-side. Results expose only SAL mapPoint and distanceBand, never precise barber location, contact, address or Stripe identifiers. Empty result is 200, not an error.',
  ),
  'auto-disable-unresponsive-barber': server(
    'P2-T03',
    ['ADR-011', 'RULE-AVAIL-03', 'RULE-RELY-06'],
    `${workerNotes} Consecutive misses disable a session, not a reliability offence.`,
  ),
  'create-booking-request': user(
    'P2-T08',
    [c],
    [
      'RULE-REQUEST-01',
      'RULE-REQUEST-02',
      'RULE-REQUEST-03',
      'RULE-SCHED-04',
      'RULE-RELY-06',
    ],
    'Own address and an eligible barber/service. Snapshot prices/commission/config server-side; no client id, amount, status, deadline or idempotency key. P3-T06 later wires authorization before leaving a request pending.',
    [
      error(
        409,
        'active_request_exists',
        'Client already has an active pending Available Now request.',
      ),
      error(
        409,
        'duplicate_request_intent',
        'Duplicate submission must reuse the original request, not create another.',
      ),
      barberUnavailable,
    ],
  ),
  'accept-booking-request': user(
    'P2-T12',
    [b],
    ['RULE-REQUEST-05', 'RULE-AVAIL-05', 'RULE-PAY-05', 'RULE-RELY-06'],
    'Target barber only. First valid acceptance wins under real concurrency. Existing Phase 2 contract reports accepted_pending_payment, NOT paid confirmation; P3-T06 owns capture integration and any coordinated contract change.',
    [
      pending,
      error(
        409,
        'active_job_exists',
        'Barber already has an active Available Now job.',
      ),
      barberUnavailable,
    ],
  ),
  'decline-booking-request': user(
    'P2-T13',
    [b],
    ['RULE-REQUEST-05', 'RULE-REQUEST-06'],
    'Target barber only; reason optional, request must still be pending. P3-T06 later cancels its hold.',
    [pending],
  ),
  'cancel-booking-request': user(
    'P3-T07',
    [c],
    ['RULE-CANCEL-01', 'RULE-REQUEST-06'],
    'Request owner only before acceptance. Cancel the uncaptured hold, not a refund of captured money; persisted state decides eligibility.',
    [pending, unavailable],
  ),
  'expire-booking-request': server(
    'P2-T15',
    ['ADR-011', 'RULE-AVAIL-06', 'RULE-SCHED-02', 'RULE-REQUEST-06'],
    `${workerNotes} Acceptance that already committed must not be overwritten. P3-T06 wires hold cancellation.`,
  ),
  'create-payment-authorisation': user(
    'P3-T01',
    [c],
    ['ADR-006', 'RULE-PAY-01', 'RULE-PAY-02', 'RULE-PAY-04'],
    'Own request and payment method only. SDK collects card data; server authorizes the request snapshot with manual capture, no surcharge. Authorisation expiry in the example is synthetic, not a guaranteed provider lifetime. SCA/SDK recovery is implemented and evidenced by P3-T01, not these error fixtures.',
    [
      error(402, 'card_declined', 'Provider declines the authorization.'),
      error(
        402,
        'insufficient_funds',
        'Insufficient funds; distinct safe error, not an arbitrary raw decline payload.',
      ),
      error(
        402,
        'authentication_required',
        'Customer authentication is required through the owning SDK flow; never log a client secret.',
      ),
      error(
        409,
        'already_authorised',
        'Existing authorization must be reused/reconciled.',
      ),
      unavailable,
    ],
  ),
  'capture-authorised-payment': server(
    'P3-T02',
    ['RULE-PAY-03', 'RULE-PAY-04', 'RULE-PAY-05', 'RULE-PAY-09'],
    `${moneyNotes} Capture only after valid acceptance; failure keeps accepted_pending_payment. A successful duplicate returns the same captured record with idempotent=true.`,
    [
      error(
        402,
        'capture_failed',
        'Capture failed; no paid confirmation. Read authoritative booking/payment state.',
      ),
      error(
        409,
        'authorisation_expired',
        'The authorization is expired; client must re-authorize.',
      ),
      transition,
      unavailable,
    ],
  ),
  'cancel-payment-authorisation': server(
    'P3-T06',
    ['RULE-REQUEST-06', 'RULE-PAY-04'],
    `${moneyNotes} Cancels an uncaptured hold, never refunds a captured charge. An already-cancelled hold returns the same result idempotently.`,
    [transition, unavailable],
  ),
  'create-refund': server(
    'P3-T07',
    ['RULE-CANCEL-07', 'RULE-PAY-11', 'RULE-PAY-04', 'RULE-ADMIN-03'],
    `${moneyNotes} operationId references an already authorized persisted cancellation/admin refund operation, not a client-selected amount or a mandated new table. Apply the appropriate cancellation or service-refund allocation, never both.`,
    [
      error(
        409,
        'refund_not_eligible',
        'Persisted operation is not authorized or the remaining captured amount does not permit it.',
      ),
      unavailable,
    ],
  ),
  'stripe-webhook': {
    caller: 'stripe' as const,
    owner: 'P1-T09 / P3-T03',
    roles: [] as readonly UserRole[],
    rules: ['RULE-PAY-07', 'RULE-PAY-06', 'RULE-PAY-10'],
    notes:
      'Provider ingress, not a user JWT endpoint. Verify Stripe-Signature against the ORIGINAL RAW BODY before SDK decoding/Zod parsing or any write. requestSchema describes only a minimal decoded event envelope AFTER verification; object remains opaque and must be decoded using the pinned SDK before projection. Fixtures are unsigned and cannot authenticate anything. Extra provider envelope keys are stripped; never log, return or retain a full payload. Duplicate and irrelevant events acknowledge 200; persistence/reconciliation belong to owning tickets.',
    errors: [
      error(
        400,
        'invalid_signature',
        'Missing or invalid provider signature; no event parsing or data write.',
      ),
      error(400, 'invalid_event', 'Verified event cannot be decoded safely.'),
      error(
        500,
        'processing_failed',
        'Verified event processing failed; no false acknowledgement of a required durable effect.',
      ),
    ],
  },
  'mark-on-the-way': user(
    'P4-T03',
    [b],
    ['RULE-ETA-01', 'RULE-ETA-05', 'ADR-010'],
    'Assigned barber only. Both coordinates or neither: permission denied still allows transition with ETA unavailable. No location reads before consent; response exposes ETA only, not the origin.',
    [
      transition,
      error(
        409,
        'already_on_the_way',
        'Already transitioned; do not start another routing loop.',
      ),
    ],
  ),
  'update-eta': user(
    'P4-T05',
    [b],
    ['RULE-ETA-02', 'RULE-ETA-03', 'RULE-ETA-04', 'RULE-ETA-05'],
    'Assigned barber on an active booking only. Server may invoke the same service from due-work scans. Coordinate pair is input-only; response has paired ETA/timestamp or both null. Refresh is throttled by server config, Google calls/keys server-side, stop when inactive.',
    [notFound, transition],
  ),
  'mark-arrived': user(
    'P4-T03',
    [b],
    ['ADR-010', 'RULE-ETA-01'],
    'Assigned barber and valid active transition only; history/audit server-side. No client-selected status.',
    [notFound, transition],
  ),
  'mark-job-complete-by-barber': user(
    'P4-T07',
    [b],
    ['RULE-COMPLETE-01', 'RULE-COMPLETE-02', 'RULE-EARN-03'],
    'Assigned barber only. Start the configured server-derived client response window; earning stays pending, not released by this action.',
    [transition],
  ),
  'confirm-job-complete-by-client': user(
    'P4-T09',
    [c],
    ['RULE-COMPLETE-02', 'RULE-EARN-02', 'RULE-EARN-03'],
    'Booking client only, current state/window verified server-side. Open disputes prevent release.',
    [
      error(409, 'already_completed', 'Completion already applied.'),
      error(
        409,
        'response_window_closed',
        'Persisted response deadline has passed.',
      ),
      transition,
    ],
  ),
  'open-dispute': user(
    'P4-T12',
    [c, a],
    ['RULE-DISPUTE-01', 'RULE-DISPUTE-02', 'RULE-EARN-03'],
    'Booking client within eligible server window, or an authorized admin operational case. One open dispute; earning held. Reason category is nonempty text because no category enum is decided here.',
    [
      error(
        409,
        'dispute_already_open',
        'An open dispute already exists for this booking.',
      ),
      error(
        409,
        'dispute_window_closed',
        'Client’s configured dispute window has closed.',
      ),
    ],
  ),
  'auto-complete-after-barber-complete-timeout': server(
    'P4-T11',
    ['ADR-011', 'RULE-COMPLETE-02', 'RULE-EARN-03'],
    workerNotes,
  ),
  'send-final-completion-prompt': server(
    'P4-T11',
    ['ADR-011', 'RULE-COMPLETE-04'],
    `${workerNotes} Preserve a full configured response window even when the warning worker is late; durable notification send failure must not roll back the state.`,
  ),
  'auto-complete-after-final-prompt': server(
    'P4-T11',
    ['ADR-011', 'RULE-COMPLETE-04', 'RULE-EARN-03'],
    workerNotes,
  ),
  'cancel-booking': user(
    'P3-T07',
    [c, b],
    ['RULE-CANCEL-01', 'RULE-CANCEL-07', 'RULE-PAY-11'],
    'Participating client/barber only. Server selects rule and request-time cancellation snapshot. Commission is pre-processing-fee; QuickTrimr bears retained provider fees. Pending/failed refunds cannot release inconvenience earnings or falsely complete a cancelled booking.',
    [
      error(
        409,
        'booking_not_cancellable',
        'Server-owned booking is terminal or otherwise ineligible.',
      ),
      unavailable,
    ],
  ),
  'create-barber-earning': server(
    'P3-T04',
    ['RULE-EARN-01', 'RULE-PAY-11', 'RULE-CANCEL-07'],
    `${moneyNotes} One earning per booking, initially pending after capture. Replay returns the full current record; never create a second entitlement or reapply current pricing.`,
    [transition],
  ),
  'release-barber-earning': server(
    'P3-T04',
    ['RULE-EARN-02', 'RULE-EARN-03'],
    `${workerNotes} Require eligible completion, successful cancellation/refund exception, or eligible admin resolution. Never release during an open dispute; cancelled is not completed.`,
    [
      error(409, 'dispute_open', 'An open dispute prevents earning release.'),
      transition,
    ],
  ),
  'queue-payout-batch': server(
    'P3-T10',
    ['RULE-EARN-07', 'ADR-011'],
    `${moneyNotes} Server chooses the original scheduled Australia/Sydney cut-off and persisted config, including DST. Only eligible available earnings strictly before it. Empty tick returns batchId=null/zero totals without a provider call; this is not a payout schedule input.`,
    [
      error(
        409,
        'payout_not_due',
        'No eligible scheduled payout run is currently due.',
      ),
    ],
  ),
  'process-payout-batch': server(
    'P3-T11',
    ['RULE-EARN-05', 'RULE-EARN-06', 'RULE-EARN-07', 'RULE-PAY-09'],
    `${moneyNotes} Process per-barber items independently. Transfer success is NOT bank-payout paid; mixed failures remain visible, bank/account-action failures are held, ambiguous outcomes reconcile before retry.`,
    [transition, unavailable],
  ),
  'mark-payout-batch-paid': server(
    'P3-T11',
    ['RULE-EARN-06', 'RULE-EARN-07', 'RULE-PAY-06'],
    `${moneyNotes} Reconciliation only: require verified provider confirmation that ALL mapped bank payout items are paid, not just transfers created. Later bank failures append a correction; never erase history.`,
    [
      error(
        409,
        'payout_not_settled',
        'At least one mapped bank payout has not been confirmed paid.',
      ),
      unavailable,
    ],
  ),
  'create-review': user(
    'P4-T14',
    [c],
    ['RULE-REVIEW-01', 'RULE-REVIEW-06'],
    'Booking client only, one review, server-owned eligible outcome and configured review window. Resolution time is server-owned; no review during an open dispute.',
    [
      error(
        409,
        'review_already_exists',
        'A review already exists for this booking.',
      ),
      error(
        409,
        'booking_not_reviewable',
        'Server-owned outcome is not eligible for review.',
      ),
      error(
        409,
        'review_window_closed',
        'Configured review window has closed.',
      ),
    ],
  ),
  'update-review-admin-visibility': user(
    'P5-T12',
    [a],
    ['RULE-REVIEW-04', 'RULE-REVIEW-05', 'ADR-013'],
    'Reasoned audited hide/unhide; recompute public aggregate server-side. No automatic moderation policy.',
    [notFound],
  ),
  'admin-list-bookings': user(
    'P5-T04',
    [a],
    ['RULE-ADMIN-01', 'RULE-ADMIN-04'],
    'Admin verified BEFORE query. clientId/barberId are filters, not caller identity. Validate/allowlist/configure pagination bounds server-side; example limit is not a production default or maximum. List contains no address/contact fields.',
  ),
  'admin-get-booking-detail': user(
    'P5-T04',
    [a],
    ['RULE-ADMIN-01', 'ADR-010'],
    'Admin verified before data fetch; audited operational detail, minimal safe payment reference, no raw Stripe payload or identity document. This projection deliberately adds no contact/address fields.',
    [notFound],
  ),
  'admin-resolve-dispute': user(
    'P5-T07',
    [a],
    ['RULE-DISPUTE-04', 'RULE-DISPUTE-05', 'RULE-PAY-11', 'RULE-CANCEL-07'],
    'refundCents is allowed ONLY as bounded admin partial-refund intent, never trusted financial truth. Server validates remaining capture/cumulative refunds/snapshots, calculates allocation, applies state consistently and audits. Full refund reverses earning; failed refund leaves dispute open. Operational outcome still requires the documented eligible resolution; no hidden money defaults.',
    [
      error(
        409,
        'dispute_already_resolved',
        'Dispute is already resolved; read authoritative state.',
      ),
      unavailable,
    ],
  ),
  'admin-issue-refund': user(
    'P5-T07',
    [a],
    ['RULE-ADMIN-03', 'RULE-PAY-11', 'RULE-CANCEL-07'],
    'Mandatory reason and bounded refund INTENT. Server validates remaining capture/cumulative refunds and selects correct allocation from original snapshots. No new client refund endpoint, client-selected charged amount or key.',
    [
      notFound,
      error(
        409,
        'refund_not_eligible',
        'Persisted booking/payment state does not permit this refund.',
      ),
      unavailable,
    ],
  ),
  'admin-update-barber-status': reliability,
  'admin-update-reliability-state': reliability,
  'admin-view-platform-analytics': user(
    'P5-T01',
    [a],
    ['RULE-ADMIN-01', 'RULE-ADMIN-04'],
    'Server-authorized aggregate counts for the validated date interval, indexed queries not browser counts or full-table downloads. No PII in the aggregate response.',
  ),
} as const satisfies Record<
  ContractName,
  {
    readonly caller: 'user' | 'server' | 'stripe';
    readonly owner: string;
    readonly roles: readonly UserRole[];
    readonly rules: readonly string[];
    readonly notes: string;
    readonly errors: readonly ContractErrorCase[];
  }
>;
