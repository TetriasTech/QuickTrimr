import { z } from 'zod';

import { errorResponseSchema } from '../error-response.ts';

import * as admin from './admin.ts';
import {
  startAvailableNowSessionRequestSchema,
  startAvailableNowSessionResponseSchema,
  stopAvailableNowSessionRequestSchema,
  stopAvailableNowSessionResponseSchema,
  updateAvailableNowSessionRequestSchema,
  updateAvailableNowSessionResponseSchema,
} from './available-now.ts';
import {
  upsertBarberServiceRequestSchema,
  upsertBarberServiceResponseSchema,
} from './barber-service.ts';
import {
  acceptBookingRequestRequestSchema,
  acceptBookingRequestResponseSchema,
  cancelBookingRequestRequestSchema,
  cancelBookingRequestResponseSchema,
  createBookingRequestRequestSchema,
  createBookingRequestResponseSchema,
  declineBookingRequestRequestSchema,
  declineBookingRequestResponseSchema,
} from './booking-requests.ts';
import * as catalogue from './catalogue.ts';
import * as discovery from './discovery.ts';
import {
  cancelBookingRequestSchema,
  cancelBookingResponseSchema,
  confirmJobCompleteByClientRequestSchema,
  confirmJobCompleteByClientResponseSchema,
  markJobCompleteByBarberRequestSchema,
  markJobCompleteByBarberResponseSchema,
  markArrivedRequestSchema,
  markArrivedResponseSchema,
  markOnTheWayRequestSchema,
  markOnTheWayResponseSchema,
  openDisputeRequestSchema,
  openDisputeResponseSchema,
  updateEtaRequestSchema,
  updateEtaResponseSchema,
} from './lifecycle.ts';
import * as payments from './payments.ts';
import * as profiles from './profiles.ts';
import {
  createReviewRequestSchema,
  createReviewResponseSchema,
} from './reviews.ts';
import * as workers from './workers.ts';

export * from './admin.ts';
export * from './available-now.ts';
export * from './barber-service.ts';
export * from './booking-requests.ts';
export * from './catalogue.ts';
export * from './discovery.ts';
export * from './lifecycle.ts';
export * from './payments.ts';
export * from './profiles.ts';
export * from './reviews.ts';
export * from './workers.ts';

export const CORE_CONTRACTS = {
  'start-available-now-session': {
    requestSchema: startAvailableNowSessionRequestSchema,
    responseSchema: startAvailableNowSessionResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'update-available-now-session': {
    requestSchema: updateAvailableNowSessionRequestSchema,
    responseSchema: updateAvailableNowSessionResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'stop-available-now-session': {
    requestSchema: stopAvailableNowSessionRequestSchema,
    responseSchema: stopAvailableNowSessionResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'upsert-barber-service': {
    requestSchema: upsertBarberServiceRequestSchema,
    responseSchema: upsertBarberServiceResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'create-booking-request': {
    requestSchema: createBookingRequestRequestSchema,
    responseSchema: createBookingRequestResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'accept-booking-request': {
    requestSchema: acceptBookingRequestRequestSchema,
    responseSchema: acceptBookingRequestResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'decline-booking-request': {
    requestSchema: declineBookingRequestRequestSchema,
    responseSchema: declineBookingRequestResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'cancel-booking-request': {
    requestSchema: cancelBookingRequestRequestSchema,
    responseSchema: cancelBookingRequestResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'cancel-booking': {
    requestSchema: cancelBookingRequestSchema,
    responseSchema: cancelBookingResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'mark-on-the-way': {
    requestSchema: markOnTheWayRequestSchema,
    responseSchema: markOnTheWayResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'update-eta': {
    requestSchema: updateEtaRequestSchema,
    responseSchema: updateEtaResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'mark-job-complete-by-barber': {
    requestSchema: markJobCompleteByBarberRequestSchema,
    responseSchema: markJobCompleteByBarberResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'confirm-job-complete-by-client': {
    requestSchema: confirmJobCompleteByClientRequestSchema,
    responseSchema: confirmJobCompleteByClientResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'open-dispute': {
    requestSchema: openDisputeRequestSchema,
    responseSchema: openDisputeResponseSchema,
    errorSchema: errorResponseSchema,
  },
  'create-review': {
    requestSchema: createReviewRequestSchema,
    responseSchema: createReviewResponseSchema,
    errorSchema: errorResponseSchema,
  },
} as const;

function contract<Request extends z.ZodType, Response extends z.ZodType>(
  requestSchema: Request,
  responseSchema: Response,
) {
  return { requestSchema, responseSchema, errorSchema: errorResponseSchema };
}

export const CONTRACTS = {
  ...CORE_CONTRACTS,
  'create-or-sync-profile': contract(
    profiles.createOrSyncProfileRequestSchema,
    profiles.createOrSyncProfileResponseSchema,
  ),
  'complete-client-profile': contract(
    profiles.completeClientProfileRequestSchema,
    profiles.completeClientProfileResponseSchema,
  ),
  'complete-barber-profile': contract(
    profiles.completeBarberProfileRequestSchema,
    profiles.completeBarberProfileResponseSchema,
  ),
  'create-stripe-connect-onboarding-link': contract(
    profiles.createStripeConnectOnboardingLinkRequestSchema,
    profiles.createStripeConnectOnboardingLinkResponseSchema,
  ),
  'refresh-stripe-connect-status': contract(
    profiles.refreshStripeConnectStatusRequestSchema,
    profiles.refreshStripeConnectStatusResponseSchema,
  ),
  'create-service-category': contract(
    catalogue.createServiceCategoryRequestSchema,
    catalogue.createServiceCategoryResponseSchema,
  ),
  'update-service-category': contract(
    catalogue.updateServiceCategoryRequestSchema,
    catalogue.updateServiceCategoryResponseSchema,
  ),
  'archive-service-category': contract(
    catalogue.archiveServiceCategoryRequestSchema,
    catalogue.archiveServiceCategoryResponseSchema,
  ),
  'archive-barber-service': contract(
    catalogue.archiveBarberServiceRequestSchema,
    catalogue.archiveBarberServiceResponseSchema,
  ),
  'search-available-now-barbers': contract(
    discovery.searchAvailableNowBarbersRequestSchema,
    discovery.searchAvailableNowBarbersResponseSchema,
  ),
  'create-payment-authorisation': contract(
    payments.createPaymentAuthorisationRequestSchema,
    payments.createPaymentAuthorisationResponseSchema,
  ),
  'capture-authorised-payment': contract(
    payments.captureAuthorisedPaymentRequestSchema,
    payments.captureAuthorisedPaymentResponseSchema,
  ),
  'cancel-payment-authorisation': contract(
    payments.cancelPaymentAuthorisationRequestSchema,
    payments.cancelPaymentAuthorisationResponseSchema,
  ),
  'create-refund': contract(
    payments.createRefundRequestSchema,
    payments.createRefundResponseSchema,
  ),
  'stripe-webhook': contract(
    payments.stripeWebhookRequestSchema,
    payments.stripeWebhookResponseSchema,
  ),
  'mark-arrived': contract(markArrivedRequestSchema, markArrivedResponseSchema),
  'auto-disable-unresponsive-barber': contract(
    workers.autoDisableUnresponsiveBarberRequestSchema,
    workers.autoDisableUnresponsiveBarberResponseSchema,
  ),
  'expire-booking-request': contract(
    workers.expireBookingRequestRequestSchema,
    workers.expireBookingRequestResponseSchema,
  ),
  'auto-complete-after-barber-complete-timeout': contract(
    workers.autoCompleteAfterBarberCompleteTimeoutRequestSchema,
    workers.autoCompleteAfterBarberCompleteTimeoutResponseSchema,
  ),
  'send-final-completion-prompt': contract(
    workers.sendFinalCompletionPromptRequestSchema,
    workers.sendFinalCompletionPromptResponseSchema,
  ),
  'auto-complete-after-final-prompt': contract(
    workers.autoCompleteAfterFinalPromptRequestSchema,
    workers.autoCompleteAfterFinalPromptResponseSchema,
  ),
  'create-barber-earning': contract(
    workers.createBarberEarningRequestSchema,
    workers.createBarberEarningResponseSchema,
  ),
  'release-barber-earning': contract(
    workers.releaseBarberEarningRequestSchema,
    workers.releaseBarberEarningResponseSchema,
  ),
  'queue-payout-batch': contract(
    workers.queuePayoutBatchRequestSchema,
    workers.queuePayoutBatchResponseSchema,
  ),
  'process-payout-batch': contract(
    workers.processPayoutBatchRequestSchema,
    workers.processPayoutBatchResponseSchema,
  ),
  'mark-payout-batch-paid': contract(
    workers.markPayoutBatchPaidRequestSchema,
    workers.markPayoutBatchPaidResponseSchema,
  ),
  'update-review-admin-visibility': contract(
    admin.updateReviewAdminVisibilityRequestSchema,
    admin.updateReviewAdminVisibilityResponseSchema,
  ),
  'admin-list-bookings': contract(
    admin.adminListBookingsRequestSchema,
    admin.adminListBookingsResponseSchema,
  ),
  'admin-get-booking-detail': contract(
    admin.adminGetBookingDetailRequestSchema,
    admin.adminGetBookingDetailResponseSchema,
  ),
  'admin-resolve-dispute': contract(
    admin.adminResolveDisputeRequestSchema,
    admin.adminResolveDisputeResponseSchema,
  ),
  'admin-issue-refund': contract(
    admin.adminIssueRefundRequestSchema,
    admin.adminIssueRefundResponseSchema,
  ),
  'admin-update-reliability-state': contract(
    admin.adminUpdateReliabilityStateRequestSchema,
    admin.adminUpdateReliabilityStateResponseSchema,
  ),
  'admin-update-barber-status': contract(
    admin.adminUpdateBarberStatusRequestSchema,
    admin.adminUpdateBarberStatusResponseSchema,
  ),
  'admin-view-platform-analytics': contract(
    admin.adminViewPlatformAnalyticsRequestSchema,
    admin.adminViewPlatformAnalyticsResponseSchema,
  ),
} as const;

export type ContractName = keyof typeof CONTRACTS;
export type ContractRequest<Name extends ContractName> = z.infer<
  (typeof CONTRACTS)[Name]['requestSchema']
>;
export type ContractResponse<Name extends ContractName> = z.infer<
  (typeof CONTRACTS)[Name]['responseSchema']
>;
