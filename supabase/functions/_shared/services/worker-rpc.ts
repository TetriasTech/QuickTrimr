import { json } from '../responses/json.mts';

import type { z } from 'zod';

export function createWorkerRpcHandler<Input>({
  supabaseUrl,
  serviceRoleKey,
  rpc,
  parameter,
  inputSchema,
  responseSchema,
  readId,
  failureEvent,
  fetcher = fetch,
  log = console,
}: {
  supabaseUrl: string;
  serviceRoleKey: string;
  rpc: string;
  parameter: string;
  inputSchema: z.ZodType<Input>;
  responseSchema: z.ZodType;
  readId: (input: Input) => string;
  failureEvent: string;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
}) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    const authorization = request.headers.get('authorization');
    if (!authorization) return json({ error: 'unauthorized' }, 401);
    if (!/^Bearer [^\s,]+$/i.test(authorization))
      return json({ error: 'forbidden' }, 403);
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    try {
      // PostgREST verifies the caller's JWT and the RPC's service_role grant /
      // auth.role() guard. Never decode or trust a caller-supplied role. Hosted
      // service JWTs need not be byte-identical to the runtime's built-in key.
      // Invalid input uses a null reference as a no-effect authorization probe;
      // only an authorized worker can reach the validation response below.
      const response = await fetcher(
        new URL(`/rest/v1/rpc/${rpc}`, supabaseUrl),
        {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            [parameter]: input.success ? readId(input.data) : null,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      );
      if ([401, 403].includes(response.status))
        return json({ error: 'forbidden' }, 403);
      if (!input.success && [200, 404].includes(response.status)) {
        const fields: Record<string, string> = {};
        for (const issue of input.error.issues)
          fields[String(issue.path[0] ?? '_request')] ??= issue.message;
        return json({ error: 'validation_failed', fields }, 422);
      }
      if (response.status === 404) return json({ error: 'not_found' }, 404);
      if (!response.ok) throw new Error('Worker transition failed');
      return json(responseSchema.parse(await response.json()), 200);
    } catch {
      log.error(failureEvent);
      return json({ error: 'internal_error' }, 500);
    }
  };
}
