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
  serviceCategoryId?: string,
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
        {
          barberId,
          ...(after ? { servicesAfter: after } : {}),
          ...(serviceCategoryId ? { serviceCategoryId } : {}),
        },
      );
      await session(signal);
      if (result.profile && result.profile.barberId !== barberId.toLowerCase())
        throw new Error('Unexpected profile.');
      const parsed = getPublicBarberProfileResponseSchema.parse(result);
      if (
        serviceCategoryId &&
        parsed.profile &&
        (parsed.profile.selectedService === undefined ||
          (parsed.profile.selectedService &&
            parsed.profile.selectedService.serviceCategoryId !==
              serviceCategoryId.toLowerCase()))
      )
        throw new Error('Unexpected selected service.');
      return parsed;
    },
  };
}
export type PublicProfileApi = ReturnType<typeof publicProfileApi>;
