import { z } from 'zod';

import { errorResponseSchema } from '../error-response.ts';

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
import {
  cancelBookingRequestSchema,
  cancelBookingResponseSchema,
  confirmJobCompleteByClientRequestSchema,
  confirmJobCompleteByClientResponseSchema,
  markJobCompleteByBarberRequestSchema,
  markJobCompleteByBarberResponseSchema,
  markOnTheWayRequestSchema,
  markOnTheWayResponseSchema,
  openDisputeRequestSchema,
  openDisputeResponseSchema,
  updateEtaRequestSchema,
  updateEtaResponseSchema,
} from './lifecycle.ts';
import {
  createReviewRequestSchema,
  createReviewResponseSchema,
} from './reviews.ts';

export * from './available-now.ts';
export * from './barber-service.ts';
export * from './booking-requests.ts';
export * from './lifecycle.ts';
export * from './reviews.ts';

export const CONTRACTS = {
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

export type ContractName = keyof typeof CONTRACTS;
export type ContractRequest<Name extends ContractName> = z.infer<
  (typeof CONTRACTS)[Name]['requestSchema']
>;
export type ContractResponse<Name extends ContractName> = z.infer<
  (typeof CONTRACTS)[Name]['responseSchema']
>;
