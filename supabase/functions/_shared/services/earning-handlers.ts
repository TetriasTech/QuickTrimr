import {
  createBarberEarningRequestSchema,
  createBarberEarningResponseSchema,
  releaseBarberEarningRequestSchema,
  releaseBarberEarningResponseSchema,
} from '@quicktrimr/validation';

import { createWorkerRpcHandler } from './worker-rpc.ts';

type Runtime = Pick<
  Parameters<typeof createWorkerRpcHandler>[0],
  'supabaseUrl' | 'serviceRoleKey' | 'fetcher' | 'log'
>;

export function createEarningHandler(runtime: Runtime) {
  return createWorkerRpcHandler({
    ...runtime,
    rpc: 'create_barber_earning',
    parameter: 'p_booking_id',
    inputSchema: createBarberEarningRequestSchema,
    responseSchema: createBarberEarningResponseSchema,
    readId: ({ bookingId }) => bookingId,
    failureEvent: 'earning_create_failed',
    conflicts: ['invalid_status_transition'],
  });
}

export function releaseEarningHandler(runtime: Runtime) {
  return createWorkerRpcHandler({
    ...runtime,
    rpc: 'release_barber_earning',
    parameter: 'p_earning_id',
    inputSchema: releaseBarberEarningRequestSchema,
    responseSchema: releaseBarberEarningResponseSchema,
    readId: ({ earningId }) => earningId,
    failureEvent: 'earning_release_failed',
    conflicts: ['dispute_open', 'invalid_status_transition'],
  });
}
