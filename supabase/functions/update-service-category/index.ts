import {
  categoryRuntimeConfig,
  createCategoryMutationHandler,
} from '../_shared/catalogue/handler.ts';

Deno.serve(
  createCategoryMutationHandler({
    ...categoryRuntimeConfig((name) => Deno.env.get(name)),
    operation: 'update',
  }),
);
