import { invokeEdgeFunction } from '@/lib/api/invoke-edge-function';
import { supabaseEdgeTransport } from '@/lib/api/supabase-edge-transport';

import type {
  ClientAddressCandidate,
  ManageClientAddressesRequest,
  ManageClientAddressesResponse,
} from '@quicktrimr/validation';
import type { SupabaseClient } from '@supabase/supabase-js';

type AddressOperation = ManageClientAddressesRequest['operation'];
type AddressResult<Action extends AddressOperation> = Extract<
  ManageClientAddressesResponse,
  { operation: Action }
>;

export function formatClientAddress(
  address: Omit<ClientAddressCandidate, 'directoryId'>,
) {
  const unit = address.unit ? `${address.unit}/` : '';
  return `${unit}${address.line1}, ${address.suburb} ${address.state} ${address.postcode}`;
}

export async function clientAddressOperation<Action extends AddressOperation>(
  supabase: SupabaseClient,
  userId: string,
  request: Extract<ManageClientAddressesRequest, { operation: Action }>,
  signal?: AbortSignal,
): Promise<AddressResult<Action>> {
  const current = await supabase.auth.getSession();
  if (current.error) throw current.error;
  const session = current.data.session;
  if (!session || session.user.id !== userId || signal?.aborted)
    throw new Error('Address operation cancelled.');
  const result = await invokeEdgeFunction(
    supabaseEdgeTransport(supabase, session.access_token, signal),
    'manage-client-addresses',
    request,
  );
  if (result.operation !== request.operation)
    throw new Error('Unexpected address response.');
  return result as AddressResult<Action>;
}
