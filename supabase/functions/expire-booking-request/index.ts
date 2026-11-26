import {
  expireBookingRequestRequestSchema,
  expireBookingRequestResponseSchema,
} from '@quicktrimr/validation';

import { supabaseRuntimeConfig } from '../_shared/services/runtime-config.ts';
import { createWorkerRpcHandler } from '../_shared/services/worker-rpc.ts';

Deno.serve(
  createWorkerRpcHandler({
    ...supabaseRuntimeConfig((name) => Deno.env.get(name)),
    rpc: 'expire_booking_request',
    parameter: 'p_request_id',
    inputSchema: expireBookingRequestRequestSchema,
    responseSchema: expireBookingRequestResponseSchema,
    readId: (input) => input.requestId,
    failureEvent: 'booking_request_expiry_worker_request_failed',
  }),
);
