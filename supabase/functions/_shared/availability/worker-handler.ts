import {
  autoDisableUnresponsiveBarberRequestSchema,
  autoDisableUnresponsiveBarberResponseSchema,
} from '@quicktrimr/validation';

import { createWorkerRpcHandler } from '../services/worker-rpc.ts';

export function createAvailabilityWorkerHandler(
  config: Pick<
    Parameters<typeof createWorkerRpcHandler>[0],
    'supabaseUrl' | 'serviceRoleKey' | 'fetcher' | 'log'
  >,
) {
  return createWorkerRpcHandler({
    ...config,
    rpc: 'auto_disable_available_now_session',
    parameter: 'p_session_id',
    inputSchema: autoDisableUnresponsiveBarberRequestSchema,
    responseSchema: autoDisableUnresponsiveBarberResponseSchema,
    readId: (input) => input.sessionId,
    failureEvent: 'available_now_worker_request_failed',
  });
}
