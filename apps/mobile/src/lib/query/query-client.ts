import { QueryClient } from '@tanstack/react-query';

const QUERY_RETRY_LIMIT = 1;

function statusFromError(error: unknown) {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (failureCount >= QUERY_RETRY_LIMIT) return false;

  const status = statusFromError(error);
  return status === undefined || status === 429 || status >= 500;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
        retry: shouldRetryQuery,
        staleTime: 0,
      },
    },
  });
}
