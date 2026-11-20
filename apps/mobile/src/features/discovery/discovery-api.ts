import { serviceCategoryListSchema } from '@quicktrimr/validation';

import { SERVICE_CATALOGUE_PAGE_SIZE } from '@/features/services/service-catalogue';
import { invokeEdgeFunction } from '@/lib/api/invoke-edge-function';
import { supabaseEdgeTransport } from '@/lib/api/supabase-edge-transport';

import type {
  ContractRequest,
  SearchAvailableNowBarbersRequest,
} from '@quicktrimr/validation';
import type { SupabaseClient } from '@supabase/supabase-js';
export function discoveryApi(supabase: SupabaseClient, userId: string) {
  async function session(signal?: AbortSignal) {
    const r = await supabase.auth.getSession();
    if (r.error || r.data.session?.user.id !== userId || signal?.aborted)
      throw new Error('Session changed.');
    return r.data.session;
  }
  async function invoke<
    Name extends 'get-discovery-filters' | 'search-available-now-barbers',
  >(name: Name, input: ContractRequest<Name>, signal: AbortSignal) {
    const current = await session(signal);
    const result = await invokeEdgeFunction(
      supabaseEdgeTransport(supabase, current.access_token, signal),
      name,
      input,
    );
    await session(signal);
    return result;
  }
  return {
    inputs: (addressId: string | null, signal: AbortSignal) =>
      invoke('get-discovery-filters', addressId ? { addressId } : {}, signal),
    search: (input: SearchAvailableNowBarbersRequest, signal: AbortSignal) =>
      invoke('search-available-now-barbers', input, signal),
    async categories(offset: number, signal: AbortSignal) {
      await session(signal);
      const r = await supabase
        .from('service_categories')
        .select(
          'id,slug,displayName:display_name,description,displayOrder:display_order,minPriceCents:min_price_cents,maxPriceCents:max_price_cents,archivedAt:archived_at',
        )
        .is('archived_at', null)
        .order('display_order')
        .order('slug')
        .order('id')
        .range(offset, offset + SERVICE_CATALOGUE_PAGE_SIZE - 1)
        .abortSignal(signal);
      if (r.error) throw r.error;
      await session(signal);
      return serviceCategoryListSchema.parse(r.data);
    },
  };
}
