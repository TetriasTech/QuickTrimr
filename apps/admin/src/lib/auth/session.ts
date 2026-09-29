import 'server-only';
import type { UserRole } from '@quicktrimr/shared';

export type AdminSession = Readonly<{ userId: string; role: UserRole }>;

/**
 * P0-T16 placeholder: deny everyone in development AND production.
 * P1-T02 replaces this with verified Supabase identity + database role lookup.
 * Never accept a role from query params, headers, cookies or editable JWT metadata.
 * No environment override or production-wired test session is provided.
 */
export async function readAdminSession(): Promise<AdminSession | null> {
  return null;
}
