import {
  archiveServiceCategoryRequestSchema,
  archiveServiceCategoryResponseSchema,
  createServiceCategoryRequestSchema,
  createServiceCategoryResponseSchema,
  updateServiceCategoryRequestSchema,
  updateServiceCategoryResponseSchema,
  userRoleSchema,
} from '@quicktrimr/validation';

import { createStoredRoleVerifier } from '../auth/stored-role.ts';
import { json } from '../responses/json.mts';
export { supabaseRuntimeConfig as categoryRuntimeConfig } from '../services/runtime-config.ts';

export type CategoryOperation = 'create' | 'update' | 'archive';
type Options = {
  operation: CategoryOperation;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
  log?: Pick<Console, 'error'>;
};
const schemas = {
  create: {
    request: createServiceCategoryRequestSchema,
    response: createServiceCategoryResponseSchema,
  },
  update: {
    request: updateServiceCategoryRequestSchema,
    response: updateServiceCategoryResponseSchema,
  },
  archive: {
    request: archiveServiceCategoryRequestSchema,
    response: archiveServiceCategoryResponseSchema,
  },
};

export function createCategoryMutationHandler({
  operation,
  supabaseUrl,
  anonKey,
  serviceRoleKey,
  fetcher = fetch,
  log = console,
}: Options) {
  const baseUrl = new URL(supabaseUrl);
  const verifyRole = createStoredRoleVerifier({ baseUrl, anonKey, fetcher });
  const schema = schemas[operation];

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    try {
      const authorization = request.headers.get('authorization');
      const identity = await verifyRole(
        authorization,
        userRoleSchema.enum.admin,
      );
      if ('error' in identity)
        return json({ error: identity.error }, identity.status);

      const body: unknown = await request.json().catch(() => null);
      if (
        operation === 'update' &&
        body !== null &&
        typeof body === 'object' &&
        'slug' in body
      )
        return json({ error: 'slug_immutable' }, 409);
      const parsed = schema.request.safeParse(body);
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues)
          fields[String(issue.path[0] ?? '_request')] ??= issue.message;
        return json({ error: 'validation_failed', fields }, 422);
      }
      const response = await fetcher(
        new URL('/rest/v1/rpc/manage_service_category', baseUrl),
        {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            p_user_id: identity.userId,
            p_operation: operation,
            p_input: parsed.data,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      );
      const result: unknown = await response.json();
      if (response.ok) return json(schema.response.parse(result), 200);
      const failure = result as { message?: string; details?: string };
      if (response.status === 403 && failure.message === 'category_forbidden')
        return json({ error: 'forbidden' }, 403);
      if (response.status === 404 && failure.message === 'not_found')
        return json({ error: 'not_found' }, 404);
      if (response.status === 409) {
        if (failure.message === 'slug_immutable')
          return json({ error: 'slug_immutable' }, 409);
        if (failure.message === 'slug_exists')
          return json(
            { error: 'slug_exists', fields: { slug: 'Already in use' } },
            409,
          );
        if (failure.message === 'category_price_conflict') {
          const fields: Record<string, string> = {};
          for (const key of ['minPriceCents', 'maxPriceCents'])
            if (failure.details === 'both' || failure.details === key)
              fields[key] = 'Would exclude an active barber price';
          return json({ error: 'category_price_conflict', fields }, 409);
        }
      }
      if (response.status === 422 && failure.message === 'validation_failed')
        return json(
          {
            error: 'validation_failed',
            fields: { _request: 'Invalid category data' },
          },
          422,
        );
      throw new Error('Category mutation failed.');
    } catch {
      log.error('service_categories.internal_error');
      return json({ error: 'internal_error' }, 500);
    }
  };
}
