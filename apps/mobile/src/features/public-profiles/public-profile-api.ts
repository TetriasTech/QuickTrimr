import {
  getPublicBarberProfileResponseSchema,
  type PublicServicesCursor,
} from '@quicktrimr/validation';

import { invokeEdgeFunction } from '@/lib/api/invoke-edge-function';
import { supabaseEdgeTransport } from '@/lib/api/supabase-edge-transport';

import type { SupabaseClient } from '@supabase/supabase-js';

export function publicProfileApi(
  supabase: SupabaseClient,
  userId: string,
  barberId: string,
) {
  async function session(signal: AbortSignal) {
    const { data, error } = await supabase.auth.getSession();
    if (error || data.session?.user.id !== userId || signal.aborted)
      throw new Error('Session changed.');
    return data.session;
  }
  return {
    async page(after: PublicServicesCursor | undefined, signal: AbortSignal) {
      const current = await session(signal);
      const result = await invokeEdgeFunction(
        supabaseEdgeTransport(supabase, current.access_token, signal),
        'get-public-barber-profile',
        { barberId, ...(after ? { servicesAfter: after } : {}) },
      );
      await session(signal);
      if (result.profile && result.profile.barberId !== barberId.toLowerCase())
        throw new Error('Unexpected profile.');
      return getPublicBarberProfileResponseSchema.parse(result);
    },
  };
}
export type PublicProfileApi = ReturnType<typeof publicProfileApi>;
