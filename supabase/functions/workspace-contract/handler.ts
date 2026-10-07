import { functionWorkspaceIdentity } from './index.ts';

// Constant-only infrastructure probe. Gateway verifies the JWT; no user data is read.
export function handleWorkspaceContract(request: Request): Response {
  if (request.method !== 'GET') {
    return Response.json(
      { error: 'Use GET.' },
      {
        status: 405,
        headers: { Allow: 'GET' },
      },
    );
  }
  return Response.json(functionWorkspaceIdentity);
}
