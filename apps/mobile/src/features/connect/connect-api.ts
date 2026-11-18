import { invokeEdgeFunction } from '../../lib/api/invoke-edge-function.ts';
import { supabaseEdgeTransport } from '../../lib/api/supabase-edge-transport.ts';

import type { SupabaseClient } from '@supabase/supabase-js';

// Bind every operation to the currently mounted account, including after token refresh.
export function connectApi(supabase: SupabaseClient, userId: string) {
  async function transport(signal: AbortSignal) {
    const { data, error } = await supabase.auth.getSession();
    if (error || data.session?.user.id !== userId || signal.aborted)
      throw new Error('Session changed.');
    return supabaseEdgeTransport(supabase, data.session.access_token, signal);
  }
  return {
    async refresh(signal: AbortSignal) {
      return invokeEdgeFunction(
        await transport(signal),
        'refresh-stripe-connect-status',
        {},
      );
    },
    async createLink(signal: AbortSignal) {
      return invokeEdgeFunction(
        await transport(signal),
        'create-stripe-connect-onboarding-link',
        {},
      );
    },
  };
}
