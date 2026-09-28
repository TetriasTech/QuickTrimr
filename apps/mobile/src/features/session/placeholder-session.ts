import type { AppSession } from './route-access';

// P1-T01 replaces this immutable shell state with the real authenticated session provider.
export const PLACEHOLDER_SESSION: AppSession = { status: 'signed-out' };
