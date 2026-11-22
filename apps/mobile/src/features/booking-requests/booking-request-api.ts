import {
  bookingRequestReviewSchema,
  clientBookingRequestSchema,
} from '@quicktrimr/validation';

import { invokeEdgeFunction } from '@/lib/api/invoke-edge-function';
import { supabaseEdgeTransport } from '@/lib/api/supabase-edge-transport';

import type { CreateBookingRequestRequest } from '@quicktrimr/validation';
import type { SupabaseClient } from '@supabase/supabase-js';

export function bookingRequestApi(supabase: SupabaseClient, userId: string) {
  async function session() {
    const result = await supabase.auth.getSession();
    if (result.error || result.data.session?.user.id !== userId)
      throw new Error('Session changed.');
    return result.data.session;
  }

  return {
    async review(input: CreateBookingRequestRequest, signal?: AbortSignal) {
      await session();
      const query = supabase.rpc('get_booking_request_review', {
        p_input: input,
      });
      const result = await (signal ? query.abortSignal(signal) : query);
      if (result.error) throw result.error;
      await session();
      return bookingRequestReviewSchema.nullable().parse(result.data);
    },
    async submit(input: CreateBookingRequestRequest) {
      const current = await session();
      const result = await invokeEdgeFunction(
        supabaseEdgeTransport(supabase, current.access_token),
        'create-booking-request',
        input,
      );
      await session();
      return result;
    },
    async status(
      requestId: string | null,
      activeAvailableNow: boolean,
      signal: AbortSignal,
    ) {
      await session();
      const result = await supabase
        .rpc('get_client_booking_request', {
          p_request_id: requestId,
          p_active_available_now: activeAvailableNow,
        })
        .abortSignal(signal);
      if (result.error) throw result.error;
      await session();
      return clientBookingRequestSchema.nullable().parse(result.data);
    },
  };
}

export type BookingRequestApi = ReturnType<typeof bookingRequestApi>;
