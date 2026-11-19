import {
  ownAvailableNowStateSchema,
  errorResponseSchema,
  type StartAvailableNowSessionRequest,
  type UpdateAvailableNowSessionRequest,
} from '@quicktrimr/validation';
import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

import {
  EdgeFunctionError,
  invokeEdgeFunction,
} from '@/lib/api/invoke-edge-function';
import { supabaseEdgeTransport } from '@/lib/api/supabase-edge-transport';

export function availabilityApi(supabase: SupabaseClient, userId: string) {
  async function session(signal?: AbortSignal) {
    const r = await supabase.auth.getSession();
    if (r.error || r.data.session?.user.id !== userId || signal?.aborted)
      throw new Error('Session changed.');
    return r.data.session;
  }
  return {
    async read(signal: AbortSignal) {
      const current = await session(signal);
      const r = await supabase.functions.invoke<unknown>(
        'start-available-now-session',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${current.access_token}` },
          signal,
        },
      );
      if (r.error instanceof FunctionsHttpError) {
        const response = r.error.context as Response;
        throw new EdgeFunctionError(
          response.status,
          errorResponseSchema.parse(await response.json()),
        );
      }
      if (r.error) throw r.error;
      await session(signal);
      return ownAvailableNowStateSchema.parse(r.data);
    },
    async start(input: StartAvailableNowSessionRequest) {
      const current = await session();
      const r = await invokeEdgeFunction(
        supabaseEdgeTransport(supabase, current.access_token),
        'start-available-now-session',
        input,
      );
      await session();
      return r;
    },
    async update(input: UpdateAvailableNowSessionRequest) {
      const current = await session();
      const r = await invokeEdgeFunction(
        supabaseEdgeTransport(supabase, current.access_token),
        'update-available-now-session',
        input,
      );
      await session();
      if (r.id !== input.sessionId)
        throw new Error('Unexpected session response.');
      return r;
    },
    async stop(sessionId: string) {
      const current = await session();
      const r = await invokeEdgeFunction(
        supabaseEdgeTransport(supabase, current.access_token),
        'stop-available-now-session',
        { sessionId },
      );
      await session();
      if (r.id !== sessionId) throw new Error('Unexpected session response.');
      return r;
    },
  };
}
