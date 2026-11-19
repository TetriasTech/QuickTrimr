import {
  barberServiceCataloguePageSchema,
  type UpsertBarberServiceRequest,
} from '@quicktrimr/validation';

import { invokeEdgeFunction } from '@/lib/api/invoke-edge-function';
import { supabaseEdgeTransport } from '@/lib/api/supabase-edge-transport';

import type { SupabaseClient } from '@supabase/supabase-js';

// Transport page size, not a limit on the categories a barber may offer.
export const SERVICE_CATALOGUE_PAGE_SIZE = 20;
const select =
  'id,slug,displayName:display_name,description,displayOrder:display_order,minPriceCents:min_price_cents,maxPriceCents:max_price_cents,archivedAt:archived_at,services:barber_services(id,serviceCategoryId:service_category_id,priceCents:price_cents,archivedAt:archived_at)';

export function barberServicesApi(supabase: SupabaseClient, userId: string) {
  async function session(signal?: AbortSignal) {
    const result = await supabase.auth.getSession();
    if (
      result.error ||
      result.data.session?.user.id !== userId ||
      signal?.aborted
    )
      throw new Error('Session changed.');
    return result.data.session;
  }
  return {
    async page(offset: number, signal: AbortSignal) {
      await session(signal);
      const result = await supabase
        .from('service_categories')
        .select(select)
        .is('archived_at', null)
        .eq('services.barber_id', userId)
        .order('display_order')
        .order('slug')
        .order('id')
        .range(offset, offset + SERVICE_CATALOGUE_PAGE_SIZE - 1)
        .abortSignal(signal);
      if (result.error) throw result.error;
      await session(signal);
      return barberServiceCataloguePageSchema.parse(result.data);
    },
    async upsert(input: UpsertBarberServiceRequest) {
      const current = await session();
      const result = await invokeEdgeFunction(
        supabaseEdgeTransport(supabase, current.access_token),
        'upsert-barber-service',
        input,
      );
      await session();
      if (result.serviceCategoryId !== input.serviceCategoryId)
        throw new Error('Unexpected service response.');
      return result;
    },
    async archive(serviceId: string) {
      const current = await session();
      const result = await invokeEdgeFunction(
        supabaseEdgeTransport(supabase, current.access_token),
        'archive-barber-service',
        { serviceId },
      );
      await session();
      if (result.id !== serviceId)
        throw new Error('Unexpected service response.');
      return result;
    },
  };
}
