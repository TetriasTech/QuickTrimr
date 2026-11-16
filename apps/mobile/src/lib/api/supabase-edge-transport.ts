import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

import type { EdgeFunctionTransport } from './invoke-edge-function.ts';

export function supabaseEdgeTransport(
  supabase: SupabaseClient,
  accessToken: string,
  signal?: AbortSignal,
): EdgeFunctionTransport {
  return {
    async invoke(name, { body }) {
      const result = await supabase.functions.invoke<unknown>(name, {
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        ...(signal ? { signal } : {}),
      });
      if (result.error instanceof FunctionsHttpError) {
        const response = result.error.context as Response;
        return {
          status: response.status,
          body: (await response.json()) as unknown,
        };
      }
      if (result.error) throw result.error;
      return { status: 200, body: result.data };
    },
  };
}
