type VerifyUserOptions = {
  baseUrl: URL;
  anonKey: string;
  fetcher: typeof fetch;
};

// Resolve identity with Auth, never with a decoded client JWT or user metadata.
export function createSupabaseUserVerifier({
  baseUrl,
  anonKey,
  fetcher,
}: VerifyUserOptions) {
  const endpoint = new URL('/auth/v1/user', baseUrl);

  return async (authorization: string | null): Promise<string | null> => {
    if (!authorization || !/^Bearer [^\s,]+$/i.test(authorization)) return null;

    const response = await fetcher(endpoint, {
      headers: { apikey: anonKey, authorization },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if ([400, 401, 403].includes(response.status)) return null;
    if (!response.ok) throw new Error('Auth verification unavailable.');

    const user: unknown = await response.json();
    if (user === null || typeof user !== 'object') return null;
    if (!('role' in user) || user.role !== 'authenticated') return null;
    if ('is_anonymous' in user && user.is_anonymous === true) return null;
    return 'id' in user && typeof user.id === 'string' ? user.id : null;
  };
}
