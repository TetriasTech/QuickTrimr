import { barberRequestInboxWithJobSlotSchema } from '@quicktrimr/validation';

import { availabilityApi } from '@/features/availability/availability-api';

import type { BarberRequestInboxPage } from '@quicktrimr/validation';
import type { SupabaseClient } from '@supabase/supabase-js';

export type InboxCursor = BarberRequestInboxPage['nextCursor'];

export function barberInboxApi(supabase: SupabaseClient, userId: string) {
  async function verifySession(signal: AbortSignal) {
    const { data, error } = await supabase.auth.getSession();
    if (signal.aborted || error || data.session?.user.id !== userId) {
      throw new Error('Session changed.');
    }
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
  };
}

export type BarberInboxApi = ReturnType<typeof barberInboxApi>;
