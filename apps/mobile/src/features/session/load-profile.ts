import { USER_ROLE_VALUE } from '@quicktrimr/shared';
import {
  createOrSyncProfileRequestSchema,
  userRoleSchema,
} from '@quicktrimr/validation';

import { invokeEdgeFunction } from '../../lib/api/invoke-edge-function.ts';
import { supabaseEdgeTransport } from '../../lib/api/supabase-edge-transport.ts';

import type { SupabaseClient } from '@supabase/supabase-js';

export async function loadProfile(
  supabase: SupabaseClient,
  userId: string,
  signal: AbortSignal,
) {
  const stored = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .abortSignal(signal)
    .maybeSingle();
  if (stored.error) throw stored.error;

  // PostgREST can refresh the token while resolving the stored role. Re-read
  // the session before sync and bind the write to the same account.
  const current = await supabase.auth.getSession();
  if (current.error) throw current.error;
  const session = current.data.session;
  if (!session || session.user.id !== userId)
    throw new Error('Session changed.');
  if (signal.aborted) throw new Error('Profile sync cancelled.');

  // A signup selection is only a bootstrap input. Read the persisted role on
  // every sync once a profile exists, regardless of Auth user metadata.
  const role = stored.data
    ? userRoleSchema.parse(stored.data.role)
    : session.user.user_metadata.signup_role;
  const request = createOrSyncProfileRequestSchema.parse({ role });
  const profile = await invokeEdgeFunction(
    supabaseEdgeTransport(supabase, session.access_token, signal),
    'create-or-sync-profile',
    request,
  );
  if (profile.id !== userId || profile.role === USER_ROLE_VALUE.ADMIN)
    throw new Error('Unexpected profile.');
  return { role: profile.role, onboardingComplete: profile.onboardingComplete };
}
