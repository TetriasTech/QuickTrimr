import {
  barberBookingStatusSchema,
  barberRequestInboxWithJobSlotSchema,
} from '@quicktrimr/validation';

import { availabilityApi } from '@/features/availability/availability-api';
import { invokeEdgeFunction } from '@/lib/api/invoke-edge-function';
import { supabaseEdgeTransport } from '@/lib/api/supabase-edge-transport';

import type { EdgeFunctionTransport } from '@/lib/api/invoke-edge-function';
import type { BarberRequestInboxPage } from '@quicktrimr/validation';
import type { SupabaseClient } from '@supabase/supabase-js';

export type InboxCursor = BarberRequestInboxPage['nextCursor'];

export function barberInboxApi(supabase: SupabaseClient, userId: string) {
  async function verifySession(signal?: AbortSignal) {
    const { data, error } = await supabase.auth.getSession();
    if (signal?.aborted || error || data.session?.user.id !== userId) {
      throw new Error('Session changed.');
    }
    return data.session;
  }

  async function respond<Result extends { requestId: string }>(
    requestId: string,
    send: (transport: EdgeFunctionTransport) => Promise<Result>,
  ) {
    const session = await verifySession();
    const result = await send(
      supabaseEdgeTransport(supabase, session.access_token),
    );
    await verifySession();
    if (result.requestId !== requestId)
      throw new Error('Unexpected request response.');
    return result;
  }

  return {
    async read(cursor: InboxCursor, signal: AbortSignal) {
      await verifySession(signal);
      const result = await supabase
        .rpc(
          'get_barber_request_inbox_page',
          cursor
            ? {
                p_after_expires_at: cursor.expiresAt,
                p_after_request_id: cursor.requestId,
              }
            : {},
        )
        .abortSignal(signal);
      if (result.error) throw result.error;
      await verifySession(signal);
      return barberRequestInboxWithJobSlotSchema.parse(result.data);
    },
    readAvailability: availabilityApi(supabase, userId).read,
    accept: (requestId: string) =>
      respond(requestId, (transport) =>
        invokeEdgeFunction(transport, 'accept-booking-request', { requestId }),
      ),
    decline: (requestId: string) =>
      respond(requestId, (transport) =>
        invokeEdgeFunction(transport, 'decline-booking-request', { requestId }),
      ),
    async readBookingStatus(bookingId: string, signal: AbortSignal) {
      await verifySession(signal);
      const result = await supabase
        .from('bookings')
        .select('id,status')
        .eq('id', bookingId)
        .eq('barber_id', userId)
        .abortSignal(signal)
        .maybeSingle();
      if (result.error) throw result.error;
      await verifySession(signal);
      return barberBookingStatusSchema.nullable().parse(result.data);
    },
  };
}

export type BarberInboxApi = ReturnType<typeof barberInboxApi>;
